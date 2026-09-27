// Step10 income receipt integration tests.
//
// Tests exercise the real production service layer
// (lib/settlements/service.ts) against disposable step10_* schemas with two
// synthetic users (A and B). Receipts mirror payments but add to the account
// balance instead of subtracting.
//
// Key scenarios:
// - Receive partial amounts: expected 10000 -> receive 4000 -> receive 6000;
//   pending goes 10000 -> 6000 -> 0.
// - Over-receipt rejected.
// - Concurrent receipts cannot over-receive.
// - Duplicate request credits once (idempotency).
// - Changed-payload same key rejects.
// - Rollback fault injection.
// - UPDATE_ACCOUNT adds to balance; ALREADY_REFLECTED does not.
// - Cross-owner refs rejected.
// - Closed month rejected.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupSettlementsSchema,
  teardownSettlementsSchema,
  createPlanDirect,
  closePlanDirect,
  readIncomeDirect,
  readAccountDirect,
  countMovements,
  testIdempotencyKey,
  type SettlementsTestContext,
} from "./helpers";
import {
  createIncome,
  getIncome,
} from "../../lib/income/service";
import {
  createAccount,
} from "../../lib/accounts/service";
import {
  receiveIncome,
  SettlementNotFoundError,
  SettlementValidationError,
  IdempotencyConflictError,
  OverpaymentError,
  ClosedMonthError,
} from "../../lib/settlements/service";

let ctx: SettlementsTestContext;

beforeAll(async () => {
  ctx = await setupSettlementsSchema();
});

afterAll(async () => {
  await teardownSettlementsSchema(ctx);
});

