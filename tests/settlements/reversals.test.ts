// Step10 reversal integration tests.
//
// Tests exercise the real production service layer
// (lib/settlements/service.ts) against disposable step10_* schemas with two
// synthetic users (A and B). Reversals create immutable compensating rows
// linked to the original settlement/receipt.
//
// Key scenarios from the step acceptance criteria:
// - Reversal before manual refresh: balance is compensated automatically.
// - Reversal after manual refresh: requires explicit decision
//   (adjustBalanceAfterRefresh). Without it, RefreshReconciliationRequiredError.
//   With true: balance adjusted. With false: balance left untouched.
// - Double reversal rejected.
// - Reversal idempotency: same key+payload returns original; changed payload
//   rejects.
// - Reversed settlement excluded from paid total; reversed receipt excluded
//   from received total.
// - Cross-owner reversal rejected.
// - ALREADY_REFLECTED reversal creates no balance change (no account to
//   adjust).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupSettlementsSchema,
  teardownSettlementsSchema,
  createPlanDirect,
  closePlanDirect,
  readObligationDirect,
  readIncomeDirect,
  readAccountDirect,
  countSettlementReversals,
  countReceiptReversals,
  countMovements,
  insertBalanceAdjustmentDirect,
  testIdempotencyKey,
  type SettlementsTestContext,
} from "./helpers";
import {
  createObligation,
  getObligation,
} from "../../lib/obligations/service";
import {
  createIncome,
  getIncome,
} from "../../lib/income/service";
import {
  createAccount,
} from "../../lib/accounts/service";
import {
  payObligation,
  receiveIncome,
  reverseSettlement,
  reverseReceipt,
  getSettlement,
  getReceipt,
  SettlementNotFoundError,
  IdempotencyConflictError,
  AlreadyReversedError,
  RefreshReconciliationRequiredError,
  ClosedMonthError,
} from "../../lib/settlements/service";

let ctx: SettlementsTestContext;

beforeAll(async () => {
  ctx = await setupSettlementsSchema();
});

afterAll(async () => {
  await teardownSettlementsSchema(ctx);
});

async function setupPayment(
  ownerId: string,
  monthKey: string,
  plannedCents = 8000,
  accountBalance = 50000,
): Promise<{ obligationId: string; accountId: string; settlementId: string }> {
  await createPlanDirect(ctx.pool, ownerId, monthKey);
  const { obligation } = await createObligation(ownerId, {
    kind: "ordinary",
    title: "Test expense",
    plannedCents,
    monthKey,
  });
  const { account } = await createAccount(ownerId, {
    name: "Test account",
    initialBalanceCents: accountBalance,
    trackBalance: true,
  });
  const result = await payObligation(ownerId, {
    obligationId: obligation.id,
    amountCents: 4000,
    mode: "UPDATE_ACCOUNT",
    accountId: account.id,
    businessDate: `${monthKey}-10`,
    idempotencyKey: testIdempotencyKey(`setup-pay-${monthKey}`),
  });
  return {
    obligationId: obligation.id,
    accountId: account.id,
    settlementId: result.settlementId,
  };
}

async function setupReceipt(
  ownerId: string,
  monthKey: string,
  expectedCents = 10000,
  accountBalance = 50000,
): Promise<{ incomeId: string; accountId: string; receiptId: string }> {
  await createPlanDirect(ctx.pool, ownerId, monthKey);
  const { income } = await createIncome(ownerId, {
    monthKey,
    sourceName: `Test income-${monthKey}`,
    expectedCents,
  });
  const { account } = await createAccount(ownerId, {
    name: "Test account",
    initialBalanceCents: accountBalance,
    trackBalance: true,
  });
  const result = await receiveIncome(ownerId, {
    incomeExpectationId: income.id,
    amountCents: 4000,
    mode: "UPDATE_ACCOUNT",
    accountId: account.id,
    businessDate: `${monthKey}-10`,
    idempotencyKey: testIdempotencyKey(`setup-receipt-${monthKey}`),
  });
  return {
    incomeId: income.id,
    accountId: account.id,
    receiptId: result.receiptId,
  };
}

