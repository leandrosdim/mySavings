// Step13 savings-first overview DB integration tests.
//
// Tests exercise the real production service layer (lib/dashboard.ts ->
// lib/finance/forecast.ts) against disposable step13_* schemas with two
// synthetic users (A and B). No mocking of the business logic; the dashboard
// service runs against the real DB and feeds live owner queries to the tested
// pure forecast core.
//
// Key scenarios from the Step13 acceptance criteria:
// - Synthetic known fixture: persisted inputs and displayed output compared to
//   the pure formula (B + I - E - R - S, B - E - R - S).
// - Partial payment: planned preserved, remaining shrinks, forecast updates.
// - Already-reflected reconciliation: E shrinks, B unchanged.
// - Reserve settlement: R shrinks; linked ordinary not double-counted.
// - Stale/never-entered balances: setup-incomplete, no confident figure.
// - Negative shortfall: preserved, no celebratory state.
// - A/B owner isolation: A cannot see B's accounts/obligations/income/target.
// - Closed month: overview refuses to reconstruct from live B.
// - Internal transfer: changes individual accounts, not total B/forecast.
//
// No real workbook figures. Synthetic fixtures only, scoped cleanup.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupDashboardSchema,
  teardownDashboardSchema,
  createPlanDirect,
  closePlanDirect,
  type DashboardTestContext,
} from "./helpers";
import { getDashboardOverview } from "../../lib/dashboard";
import { computeForecast } from "../../lib/finance/forecast";
import type { Cents } from "../../lib/finance/money";
import {
  createAccount,
  refreshBalance,
} from "../../lib/accounts/service";
import { createObligation } from "../../lib/obligations/service";
import { createIncome } from "../../lib/income/service";
import { payObligation } from "../../lib/settlements/service";
import { transferBetweenAccounts } from "../../lib/accounts/service";

let ctx: DashboardTestContext;

beforeAll(async () => {
  ctx = await setupDashboardSchema();
});

afterAll(async () => {
  await teardownDashboardSchema(ctx);
});

const TEST_MONTH = "2026-03";

/** Provision a fresh user directly via SQL for test isolation. */
async function freshUser(email: string): Promise<string> {
  const client = await ctx.pool.connect();
  try {
    const res = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
      [email, `argon2id$placeholder`],
    );
    return res.rows[0].id;
  } finally {
    client.release();
  }
}

async function makeAccount(
  ownerId: string,
  name: string,
  balance: number | null,
): Promise<{ id: string; version: number }> {
  const { account } = await createAccount(ownerId, {
    name,
    initialBalanceCents: balance,
    trackBalance: true,
  });
  return { id: account.id, version: account.version };
}

