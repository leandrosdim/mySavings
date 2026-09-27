// Step11 settlement/receipt history integration tests.
//
// Tests exercise the real production service layer (listSettlementsForObligation
// and listReceiptsForIncome from lib/settlements/service.ts) against disposable
// step11_* schemas with two synthetic users (A and B). No mocking of the
// business logic; the service runs against the real DB.
//
// Scenarios:
// - History is chronological and includes reversal linkage.
// - Paid/remaining derivation is consistent with history.
// - Cross-owner: user B cannot list user A's obligation history (empty because
//   owner-scoped query returns no rows for a foreign obligation id).
// - Reversal creates a history entry with reversal linkage; original stays
//   visible.
// - Both UPDATE_ACCOUNT and ALREADY_REFLECTED entries appear in history.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupSettlementsSchema,
  teardownSettlementsSchema,
  createPlanDirect,
  readObligationDirect,
  readAccountDirect,
  testIdempotencyKey,
  type SettlementsTestContext,
} from "./helpers";
import {
  createObligation,
} from "../../lib/obligations/service";
import {
  createIncome,
} from "../../lib/income/service";
import {
  createAccount,
} from "../../lib/accounts/service";
import {
  payObligation,
  receiveIncome,
  reverseSettlement,
  reverseReceipt,
  listSettlementsForObligation,
  listReceiptsForIncome,
} from "../../lib/settlements/service";
import {
  SettlementValidationError,
} from "../../lib/settlements/service";

let ctx: SettlementsTestContext;

beforeAll(async () => {
  ctx = await setupSettlementsSchema();
});

afterAll(async () => {
  await teardownSettlementsSchema(ctx);
});

async function makeObligation(
  ownerId: string,
  monthKey: string,
  plannedCents = 8000,
  title = "Βενζίνη",
): Promise<string> {
  await createPlanDirect(ctx.pool, ownerId, monthKey);
  const { obligation } = await createObligation(ownerId, {
    kind: "ordinary",
    title,
    plannedCents,
    monthKey,
  });
  return obligation.id;
}

async function makeIncome(
  ownerId: string,
  monthKey: string,
  expectedCents = 10000,
  sourceName = "Μισθός",
): Promise<string> {
  await createPlanDirect(ctx.pool, ownerId, monthKey);
  const { income } = await createIncome(ownerId, {
    monthKey,
    sourceName,
    expectedCents,
  });
  return income.id;
}

async function makeAccount(ownerId: string, balance: number): Promise<string> {
  const { account } = await createAccount(ownerId, {
    name: "Test account",
    initialBalanceCents: balance,
    trackBalance: true,
  });
  return account.id;
}

describe("Step11 settlement history", () => {
  it("returns chronological history with amounts and modes for gas 8000 -> 4000 -> 4000", async () => {
    const obligationId = await makeObligation(ctx.userA, "2026-04");
    const accountId = await makeAccount(ctx.userA, 50000);

    await payObligation(ctx.userA, {
      obligationId,
      amountCents: 4000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-04-01",
      idempotencyKey: testIdempotencyKey("pay1"),
    });
    await payObligation(ctx.userA, {
      obligationId,
      amountCents: 4000,
      mode: "ALREADY_REFLECTED",
      accountId: null,
      businessDate: "2026-04-02",
      idempotencyKey: testIdempotencyKey("pay2"),
    });

    const history = await listSettlementsForObligation(ctx.userA, obligationId);
    expect(history).toHaveLength(2);
    // Chronological by recorded_at ASC.
    expect(history[0].amountCents).toBe(4000);
    expect(history[0].mode).toBe("UPDATE_ACCOUNT");
    expect(history[0].accountId).toBe(accountId);
    expect(history[0].businessDate).toBe("2026-04-01");
    expect(history[0].reversed).toBe(false);
    expect(history[0].reversal).toBe(null);
    expect(history[1].amountCents).toBe(4000);
    expect(history[1].mode).toBe("ALREADY_REFLECTED");
    expect(history[1].accountId).toBe(null);
    expect(history[1].businessDate).toBe("2026-04-02");
    expect(history[1].reversed).toBe(false);
    expect(history[1].reversal).toBe(null);
  });

  it("preserves planned_cents unchanged after payments (history does not mutate plan)", async () => {
    const obligationId = await makeObligation(ctx.userA, "2026-05", 8000);
    const accountId = await makeAccount(ctx.userA, 50000);
    await payObligation(ctx.userA, {
      obligationId,
      amountCents: 3000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-05-01",
      idempotencyKey: testIdempotencyKey("pay-plan"),
    });
    const direct = await readObligationDirect(ctx.pool, ctx.userA, obligationId);
    expect(direct.plannedCents).toBe(8000);
  });

  it("shows reversal linkage after a reversal; original stays visible", async () => {
    const obligationId = await makeObligation(ctx.userA, "2026-06", 8000);
    const accountId = await makeAccount(ctx.userA, 50000);
    const payResult = await payObligation(ctx.userA, {
      obligationId,
      amountCents: 4000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-06-01",
      idempotencyKey: testIdempotencyKey("pay-rev"),
    });

    const reverseResult = await reverseSettlement(ctx.userA, {
      settlementId: payResult.settlementId,
      businessDate: "2026-06-03",
      idempotencyKey: testIdempotencyKey("rev"),
      reason: "Διπλή καταχώρηση",
    });
    expect(reverseResult.balanceWasAdjusted).toBe(true);

    const history = await listSettlementsForObligation(ctx.userA, obligationId);
    expect(history).toHaveLength(1);
    expect(history[0].reversed).toBe(true);
    expect(history[0].reversal).not.toBe(null);
    expect(history[0].reversal?.businessDate).toBe("2026-06-03");
    expect(history[0].reversal?.reason).toBe("Διπλή καταχώρηση");
  });

  it("returns empty history for a foreign obligation id (owner-scoped)", async () => {
    const obligationId = await makeObligation(ctx.userA, "2026-07", 8000);
    const accountId = await makeAccount(ctx.userA, 50000);
    await payObligation(ctx.userA, {
      obligationId,
      amountCents: 4000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-07-01",
      idempotencyKey: testIdempotencyKey("pay-foreign"),
    });
    // User B queries user A's obligation history -> empty (owner-scoped query).
    const history = await listSettlementsForObligation(ctx.userB, obligationId);
    expect(history).toHaveLength(0);
  });

  it("rejects a non-numeric obligation id", async () => {
    await expect(
      listSettlementsForObligation(ctx.userA, "not-a-number"),
    ).rejects.toThrow(SettlementValidationError);
  });
});