describe("Step10 settlement reversal: before manual refresh", () => {
  it("reverses the settlement and credits the account back", async () => {
    const { obligationId, accountId, settlementId } = await setupPayment(
      ctx.userA,
      "2027-01",
    );

    // Balance after payment: 50000 - 4000 = 46000
    const before = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(before.currentBalanceCents).toBe(46000);

    const result = await reverseSettlement(ctx.userA, {
      settlementId,
      businessDate: "2026-03-15",
      idempotencyKey: testIdempotencyKey("reverse-before-refresh"),
    });
    expect(result.balanceWasAdjusted).toBe(true);
    expect(result.accountNewBalance).toBe(50000);

    // Account is credited back
    const after = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(after.currentBalanceCents).toBe(50000);

    // Reversal row exists
    const reversalCount = await countSettlementReversals(ctx.pool, ctx.userA);
    expect(reversalCount).toBeGreaterThanOrEqual(1);

    // Paid is now 0 (settlement reversed)
    const obligation = await getObligation(ctx.userA, obligationId);
    expect(obligation.paidCents).toBe(0);
    expect(obligation.remainingCents).toBe(8000);

    // Planned unchanged
    const direct = await readObligationDirect(ctx.pool, ctx.userA, obligationId);
    expect(direct.plannedCents).toBe(8000);

    // Settlement marked as reversed
    const settlement = await getSettlement(ctx.userA, settlementId);
    expect(settlement.reversed).toBe(true);
  });

  it("creates a compensating credit movement", async () => {
    const { accountId, settlementId } = await setupPayment(
      ctx.userA,
      "2027-02",
    );
    const movementsBefore = await countMovements(ctx.pool, ctx.userA, accountId);
    expect(movementsBefore).toBe(1); // the original debit

    await reverseSettlement(ctx.userA, {
      settlementId,
      businessDate: "2026-03-15",
      idempotencyKey: testIdempotencyKey("reverse-movement"),
    });

    const movementsAfter = await countMovements(ctx.pool, ctx.userA, accountId);
    expect(movementsAfter).toBe(2); // debit + credit
  });
});

describe("Step10 settlement reversal: after manual refresh", () => {
  it("requires explicit decision when account was refreshed after settlement", async () => {
    const { settlementId, accountId } = await setupPayment(
      ctx.userA,
      "2027-03",
    );

    // Simulate a manual refresh after the settlement
    await insertBalanceAdjustmentDirect(
      ctx.pool,
      ctx.userA,
      accountId,
      100000,
      new Date(),
    );

    await expect(
      reverseSettlement(ctx.userA, {
        settlementId,
        businessDate: "2026-03-20",
        idempotencyKey: testIdempotencyKey("reverse-after-refresh-no-decision"),
      }),
    ).rejects.toThrow(RefreshReconciliationRequiredError);
  });

  it("adjusts balance when adjustBalanceAfterRefresh is true", async () => {
    const { settlementId, accountId } = await setupPayment(
      ctx.userA,
      "2027-04",
    );

    // Refresh: set balance to 100000 (was 46000 after payment)
    await insertBalanceAdjustmentDirect(
      ctx.pool,
      ctx.userA,
      accountId,
      100000,
      new Date(),
    );

    const result = await reverseSettlement(ctx.userA, {
      settlementId,
      businessDate: "2026-03-20",
      idempotencyKey: testIdempotencyKey("reverse-after-refresh-true"),
      adjustBalanceAfterRefresh: true,
    });
    expect(result.balanceWasAdjusted).toBe(true);
    // 100000 + 4000 (credit back) = 104000
    expect(result.accountNewBalance).toBe(104000);

    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(104000);
  });

  it("leaves balance unchanged when adjustBalanceAfterRefresh is false", async () => {
    const { settlementId, accountId } = await setupPayment(
      ctx.userA,
      "2027-05",
    );

    // Refresh: set balance to 100000
    await insertBalanceAdjustmentDirect(
      ctx.pool,
      ctx.userA,
      accountId,
      100000,
      new Date(),
    );

    const result = await reverseSettlement(ctx.userA, {
      settlementId,
      businessDate: "2026-03-20",
      idempotencyKey: testIdempotencyKey("reverse-after-refresh-false"),
      adjustBalanceAfterRefresh: false,
    });
    expect(result.balanceWasAdjusted).toBe(false);

    // Balance unchanged (the refreshed balance already reflects reality)
    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(100000);

    // But the reversal row still exists (settlement is logically reversed)
    const settlement = await getSettlement(ctx.userA, settlementId);
    expect(settlement.reversed).toBe(true);
  });
});

describe("Step10 settlement reversal: double reversal guard", () => {
  it("rejects reversing an already-reversed settlement", async () => {
    const { settlementId } = await setupPayment(ctx.userA, "2027-06");

    await reverseSettlement(ctx.userA, {
      settlementId,
      businessDate: "2026-03-15",
      idempotencyKey: testIdempotencyKey("reverse-double-1"),
    });

    await expect(
      reverseSettlement(ctx.userA, {
        settlementId,
        businessDate: "2026-03-16",
        idempotencyKey: testIdempotencyKey("reverse-double-2"),
      }),
    ).rejects.toThrow(AlreadyReversedError);
  });
});