async function refreshTo(
  ownerId: string,
  accountId: string,
  version: number,
  newBalance: number,
): Promise<number> {
  const result = await refreshBalance(ownerId, {
    accountId,
    newBalanceCents: newBalance as Cents,
    asOf: new Date(),
    expectedVersion: version,
    idempotencyKey: `step13-refresh-${accountId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  return result.newVersion;
}

// --- Synthetic known fixture compared to the pure formula ---

describe("Step13 dashboard: synthetic known fixture matches formula", () => {
  it("produces forecast totals that exactly match the pure core fed with the same inputs", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, TEST_MONTH, 50000);
    const acct = await makeAccount(ctx.userA, "Bank", 100000);

    // Ordinary expense 8000 (gas analog), reserved 20000 (tax), income 30000.
    const { obligation: gas } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Καύσιμα",
      plannedCents: 8000,
      monthKey: TEST_MONTH,
    });
    const { obligation: tax } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Φόρος",
      plannedCents: 20000,
      monthKey: TEST_MONTH,
      dueDate: "2026-04-15",
    });
    await createIncome(ctx.userA, {
      monthKey: TEST_MONTH,
      sourceName: "Μισθός",
      expectedCents: 30000,
    });

    const overview = await getDashboardOverview(ctx.userA, TEST_MONTH);

    // Independently compute the pure forecast from the same persisted inputs.
    const expected = computeForecast({
      balances: [{ id: acct.id, amount: 100000 as Cents }],
      pendingIncome: [{ id: "income-1", expected: 30000 as Cents, receivedCents: 0 as Cents }],
      ordinaryExpenses: [{ id: gas.id, planned: 8000 as Cents, paidCents: 0 as Cents }],
      reservedCommitments: [{ id: tax.id, planned: 20000 as Cents, paidCents: 0 as Cents }],
      internalTransfers: [],
      savingsTarget: 50000 as Cents,
    });

    expect(overview.monthOpen).toBe(true);
    expect(overview.forecast.setupIncomplete).toBe(false);
    expect(overview.forecast.balancesTotal).toBe(expected.balancesTotal);
    expect(overview.forecast.pendingIncomeRemaining).toBe(expected.pendingIncomeRemaining);
    expect(overview.forecast.ordinaryUnpaid).toBe(expected.ordinaryUnpaid);
    expect(overview.forecast.reservedOutstanding).toBe(expected.reservedOutstanding);
    expect(overview.forecast.projectedFreeToSpend).toBe(expected.projectedFreeToSpend);
    expect(overview.forecast.cashBackedFreeToSpend).toBe(expected.cashBackedFreeToSpend);
    expect(overview.forecast.shortfall).toBe(expected.shortfall);

    // Explicit known values for the fixture.
    // B=100000, I=30000, E=8000, R=20000, S=50000.
    // projected = 100000 + 30000 - 8000 - 20000 - 50000 = 52000
    // cashBacked = 100000 - 8000 - 20000 - 50000 = 22000
    expect(overview.forecast.balancesTotal).toBe(100000);
    expect(overview.forecast.pendingIncomeRemaining).toBe(30000);
    expect(overview.forecast.ordinaryUnpaid).toBe(8000);
    expect(overview.forecast.reservedOutstanding).toBe(20000);
    expect(overview.forecast.projectedFreeToSpend).toBe(52000);
    expect(overview.forecast.cashBackedFreeToSpend).toBe(22000);
    expect(overview.forecast.shortfall).toBeNull();
    expect(overview.forecast.hasPendingIncomeCaveat).toBe(true);

    // Drilldown lists reflect the persisted rows.
    expect(overview.accounts).toHaveLength(1);
    expect(overview.accounts[0].balanceCents).toBe(100000);
    expect(overview.ordinaryExpenses).toHaveLength(1);
    expect(overview.ordinaryExpenses[0].plannedCents).toBe(8000);
    expect(overview.ordinaryExpenses[0].paidCents).toBe(0);
    expect(overview.reservedCommitments).toHaveLength(1);
    expect(overview.reservedCommitments[0].plannedCents).toBe(20000);
    expect(overview.reservedCommitments[0].dueDate).toBe("2026-04-15");
    expect(overview.income).toHaveLength(1);
    expect(overview.income[0].expectedCents).toBe(30000);
    expect(overview.savingsTargetCents).toBe(50000);
  });
});

// --- Partial payment preserves planned, shrinks remaining, updates forecast ---

describe("Step13 dashboard: partial payment updates forecast", () => {
  it("two partial payments shrink E without zeroing the plan", async () => {
    // Reuse the gas obligation from the fixture above; it is owned by userA.
    // Pay 4000 (ALREADY_REFLECTED so B stays unchanged and only E shrinks).
    const overview0 = await getDashboardOverview(ctx.userA, TEST_MONTH);
    const gas = overview0.ordinaryExpenses[0];
    expect(gas).toBeDefined();

    await payObligation(ctx.userA, {
      obligationId: gas.id,
      amountCents: 4000 as Cents,
      mode: "ALREADY_REFLECTED",
      accountId: null,
      businessDate: "2026-03-10",
      idempotencyKey: `step13-pay1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });

    const overview1 = await getDashboardOverview(ctx.userA, TEST_MONTH);
    const gas1 = overview1.ordinaryExpenses.find((o) => o.id === gas.id)!;
    expect(gas1.plannedCents).toBe(8000); // plan preserved
    expect(gas1.paidCents).toBe(4000);
    expect(gas1.remainingCents).toBe(4000);
    expect(overview1.forecast.ordinaryUnpaid).toBe(4000);
    // B unchanged (ALREADY_REFLECTED), so projected improves by 4000.
    expect(overview1.forecast.balancesTotal).toBe(100000);
    expect(overview1.forecast.projectedFreeToSpend).toBe(56000);
    expect(overview1.forecast.cashBackedFreeToSpend).toBe(26000);

    // Second 4000 payment completes the expense.
    await payObligation(ctx.userA, {
      obligationId: gas.id,
      amountCents: 4000 as Cents,
      mode: "ALREADY_REFLECTED",
      accountId: null,
      businessDate: "2026-03-11",
      idempotencyKey: `step13-pay2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });

    const overview2 = await getDashboardOverview(ctx.userA, TEST_MONTH);
    const gas2 = overview2.ordinaryExpenses.find((o) => o.id === gas.id)!;
    expect(gas2.plannedCents).toBe(8000); // still preserved
    expect(gas2.paidCents).toBe(8000);
    expect(gas2.remainingCents).toBe(0);
    expect(overview2.forecast.ordinaryUnpaid).toBe(0);
    expect(overview2.forecast.projectedFreeToSpend).toBe(60000);
  });
});

// --- UPDATE_ACCOUNT payment reduces B and E equally; free-to-spend unchanged ---

describe("Step13 dashboard: UPDATE_ACCOUNT payment reduces B and E equally", () => {
  it("paying from an account keeps projected free-to-spend stable", async () => {
    const overview0 = await getDashboardOverview(ctx.userA, TEST_MONTH);
    const acct = overview0.accounts[0];
    const tax = overview0.reservedCommitments[0];
    const projectedBefore = overview0.forecast.projectedFreeToSpend;

    await payObligation(ctx.userA, {
      obligationId: tax.id,
      amountCents: 5000 as Cents,
      mode: "UPDATE_ACCOUNT",
      accountId: acct.id,
      businessDate: "2026-03-12",
      idempotencyKey: `step13-pay-tax-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });

    const overview1 = await getDashboardOverview(ctx.userA, TEST_MONTH);
    // B dropped by 5000, R dropped by 5000: net effect on (B + I - E - R - S) is zero.
    expect(overview1.forecast.balancesTotal).toBe(100000 - 5000);
    expect(overview1.forecast.reservedOutstanding).toBe(20000 - 5000);
    expect(overview1.forecast.projectedFreeToSpend).toBe(projectedBefore);
    // Cash-backed also unchanged (B and R both dropped).
    expect(overview1.forecast.cashBackedFreeToSpend).toBe(overview0.forecast.cashBackedFreeToSpend);
  });
});