async function makeIncomeExpectation(
  ownerId: string,
  monthKey: string,
  expectedCents = 10000,
): Promise<string> {
  await createPlanDirect(ctx.pool, ownerId, monthKey);
  const { income } = await createIncome(ownerId, {
    monthKey,
    sourceName: `Μισθός-${monthKey}`,
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

describe("Step10 receipts: 10000 -> 4000 -> 6000 -> 0", () => {
  it("receives 4000 then 6000, pending goes 10000 -> 6000 -> 0, expected unchanged", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2026-03");
    const accountId = await makeAccount(ctx.userA, 50000);

    const first = await receiveIncome(ctx.userA, {
      incomeExpectationId: incomeId,
      amountCents: 4000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-03-10",
      idempotencyKey: testIdempotencyKey("receipt-1"),
    });
    expect(first.receivedCents).toBe(4000);
    expect(first.pendingCents).toBe(6000);
    expect(first.accountNewBalance).toBe(54000);

    // Expected unchanged
    const direct1 = await readIncomeDirect(ctx.pool, ctx.userA, incomeId);
    expect(direct1.expectedCents).toBe(10000);

    const second = await receiveIncome(ctx.userA, {
      incomeExpectationId: incomeId,
      amountCents: 6000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-03-11",
      idempotencyKey: testIdempotencyKey("receipt-2"),
    });
    expect(second.receivedCents).toBe(10000);
    expect(second.pendingCents).toBe(0);
    expect(second.accountNewBalance).toBe(60000);

    // Expected still unchanged
    const direct2 = await readIncomeDirect(ctx.pool, ctx.userA, incomeId);
    expect(direct2.expectedCents).toBe(10000);
  });

  it("over-receipt rejects (third receipt on fully received income)", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2026-04");
    const accountId = await makeAccount(ctx.userA, 10000);

    await receiveIncome(ctx.userA, {
      incomeExpectationId: incomeId,
      amountCents: 10000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-04-01",
      idempotencyKey: testIdempotencyKey("receipt-full"),
    });

    await expect(
      receiveIncome(ctx.userA, {
        incomeExpectationId: incomeId,
        amountCents: 1000,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2026-04-02",
        idempotencyKey: testIdempotencyKey("receipt-over"),
      }),
    ).rejects.toThrow(OverpaymentError);
  });
});

describe("Step10 receipts: concurrency", () => {
  it("two concurrent 6000 receipts cannot both settle a 10000 income", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2026-05");
    const accountId = await makeAccount(ctx.userA, 100000);

    const results = await Promise.allSettled([
      receiveIncome(ctx.userA, {
        incomeExpectationId: incomeId,
        amountCents: 6000,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2026-05-01",
        idempotencyKey: testIdempotencyKey("conc-receipt-a"),
      }),
      receiveIncome(ctx.userA, {
        incomeExpectationId: incomeId,
        amountCents: 6000,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2026-05-01",
        idempotencyKey: testIdempotencyKey("conc-receipt-b"),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    if (rejected[0].status === "rejected") {
      expect(rejected[0].reason).toBeInstanceOf(OverpaymentError);
    }

    // Account credited exactly once (6000)
    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(106000);
  });
});

describe("Step10 receipts: idempotency", () => {
  it("duplicate request with same key credits once", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2026-06");
    const accountId = await makeAccount(ctx.userA, 20000);

    const input = {
      incomeExpectationId: incomeId,
      amountCents: 5000,
      mode: "UPDATE_ACCOUNT" as const,
      accountId,
      businessDate: "2026-06-01",
      idempotencyKey: testIdempotencyKey("receipt-idem"),
    };

    const first = await receiveIncome(ctx.userA, input);
    const second = await receiveIncome(ctx.userA, input);

    expect(second.receiptId).toBe(first.receiptId);
    expect(second.receivedCents).toBe(first.receivedCents);

    const movements = await countMovements(ctx.pool, ctx.userA, accountId);
    expect(movements).toBe(1);

    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(25000);
  });

  it("same key with a different payload is rejected", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2026-07");
    const accountId = await makeAccount(ctx.userA, 20000);
    const key = testIdempotencyKey("receipt-idem-conflict");

    await receiveIncome(ctx.userA, {
      incomeExpectationId: incomeId,
      amountCents: 3000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-07-01",
      idempotencyKey: key,
    });

    await expect(
      receiveIncome(ctx.userA, {
        incomeExpectationId: incomeId,
        amountCents: 5000,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2026-07-01",
        idempotencyKey: key,
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });
});

describe("Step10 receipts: rollback", () => {
  it("receipt with non-existent account leaves no partial state", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2026-08");

    await expect(
      receiveIncome(ctx.userA, {
        incomeExpectationId: incomeId,
        amountCents: 4000,
        mode: "UPDATE_ACCOUNT",
        accountId: "999999999",
        businessDate: "2026-08-01",
        idempotencyKey: testIdempotencyKey("receipt-rollback"),
      }),
    ).rejects.toThrow(SettlementNotFoundError);

    const income = await getIncome(ctx.userA, incomeId);
    expect(income.receivedCents).toBe(0);
  });
});

describe("Step10 receipts: UPDATE_ACCOUNT vs ALREADY_REFLECTED", () => {
  it("UPDATE_ACCOUNT adds to balance and creates a credit movement", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2026-09");
    const accountId = await makeAccount(ctx.userA, 30000);

    const result = await receiveIncome(ctx.userA, {
      incomeExpectationId: incomeId,
      amountCents: 2000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-09-01",
      idempotencyKey: testIdempotencyKey("receipt-update"),
    });
    expect(result.accountNewBalance).toBe(32000);

    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(32000);

    const movements = await countMovements(ctx.pool, ctx.userA, accountId);
    expect(movements).toBe(1);
  });

  it("ALREADY_REFLECTED does not change balance and creates no movement", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2026-10");
    const accountId = await makeAccount(ctx.userA, 30000);

    const result = await receiveIncome(ctx.userA, {
      incomeExpectationId: incomeId,
      amountCents: 2000,
      mode: "ALREADY_REFLECTED",
      accountId: null,
      businessDate: "2026-10-01",
      idempotencyKey: testIdempotencyKey("receipt-reflected"),
    });
    expect(result.accountNewBalance).toBe(null);

    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(30000);

    const movements = await countMovements(ctx.pool, ctx.userA, accountId);
    expect(movements).toBe(0);

    const income = await getIncome(ctx.userA, incomeId);
    expect(income.receivedCents).toBe(2000);
  });
});

describe("Step10 receipts: validation", () => {
  it("rejects zero amount", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2026-11");
    const accountId = await makeAccount(ctx.userA, 10000);
    await expect(
      receiveIncome(ctx.userA, {
        incomeExpectationId: incomeId,
        amountCents: 0,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2026-11-01",
        idempotencyKey: testIdempotencyKey("receipt-zero"),
      }),
    ).rejects.toThrow(SettlementValidationError);
  });

  it("rejects UPDATE_ACCOUNT without an account", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2026-12");
    await expect(
      receiveIncome(ctx.userA, {
        incomeExpectationId: incomeId,
        amountCents: 1000,
        mode: "UPDATE_ACCOUNT",
        accountId: null,
        businessDate: "2026-12-01",
        idempotencyKey: testIdempotencyKey("receipt-no-acct"),
      }),
    ).rejects.toThrow(SettlementValidationError);
  });
});