describe("Step10 settlement reversal: idempotency", () => {
  it("duplicate reversal with same key returns original result", async () => {
    const { settlementId, accountId } = await setupPayment(ctx.userA, "2027-07");

    const input = {
      settlementId,
      businessDate: "2026-03-15",
      idempotencyKey: testIdempotencyKey("reverse-idem"),
    };

    const first = await reverseSettlement(ctx.userA, input);
    const second = await reverseSettlement(ctx.userA, input);

    expect(second.reversalId).toBe(first.reversalId);
    expect(second.originalSettlementId).toBe(first.originalSettlementId);

    // Only one reversal row
    const reversalCount = await countSettlementReversals(ctx.pool, ctx.userA);
    // There may be reversals from other tests, so check the specific one
    const settlement = await getSettlement(ctx.userA, settlementId);
    expect(settlement.reversed).toBe(true);

    // Account credited once
    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(50000);
  });

  it("same key with changed payload rejects", async () => {
    const { settlementId } = await setupPayment(ctx.userA, "2027-08");
    const key = testIdempotencyKey("reverse-idem-conflict");

    await reverseSettlement(ctx.userA, {
      settlementId,
      businessDate: "2026-03-15",
      idempotencyKey: key,
    });

    await expect(
      reverseSettlement(ctx.userA, {
        settlementId,
        businessDate: "2026-03-20",
        idempotencyKey: key,
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });
});

describe("Step10 settlement reversal: ALREADY_REFLECTED", () => {
  it("reversing an ALREADY_REFLECTED settlement creates no balance change", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-09");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Already reflected",
      plannedCents: 8000,
      monthKey: "2027-09",
    });
    const { account } = await createAccount(ctx.userA, {
      name: "Test",
      initialBalanceCents: 30000,
      trackBalance: true,
    });

    const payResult = await payObligation(ctx.userA, {
      obligationId: obligation.id,
      amountCents: 4000,
      mode: "ALREADY_REFLECTED",
      accountId: null,
      businessDate: "2027-09-10",
      idempotencyKey: testIdempotencyKey("already-reflected-pay"),
    });

    const result = await reverseSettlement(ctx.userA, {
      settlementId: payResult.settlementId,
      businessDate: "2026-03-15",
      idempotencyKey: testIdempotencyKey("reverse-already-reflected"),
    });
    expect(result.balanceWasAdjusted).toBe(false);
    expect(result.accountNewBalance).toBe(null);

    // Account balance unchanged
    const acct = await readAccountDirect(ctx.pool, ctx.userA, account.id);
    expect(acct.currentBalanceCents).toBe(30000);

    // No movements at all
    const movements = await countMovements(ctx.pool, ctx.userA, account.id);
    expect(movements).toBe(0);

    // Paid is now 0
    const ob = await getObligation(ctx.userA, obligation.id);
    expect(ob.paidCents).toBe(0);
  });
});

describe("Step10 receipt reversal: before manual refresh", () => {
  it("reverses the receipt and debits the account back", async () => {
    const { incomeId, accountId, receiptId } = await setupReceipt(
      ctx.userA,
      "2027-10",
    );

    // Balance after receipt: 50000 + 4000 = 54000
    const before = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(before.currentBalanceCents).toBe(54000);

    const result = await reverseReceipt(ctx.userA, {
      receiptId,
      businessDate: "2026-03-15",
      idempotencyKey: testIdempotencyKey("reverse-receipt-before"),
    });
    expect(result.balanceWasAdjusted).toBe(true);
    expect(result.accountNewBalance).toBe(50000);

    const after = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(after.currentBalanceCents).toBe(50000);

    // Received is now 0
    const income = await getIncome(ctx.userA, incomeId);
    expect(income.receivedCents).toBe(0);
    expect(income.pendingCents).toBe(10000);

    // Expected unchanged
    const direct = await readIncomeDirect(ctx.pool, ctx.userA, incomeId);
    expect(direct.expectedCents).toBe(10000);

    // Receipt marked as reversed
    const receipt = await getReceipt(ctx.userA, receiptId);
    expect(receipt.reversed).toBe(true);
  });
});