// --- Linked ordinary not double-counted in E and R ---

describe("Step13 dashboard: linked reserve presentation not double-counted", () => {
  it("an ordinary expense linked to a reserve is excluded from E", async () => {
    // Fresh user to keep this isolated from the shared fixture.
    // Create a new plan month for userA to avoid unique conflicts.
    const month = "2026-04";
    await createPlanDirect(ctx.pool, ctx.userA, month, 10000);
    const { account } = await createAccount(ctx.userA, {
      name: "Bank2",
      initialBalanceCents: 50000,
      trackBalance: true,
    });
    void account;
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "ΦΟΡΟΣ-2",
      plannedCents: 15000,
      monthKey: month,
    });
    // Ordinary expense that PRESENTS the reserve.
    const { obligation: linked } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Παρουσίαση φόρου",
      plannedCents: 15000,
      monthKey: month,
      linkedReserveId: reserve.id,
    });
    void linked;

    const overview = await getDashboardOverview(ctx.userA, month);
    // The linked ordinary must NOT contribute to E.
    expect(overview.forecast.ordinaryUnpaid).toBe(0);
    // R counts the reserve once.
    expect(overview.forecast.reservedOutstanding).toBe(15000);
    // Drilldown lists still show both rows for presentation, but the linked
    // ordinary is marked.
    const linkedRow = overview.ordinaryExpenses.find((o) => o.linkedReserveId !== null);
    expect(linkedRow).toBeDefined();
    expect(overview.reservedCommitments).toHaveLength(1);
  });
});

// --- Never-entered balance: setup-incomplete, no confident figure ---

describe("Step13 dashboard: never-entered balance is setup-incomplete", () => {
  it("a null balance yields null forecasts and an honest empty state", async () => {
    const user = await freshUser("never@step13.test.local");
    const month = "2026-05";
    await createPlanDirect(ctx.pool, user, month, 20000);
    const { account } = await createAccount(user, {
      name: "NeverEntered",
      initialBalanceCents: null,
      trackBalance: true,
    });

    const overview = await getDashboardOverview(user, month);
    expect(overview.forecast.setupIncomplete).toBe(true);
    expect(overview.forecast.projectedFreeToSpend).toBeNull();
    expect(overview.forecast.cashBackedFreeToSpend).toBeNull();
    expect(overview.forecast.shortfall).toBeNull();
    expect(overview.hasUnenteredBalance).toBe(true);
    // The account row is present with balanceCents null.
    const acct = overview.accounts.find((a) => a.id === account.id)!;
    expect(acct).toBeDefined();
    expect(acct.balanceCents).toBeNull();
  });
});

