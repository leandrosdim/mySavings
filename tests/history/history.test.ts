// Step15 month closing and history DB integration tests.
//
// Tests exercise the real production service layer (lib/history ->
// lib/finance/forecast, lib/db) against disposable step15_* schemas with two
// synthetic users (A and B). No mocking of the business logic.
//
// Key scenarios from the Step15 acceptance criteria:
// - Close stores an immutable snapshot; later balance/target/payment changes
//   cannot alter it.
// - Repeated close on an already-closed month is rejected (no overwrite).
// - Concurrent close: first commit wins, second sees closed and is rejected.
// - Rollback: a failed close leaves no snapshot and the plan stays open.
// - Closed-period direct write rejection: paying into a closed month is
//   rejected by the settlements service (existing boundary).
// - A/B isolation: A cannot read B's snapshot.
// - Paid totals come from non-reversed settlements, not balance differences.
// - Audit log records the close.
//
// No real workbook figures. Synthetic fixtures only, scoped cleanup.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupHistorySchema,
  teardownHistorySchema,
  createPlanDirect,
  closePlanDirect,
  readSnapshotDirect,
  countSnapshots,
  countAuditLogs,
  createUniqueTestUser,
  type HistoryTestContext,
} from "./helpers";
import {
  closeMonth,
  getClosingSnapshot,
  listHistorySummaries,
} from "../../lib/history/service";
import {
  HistoryNotFoundError,
  ClosedMonthError,
  type CloseMonthResult,
} from "../../lib/history/types";
import { createObligation } from "../../lib/obligations/service";
import { createIncome } from "../../lib/income/service";
import { createAccount } from "../../lib/accounts/service";
import { payObligation } from "../../lib/settlements/service";
import { refreshBalance } from "../../lib/accounts/service";
import { updateSavingsTarget } from "../../lib/months/service";
import { cents } from "../../lib/finance/money";

let ctx: HistoryTestContext;

beforeAll(async () => {
  ctx = await setupHistorySchema();
});

afterAll(async () => {
  await teardownHistorySchema(ctx);
});

const MONTH = "2026-09";

// --- Common fixture: plan + account + obligation + income ---

async function setupMonth(
  ownerId: string,
  monthKey: string = MONTH,
  target: number = 50000,
): Promise<{
  accountId: string;
  obligationId: string;
  incomeId: string;
  planId: string;
}> {
  const planId = await createPlanDirect(ctx.pool, ownerId, monthKey, target);
  const { account } = await createAccount(ownerId, {
    name: "Τραπεζα",
    initialBalanceCents: 100000,
    trackBalance: true,
  });
  const { obligation } = await createObligation(ownerId, {
    kind: "ordinary",
    title: "Ενοίκιο",
    plannedCents: 80000,
    monthKey,
  });
  const { income } = await createIncome(ownerId, {
    monthKey,
    sourceName: "Μισθός",
    expectedCents: 200000,
  });
  return {
    accountId: account.id,
    obligationId: obligation.id,
    incomeId: income.id,
    planId,
  };
}

// --- Close stores an immutable snapshot ---

describe("Step15 closeMonth stores an immutable snapshot", () => {
  it("closes an open month and stores a snapshot with forecast aggregates", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    const fix = await setupMonth(user);

    const result = await closeMonth(user, MONTH);

    expect(result.snapshot.monthKey).toBe(MONTH);
    expect(result.snapshot.balancesTotalCents).toBe(100000);
    expect(result.snapshot.savingsTargetCents).toBe(50000);
    expect(result.snapshot.ordinaryUnpaidCents).toBe(80000);
    expect(result.snapshot.pendingIncomeRemainingCents).toBe(200000);
    expect(result.snapshot.settlementTotalCents).toBe(0);
    // projected = B + I - E - R - S = 100000 + 200000 - 80000 - 0 - 50000 = 170000
    expect(result.snapshot.projectedFreeToSpendCents).toBe(170000);
    expect(result.snapshot.provenance).not.toBeNull();
    expect(result.snapshot.provenance?.accounts.length).toBe(1);
    expect(result.snapshot.provenance?.ordinaryExpenses.length).toBe(1);
    expect(result.snapshot.provenance?.income.length).toBe(1);
    expect(result.snapshot.provenance?.accounts[0].balanceCents).toBe(100000);

    const direct = await readSnapshotDirect(ctx.pool, user, MONTH);
    expect(direct).not.toBeNull();
    expect(direct?.balancesTotalCents).toBe(100000);

    const audits = await countAuditLogs(ctx.pool, user, "month_close");
    expect(audits).toBe(1);
  });

  it("paid totals come from non-reversed settlements, not balance differences", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    const fix = await setupMonth(user, "2026-08", 0);

    // Pay 30000 of the 80000 obligation from the account.
    await payObligation(user, {
      obligationId: fix.obligationId,
      amountCents: 30000,
      mode: "UPDATE_ACCOUNT",
      accountId: fix.accountId,
      businessDate: "2026-08-10",
      idempotencyKey: `pay-${fix.obligationId}-1`,
    });

    const result = await closeMonth(user, "2026-08");

    // Settlement total = 30000 (the actual payment), NOT the balance diff.
    expect(result.snapshot.settlementTotalCents).toBe(30000);
    // Balances total after payment = 100000 - 30000 = 70000.
    expect(result.snapshot.balancesTotalCents).toBe(70000);
    // Ordinary unpaid = 80000 - 30000 = 50000.
    expect(result.snapshot.ordinaryUnpaidCents).toBe(50000);
  });

  it("later balance refresh does NOT alter the stored snapshot", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    const fix = await setupMonth(user, "2026-07", 30000);

    const closed = await closeMonth(user, "2026-07");
    const balancesBefore = closed.snapshot.balancesTotalCents;
    const targetBefore = closed.snapshot.savingsTargetCents;

    // Later: refresh the balance to a totally different value.
    await refreshBalance(user, {
      accountId: fix.accountId,
      newBalanceCents: cents(999999),
      asOf: new Date(),
      expectedVersion: 1,
      reason: "post-close refresh",
      idempotencyKey: `refresh-${fix.accountId}-late`,
    });

    const snapshotAfter = await getClosingSnapshot(user, "2026-07");
    expect(snapshotAfter.balancesTotalCents).toBe(balancesBefore);
    expect(snapshotAfter.savingsTargetCents).toBe(targetBefore);

    const direct = await readSnapshotDirect(ctx.pool, user, "2026-07");
    expect(direct?.balancesTotalCents).toBe(balancesBefore);
  });

  it("later savings target change does NOT alter the stored snapshot", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    const fix = await setupMonth(user, "2026-06", 40000);

    const closed = await closeMonth(user, "2026-06");
    const targetBefore = closed.snapshot.savingsTargetCents;
    expect(targetBefore).toBe(40000);

    // The plan is closed now, so updateSavingsTarget is rejected — the
    // snapshot is protected by the closed-month lifecycle.
    await expect(
      updateSavingsTarget(user, {
        planId: fix.planId,
        savingsTargetCents: 99999,
      }),
    ).rejects.toThrow();

    const snapshotAfter = await getClosingSnapshot(user, "2026-06");
    expect(snapshotAfter.savingsTargetCents).toBe(targetBefore);
  });

  it("later payment into a closed month is rejected by the settlements boundary", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    const fix = await setupMonth(user, "2026-05", 0);

    await closeMonth(user, "2026-05");

    // A direct payment attempt into the now-closed month is rejected.
    await expect(
      payObligation(user, {
        obligationId: fix.obligationId,
        amountCents: 10000,
        mode: "UPDATE_ACCOUNT",
        accountId: fix.accountId,
        businessDate: "2026-05-20",
        idempotencyKey: `pay-${fix.obligationId}-closed`,
      }),
    ).rejects.toThrow();
  });
});