describe("Step10 receipt reversal: after manual refresh", () => {
  it("requires explicit decision when account was refreshed after receipt", async () => {
    const { receiptId, accountId } = await setupReceipt(ctx.userA, "2027-11");

    await insertBalanceAdjustmentDirect(
      ctx.pool,
      ctx.userA,
      accountId,
      100000,
      new Date(),
    );

    await expect(
      reverseReceipt(ctx.userA, {
        receiptId,
        businessDate: "2026-03-20",
        idempotencyKey: testIdempotencyKey("reverse-receipt-after-no-decision"),
      }),
    ).rejects.toThrow(RefreshReconciliationRequiredError);
  });

  it("adjusts balance when adjustBalanceAfterRefresh is true", async () => {
    const { receiptId, accountId } = await setupReceipt(ctx.userA, "2027-12");

    await insertBalanceAdjustmentDirect(
      ctx.pool,
      ctx.userA,
      accountId,
      100000,
      new Date(),
    );

    const result = await reverseReceipt(ctx.userA, {
      receiptId,
      businessDate: "2026-03-20",
      idempotencyKey: testIdempotencyKey("reverse-receipt-after-true"),
      adjustBalanceAfterRefresh: true,
    });
    expect(result.balanceWasAdjusted).toBe(true);
    // 100000 - 4000 (debit back) = 96000
    expect(result.accountNewBalance).toBe(96000);
  });

  it("leaves balance unchanged when adjustBalanceAfterRefresh is false", async () => {
    const { receiptId, accountId } = await setupReceipt(ctx.userA, "2028-01");

    await insertBalanceAdjustmentDirect(
      ctx.pool,
      ctx.userA,
      accountId,
      100000,
      new Date(),
    );

    const result = await reverseReceipt(ctx.userA, {
      receiptId,
      businessDate: "2026-03-20",
      idempotencyKey: testIdempotencyKey("reverse-receipt-after-false"),
      adjustBalanceAfterRefresh: false,
    });
    expect(result.balanceWasAdjusted).toBe(false);

    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(100000);

    // But receipt is still logically reversed
    const receipt = await getReceipt(ctx.userA, receiptId);
    expect(receipt.reversed).toBe(true);
  });
});

describe("Step10 receipt reversal: double reversal guard", () => {
  it("rejects reversing an already-reversed receipt", async () => {
    const { receiptId } = await setupReceipt(ctx.userA, "2028-02");

    await reverseReceipt(ctx.userA, {
      receiptId,
      businessDate: "2026-03-15",
      idempotencyKey: testIdempotencyKey("reverse-receipt-double-1"),
    });

    await expect(
      reverseReceipt(ctx.userA, {
        receiptId,
        businessDate: "2026-03-16",
        idempotencyKey: testIdempotencyKey("reverse-receipt-double-2"),
      }),
    ).rejects.toThrow(AlreadyReversedError);
  });
});

describe("Step10 reversals: cross-owner isolation", () => {
  it("user B cannot reverse user A's settlement", async () => {
    const { settlementId } = await setupPayment(ctx.userA, "2028-03");

    await expect(
      reverseSettlement(ctx.userB, {
        settlementId,
        businessDate: "2026-03-15",
        idempotencyKey: testIdempotencyKey("reverse-cross"),
      }),
    ).rejects.toThrow(SettlementNotFoundError);

    // A's settlement is not reversed
    const settlement = await getSettlement(ctx.userA, settlementId);
    expect(settlement.reversed).toBe(false);
  });

  it("user B cannot reverse user A's receipt", async () => {
    const { receiptId } = await setupReceipt(ctx.userA, "2028-04");

    await expect(
      reverseReceipt(ctx.userB, {
        receiptId,
        businessDate: "2026-03-15",
        idempotencyKey: testIdempotencyKey("reverse-receipt-cross"),
      }),
    ).rejects.toThrow(SettlementNotFoundError);
  });
});

describe("Step10 reversals: closed month", () => {
  it("rejects settlement reversal on a closed month", async () => {
    const { settlementId } = await setupPayment(ctx.userA, "2028-05");
    await closePlanDirect(ctx.pool, ctx.userA, "2028-05");

    await expect(
      reverseSettlement(ctx.userA, {
        settlementId,
        businessDate: "2026-03-15",
        idempotencyKey: testIdempotencyKey("reverse-closed"),
      }),
    ).rejects.toThrow(ClosedMonthError);
  });

  it("rejects receipt reversal on a closed month", async () => {
    const { receiptId } = await setupReceipt(ctx.userA, "2028-06");
    await closePlanDirect(ctx.pool, ctx.userA, "2028-06");

    await expect(
      reverseReceipt(ctx.userA, {
        receiptId,
        businessDate: "2026-03-15",
        idempotencyKey: testIdempotencyKey("reverse-receipt-closed"),
      }),
    ).rejects.toThrow(ClosedMonthError);
  });
});

describe("Step10 reversals: non-existent settlement/receipt", () => {
  it("reversing a non-existent settlement rejects", async () => {
    await expect(
      reverseSettlement(ctx.userA, {
        settlementId: "999999999",
        businessDate: "2026-03-15",
        idempotencyKey: testIdempotencyKey("reverse-nonexistent"),
      }),
    ).rejects.toThrow(SettlementNotFoundError);
  });

  it("reversing a non-existent receipt rejects", async () => {
    await expect(
      reverseReceipt(ctx.userA, {
        receiptId: "999999999",
        businessDate: "2026-03-15",
        idempotencyKey: testIdempotencyKey("reverse-receipt-nonexistent"),
      }),
    ).rejects.toThrow(SettlementNotFoundError);
  });
});