// --- Stale balance: flagged but still used in the forecast ---

describe("Step13 dashboard: stale balance is flagged", () => {
  it("a balance older than the staleness threshold is marked stale", async () => {
    const user = await freshUser("stale@step13.test.local");
    const month = "2026-06";
    await createPlanDirect(ctx.pool, user, month, 5000);
    const { account } = await createAccount(user, {
      name: "StaleBank",
      initialBalanceCents: 20000,
      trackBalance: true,
    });
    // Push balance_as_of back beyond the staleness window directly.
    const client = await ctx.pool.connect();
    try {
      await client.query(
        `UPDATE accounts SET balance_as_of = now() - interval '30 days'
         WHERE owner_id = $1 AND id = $2`,
        [user, account.id],
      );
    } finally {
      client.release();
    }

    const overview = await getDashboardOverview(user, month);
    expect(overview.hasStaleBalance).toBe(true);
    const acct = overview.accounts.find((a) => a.id === account.id)!;
    expect(acct.stale).toBe(true);
    // The forecast still uses the entered balance (staleness is a hint, not exclusion).
    expect(overview.forecast.setupIncomplete).toBe(false);
    expect(overview.forecast.balancesTotal).toBe(20000);
  });
});

// --- Negative shortfall: preserved, no clamping ---

describe("Step13 dashboard: negative shortfall preserved", () => {
  it("a deficit produces a negative projected free-to-spend and a shortfall", async () => {
    const user = await freshUser("deficit@step13.test.local");
    const month = "2026-07";
    await createPlanDirect(ctx.pool, user, month, 80000);
    await makeAccount(user, "DeficitBank", 10000);
    await createObligation(user, {
      kind: "ordinary",
      title: "Μεγάλο έξοδο",
      plannedCents: 50000,
      monthKey: month,
    });

    const overview = await getDashboardOverview(user, month);
    // B=10000, I=0, E=50000, R=0, S=80000 -> projected = -120000
    expect(overview.forecast.projectedFreeToSpend).toBe(-120000);
    expect(overview.forecast.shortfall).toBe(-120000);
    expect(overview.forecast.shortfall).not.toBeNull();
    expect(overview.forecast.shortfall! < 0).toBe(true);
  });
});

// --- Missing plan: honest empty state, not a confident zero ---

describe("Step13 dashboard: missing plan is not a confident zero", () => {
  it("no plan for the month yields monthOpen=false and no forecast figures", async () => {
    const user = await freshUser("noplan@step13.test.local");
    const month = "2026-08";
    // No plan created.
    const overview = await getDashboardOverview(user, month);
    expect(overview.hasPlan).toBe(false);
    expect(overview.monthOpen).toBe(false);
    expect(overview.savingsTargetCents).toBeNull();
    // No obligations/income loaded for a month without an open plan.
    expect(overview.ordinaryExpenses).toHaveLength(0);
    expect(overview.income).toHaveLength(0);
  });
});

// --- Closed month: not reconstructed from live B ---

describe("Step13 dashboard: closed month not reconstructed from live B", () => {
  it("a closed plan yields monthOpen=false even when accounts exist", async () => {
    const user = await freshUser("closed@step13.test.local");
    const month = "2026-09";
    await createPlanDirect(ctx.pool, user, month, 30000);
    await makeAccount(user, "ClosedMonthBank", 40000);
    await createObligation(user, {
      kind: "ordinary",
      title: "Έξοδο κλειστού",
      plannedCents: 10000,
      monthKey: month,
    });
    await closePlanDirect(ctx.pool, user, month);

    const overview = await getDashboardOverview(user, month);
    expect(overview.hasPlan).toBe(true);
    expect(overview.monthOpen).toBe(false);
    expect(overview.savingsTargetCents).toBeNull();
    expect(overview.forecast.projectedFreeToSpend).toBeNull();
    // No drilldown rows loaded for a closed month.
    expect(overview.ordinaryExpenses).toHaveLength(0);
  });
});

// --- Internal transfer: changes individual accounts, not total B ---