describe("Step11 receipt history", () => {
  it("returns chronological receipt history with amounts and modes", async () => {
    const incomeId = await makeIncome(ctx.userA, "2027-04", 10000);
    const accountId = await makeAccount(ctx.userA, 50000);

    await receiveIncome(ctx.userA, {
      incomeExpectationId: incomeId,
      amountCents: 4000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2027-04-01",
      idempotencyKey: testIdempotencyKey("recv1"),
    });
    await receiveIncome(ctx.userA, {
      incomeExpectationId: incomeId,
      amountCents: 6000,
      mode: "ALREADY_REFLECTED",
      accountId: null,
      businessDate: "2027-04-02",
      idempotencyKey: testIdempotencyKey("recv2"),
    });

    const history = await listReceiptsForIncome(ctx.userA, incomeId);
    expect(history).toHaveLength(2);
    expect(history[0].amountCents).toBe(4000);
    expect(history[0].mode).toBe("UPDATE_ACCOUNT");
    expect(history[0].accountId).toBe(accountId);
    expect(history[0].reversed).toBe(false);
    expect(history[1].amountCents).toBe(6000);
    expect(history[1].mode).toBe("ALREADY_REFLECTED");
    expect(history[1].reversed).toBe(false);
  });

  it("shows reversal linkage after a receipt reversal", async () => {
    const incomeId = await makeIncome(ctx.userA, "2026-11", 10000);
    const accountId = await makeAccount(ctx.userA, 50000);
    const recvResult = await receiveIncome(ctx.userA, {
      incomeExpectationId: incomeId,
      amountCents: 5000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-11-01",
      idempotencyKey: testIdempotencyKey("recv-rev"),
    });

    await reverseReceipt(ctx.userA, {
      receiptId: recvResult.receiptId,
      businessDate: "2026-11-03",
      idempotencyKey: testIdempotencyKey("recv-rev-op"),
      reason: "Λάθος πηγή",
    });

    const history = await listReceiptsForIncome(ctx.userA, incomeId);
    expect(history).toHaveLength(1);
    expect(history[0].reversed).toBe(true);
    expect(history[0].reversal).not.toBe(null);
    expect(history[0].reversal?.reason).toBe("Λάθος πηγή");
  });

  it("returns empty history for a foreign income id (owner-scoped)", async () => {
    const incomeId = await makeIncome(ctx.userA, "2026-12", 10000);
    const accountId = await makeAccount(ctx.userA, 50000);
    await receiveIncome(ctx.userA, {
      incomeExpectationId: incomeId,
      amountCents: 4000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-12-01",
      idempotencyKey: testIdempotencyKey("recv-foreign"),
    });
    const history = await listReceiptsForIncome(ctx.userB, incomeId);
    expect(history).toHaveLength(0);
  });

  it("rejects a non-numeric income id", async () => {
    await expect(
      listReceiptsForIncome(ctx.userA, "abc"),
    ).rejects.toThrow(SettlementValidationError);
  });
});