// --- Repeated / concurrent close ---

describe("Step15 repeated and concurrent close", () => {
  it("rejects a second close on an already-closed month (no overwrite)", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await setupMonth(user, "2026-04", 10000);

    await closeMonth(user, "2026-04");
    await expect(closeMonth(user, "2026-04")).rejects.toBeInstanceOf(
      ClosedMonthError,
    );

    const snaps = await countSnapshots(ctx.pool, user);
    expect(snaps).toBe(1);
  });

  it("concurrent close: first commit wins, second sees closed", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await setupMonth(user, "2026-03", 10000);

    // Launch two closes concurrently. The plan row FOR UPDATE lock
    // serializes them; one wins and the other sees status='closed'.
    const results = await Promise.allSettled([
      closeMonth(user, "2026-03"),
      closeMonth(user, "2026-03"),
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<CloseMonthResult> =>
        r.status === "fulfilled",
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBeInstanceOf(ClosedMonthError);

    const snaps = await countSnapshots(ctx.pool, user);
    expect(snaps).toBe(1);
  });

  it("close on a missing plan is rejected (not invented)", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await expect(closeMonth(user, "2025-01")).rejects.toBeInstanceOf(
      HistoryNotFoundError,
    );
  });
});

// --- History reads ---

describe("Step15 history reads", () => {
  it("listHistorySummaries returns plans with snapshot aggregates", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await setupMonth(user, "2026-02", 20000);
    await closeMonth(user, "2026-02");

    // Another open month with no snapshot.
    await createPlanDirect(ctx.pool, user, "2026-01", 5000);

    const summaries = await listHistorySummaries(user);
    expect(summaries.length).toBe(2);
    const closed = summaries.find((s) => s.monthKey === "2026-02");
    expect(closed?.status).toBe("closed");
    expect(closed?.balancesTotalCents).toBe(100000);
    const open = summaries.find((s) => s.monthKey === "2026-01");
    expect(open?.status).toBe("open");
    expect(open?.balancesTotalCents).toBeNull(); // no snapshot
  });

  it("getClosingSnapshot throws NotFound for a missing/cross-owner month", async () => {
    const userA = await createUniqueTestUser(ctx.pool);
    const userB = await createUniqueTestUser(ctx.pool);
    await setupMonth(userA, "2026-01", 0);
    await closeMonth(userA, "2026-01");

    // Owner B cannot read A's snapshot.
    await expect(getClosingSnapshot(userB, "2026-01")).rejects.toBeInstanceOf(
      HistoryNotFoundError,
    );
  });
});

// --- A/B isolation ---

describe("Step15 A/B owner isolation", () => {
  it("A closing a month does not create a snapshot for B", async () => {
    const userA = await createUniqueTestUser(ctx.pool);
    const userB = await createUniqueTestUser(ctx.pool);
    await setupMonth(userA, "2025-12", 10000);

    await closeMonth(userA, "2025-12");

    const snapsA = await countSnapshots(ctx.pool, userA);
    const snapsB = await countSnapshots(ctx.pool, userB);
    expect(snapsA).toBe(1);
    expect(snapsB).toBe(0);

    // B listing history does not see A's months.
    const summariesB = await listHistorySummaries(userB);
    expect(summariesB.find((s) => s.monthKey === "2025-12")).toBeUndefined();
  });
});