describe("Step10 receipts: closed month", () => {
  it("rejects receipt on a closed month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-01");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2027-01",
      sourceName: "Closed month income",
      expectedCents: 5000,
    });
    const accountId = await makeAccount(ctx.userA, 10000);
    await closePlanDirect(ctx.pool, ctx.userA, "2027-01");

    await expect(
      receiveIncome(ctx.userA, {
        incomeExpectationId: income.id,
        amountCents: 1000,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2027-01-01",
        idempotencyKey: testIdempotencyKey("receipt-closed"),
      }),
    ).rejects.toThrow(ClosedMonthError);
  });
});

describe("Step10 receipts: cross-owner isolation", () => {
  it("user B cannot receive against user A's income", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2027-02");
    const bAccount = await makeAccount(ctx.userB, 10000);

    await expect(
      receiveIncome(ctx.userB, {
        incomeExpectationId: incomeId,
        amountCents: 1000,
        mode: "UPDATE_ACCOUNT",
        accountId: bAccount,
        businessDate: "2027-02-01",
        idempotencyKey: testIdempotencyKey("receipt-cross"),
      }),
    ).rejects.toThrow(SettlementNotFoundError);

    const income = await getIncome(ctx.userA, incomeId);
    expect(income.receivedCents).toBe(0);
  });

  it("user A cannot receive into user B's account", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2027-03");
    const bAccount = await makeAccount(ctx.userB, 10000);

    await expect(
      receiveIncome(ctx.userA, {
        incomeExpectationId: incomeId,
        amountCents: 1000,
        mode: "UPDATE_ACCOUNT",
        accountId: bAccount,
        businessDate: "2027-03-01",
        idempotencyKey: testIdempotencyKey("receipt-cross-acct"),
      }),
    ).rejects.toThrow(SettlementNotFoundError);

    const acct = await readAccountDirect(ctx.pool, ctx.userB, bAccount);
    expect(acct.currentBalanceCents).toBe(10000);
  });
});

describe("Step10 receipts: received/pending derivation after multiple receipts", () => {
  it("getIncome reflects received from non-reversed receipts only", async () => {
    const incomeId = await makeIncomeExpectation(ctx.userA, "2027-04", 10000);
    const accountId = await makeAccount(ctx.userA, 100000);

    await receiveIncome(ctx.userA, {
      incomeExpectationId: incomeId,
      amountCents: 3000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2027-04-01",
      idempotencyKey: testIdempotencyKey("receipt-multi-1"),
    });
    await receiveIncome(ctx.userA, {
      incomeExpectationId: incomeId,
      amountCents: 2000,
      mode: "ALREADY_REFLECTED",
      accountId: null,
      businessDate: "2027-04-02",
      idempotencyKey: testIdempotencyKey("receipt-multi-2"),
    });

    const income = await getIncome(ctx.userA, incomeId);
    expect(income.receivedCents).toBe(5000);
    expect(income.pendingCents).toBe(5000);
    expect(income.expectedCents).toBe(10000);
  });
});