describe("Step13 dashboard: internal transfer does not affect total B", () => {
  it("a transfer between two accounts leaves the forecast total unchanged", async () => {
    const user = await freshUser("transfer@step13.test.local");
    const month = "2026-10";
    await createPlanDirect(ctx.pool, user, month, 10000);
    const a1 = await makeAccount(user, "TransferFrom", 30000);
    const a2 = await makeAccount(user, "TransferTo", 20000);

    const overview0 = await getDashboardOverview(user, month);
    const total0 = overview0.forecast.balancesTotal;
    expect(total0).toBe(50000);

    await transferBetweenAccounts(user, {
      fromAccountId: a1.id,
      toAccountId: a2.id,
      amountCents: 12000 as Cents,
      businessDate: "2026-10-05",
      idempotencyKey: `step13-transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });

    const overview1 = await getDashboardOverview(user, month);
    expect(overview1.forecast.balancesTotal).toBe(total0);
    expect(overview1.transfers).toHaveLength(1);
    expect(overview1.transfers[0].amountCents).toBe(12000);
    // Individual balances changed.
    const fromAcct = overview1.accounts.find((a) => a.id === a1.id)!;
    const toAcct = overview1.accounts.find((a) => a.id === a2.id)!;
    expect(fromAcct.balanceCents).toBe(18000);
    expect(toAcct.balanceCents).toBe(32000);
  });
});

// --- A/B owner isolation ---

describe("Step13 dashboard: A/B owner isolation", () => {
  it("user A's overview never includes user B's accounts, obligations, income or target", async () => {
    const userA = await freshUser("iso-a@step13.test.local");
    const userB = await freshUser("iso-b@step13.test.local");
    const month = "2026-11";
    await createPlanDirect(ctx.pool, userA, month, 60000);
    await createPlanDirect(ctx.pool, userB, month, 99999);
    await makeAccount(userA, "A-Bank", 70000);
    await makeAccount(userB, "B-Bank", 123456);
    await createObligation(userA, {
      kind: "ordinary",
      title: "A-Expense",
      plannedCents: 5000,
      monthKey: month,
    });
    await createObligation(userB, {
      kind: "ordinary",
      title: "B-Expense",
      plannedCents: 999000,
      monthKey: month,
    });
    await createIncome(userA, {
      monthKey: month,
      sourceName: "A-Income",
      expectedCents: 10000,
    });
    await createIncome(userB, {
      monthKey: month,
      sourceName: "B-Income",
      expectedCents: 999000,
    });

    const overviewA = await getDashboardOverview(userA, month);
    const overviewB = await getDashboardOverview(userB, month);

    // A sees only A's rows.
    expect(overviewA.accounts).toHaveLength(1);
    expect(overviewA.accounts[0].balanceCents).toBe(70000);
    expect(overviewA.ordinaryExpenses).toHaveLength(1);
    expect(overviewA.ordinaryExpenses[0].title).toBe("A-Expense");
    expect(overviewA.income).toHaveLength(1);
    expect(overviewA.income[0].sourceName).toBe("A-Income");
    expect(overviewA.savingsTargetCents).toBe(60000);
    expect(overviewA.forecast.balancesTotal).toBe(70000);

    // B sees only B's rows.
    expect(overviewB.accounts).toHaveLength(1);
    expect(overviewB.accounts[0].balanceCents).toBe(123456);
    expect(overviewB.ordinaryExpenses).toHaveLength(1);
    expect(overviewB.ordinaryExpenses[0].title).toBe("B-Expense");
    expect(overviewB.income).toHaveLength(1);
    expect(overviewB.income[0].sourceName).toBe("B-Income");
    expect(overviewB.savingsTargetCents).toBe(99999);
    expect(overviewB.forecast.balancesTotal).toBe(123456);

    // Cross-check: A's totals do not include B's numbers.
    expect(overviewA.forecast.balancesTotal).not.toBe(overviewB.forecast.balancesTotal);
  });
});

// --- Empty user: honest empty state when nothing exists ---

describe("Step13 dashboard: empty user shows honest empty state", () => {
  it("a user with no accounts and no plan gets an empty overview, not a confident zero", async () => {
    // Provision a brand-new user so prior tests' data does not leak in.
    const client = await ctx.pool.connect();
    let userC: string;
    try {
      const res = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
        [`c@step13.test.local`, `argon2id$placeholder`],
      );
      userC = res.rows[0].id;
    } finally {
      client.release();
    }

    const month = "2026-12";
    const overview = await getDashboardOverview(userC, month);
    expect(overview.anyAccountTracked).toBe(false);
    expect(overview.hasPlan).toBe(false);
    expect(overview.monthOpen).toBe(false);
    expect(overview.forecast.projectedFreeToSpend).toBeNull();
    expect(overview.forecast.shortfall).toBeNull();
    expect(overview.accounts).toHaveLength(0);
  });
});