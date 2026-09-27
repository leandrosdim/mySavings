// Step10 payment (settlement) integration tests.
//
// Tests exercise the real production service layer
// (lib/settlements/service.ts) against disposable step10_* schemas with two
// synthetic users (A and B). No mocking of the business logic; the service
// runs against the real DB.
//
// Key scenarios from the step acceptance criteria:
// - Gas 8000 -> pay 4000 -> pay 4000: remaining 8000 -> 4000 -> 0; planned
//   unchanged.
// - Third payment rejects (overpayment).
// - Concurrent 6000+6000 cannot both settle 8000 (only one succeeds).
// - Duplicate request debits once (idempotency).
// - Changed-payload same key rejects.
// - Rollback fault injection (non-existent account leaves no partial state).
// - UPDATE_ACCOUNT reduces B and E equally; ALREADY_REFLECTED leaves B
//   unchanged.
// - Cross-owner refs rejected.
// - Closed month rejected.
// - Reserve target payment (reserved obligation).
// - Archived account rejected.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupSettlementsSchema,
  teardownSettlementsSchema,
  createPlanDirect,
  closePlanDirect,
  readObligationDirect,
  readAccountDirect,
  countSettlements,
  countMovements,
  testIdempotencyKey,
  type SettlementsTestContext,
} from "./helpers";
import {
  createObligation,
  getObligation,
} from "../../lib/obligations/service";
import {
  createAccount,
  getAccount,
} from "../../lib/accounts/service";
import {
  payObligation,
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

async function makeGasObligation(
  ownerId: string,
  monthKey: string,
  plannedCents = 8000,
): Promise<string> {
  await createPlanDirect(ctx.pool, ownerId, monthKey);
  const { obligation } = await createObligation(ownerId, {
    kind: "ordinary",
    title: "Βενζίνη",
    plannedCents,
    monthKey,
  });
  return obligation.id;
}

async function makeAccount(ownerId: string, balance: number): Promise<string> {
  const { account } = await createAccount(ownerId, {
    name: "Test account",
    initialBalanceCents: balance,
    trackBalance: true,
  });
  return account.id;
}

describe("Step10 payments: gas 8000 -> 4000 -> 4000 -> 0", () => {
  it("pays 4000 then 4000, remaining goes 8000 -> 4000 -> 0, planned unchanged", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2026-03");
    const accountId = await makeAccount(ctx.userA, 50000);

    // First payment: 4000
    const first = await payObligation(ctx.userA, {
      obligationId,
      amountCents: 4000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-03-10",
      idempotencyKey: testIdempotencyKey("gas-pay-1"),
    });
    expect(first.amountCents).toBe(4000);
    expect(first.paidCents).toBe(4000);
    expect(first.remainingCents).toBe(4000);
    expect(first.accountNewBalance).toBe(46000);
    expect(first.reversed).toBe(false);

    // Planned unchanged
    const direct1 = await readObligationDirect(ctx.pool, ctx.userA, obligationId);
    expect(direct1.plannedCents).toBe(8000);

    // Second payment: 4000
    const second = await payObligation(ctx.userA, {
      obligationId,
      amountCents: 4000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-03-11",
      idempotencyKey: testIdempotencyKey("gas-pay-2"),
    });
    expect(second.paidCents).toBe(8000);
    expect(second.remainingCents).toBe(0);
    expect(second.accountNewBalance).toBe(42000);

    // Planned still unchanged
    const direct2 = await readObligationDirect(ctx.pool, ctx.userA, obligationId);
    expect(direct2.plannedCents).toBe(8000);

    // Two settlement rows exist
    const settlementCount = await countSettlements(ctx.pool, ctx.userA, obligationId);
    expect(settlementCount).toBe(2);

    // Two movement rows (one debit per payment)
    const movementCount = await countMovements(ctx.pool, ctx.userA, accountId);
    expect(movementCount).toBe(2);
  });

  it("third payment rejects (overpayment)", async () => {
    // Re-use the obligation from above test (already fully paid)
    const obligationId = await makeGasObligation(ctx.userA, "2026-04");
    const accountId = await makeAccount(ctx.userA, 10000);

    await payObligation(ctx.userA, {
      obligationId,
      amountCents: 8000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-04-01",
      idempotencyKey: testIdempotencyKey("overpay-setup"),
    });

    await expect(
      payObligation(ctx.userA, {
        obligationId,
        amountCents: 1000,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2026-04-02",
        idempotencyKey: testIdempotencyKey("overpay-third"),
      }),
    ).rejects.toThrow(OverpaymentError);
  });

  it("rejects payment exceeding remaining on a partial obligation", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2026-05");
    const accountId = await makeAccount(ctx.userA, 10000);

    await payObligation(ctx.userA, {
      obligationId,
      amountCents: 3000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-05-01",
      idempotencyKey: testIdempotencyKey("partial-pay"),
    });

    // 5000 > 5000 remaining -> reject
    await expect(
      payObligation(ctx.userA, {
        obligationId,
        amountCents: 5001,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2026-05-02",
        idempotencyKey: testIdempotencyKey("overpay-partial"),
      }),
    ).rejects.toThrow(OverpaymentError);
  });
});

describe("Step10 payments: concurrency (overpayment prevention)", () => {
  it("two concurrent 6000 payments cannot both settle an 8000 obligation", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2026-06");
    const accountId = await makeAccount(ctx.userA, 100000);

    const results = await Promise.allSettled([
      payObligation(ctx.userA, {
        obligationId,
        amountCents: 6000,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2026-06-01",
        idempotencyKey: testIdempotencyKey("concurrent-6000-a"),
      }),
      payObligation(ctx.userA, {
        obligationId,
        amountCents: 6000,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2026-06-01",
        idempotencyKey: testIdempotencyKey("concurrent-6000-b"),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // The rejected one must be an OverpaymentError
    if (rejected[0].status === "rejected") {
      expect(rejected[0].reason).toBeInstanceOf(OverpaymentError);
    }

    // Only one settlement row should exist; paid = 6000; remaining = 2000
    const settlementCount = await countSettlements(ctx.pool, ctx.userA, obligationId);
    expect(settlementCount).toBe(1);

    const obligation = await getObligation(ctx.userA, obligationId);
    expect(obligation.paidCents).toBe(6000);
    expect(obligation.remainingCents).toBe(2000);

    // Account debited exactly once (6000)
    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(94000);
  });
});

describe("Step10 payments: idempotency", () => {
  it("duplicate request with same key and payload debits once", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2026-07");
    const accountId = await makeAccount(ctx.userA, 20000);

    const input = {
      obligationId,
      amountCents: 5000,
      mode: "UPDATE_ACCOUNT" as const,
      accountId,
      businessDate: "2026-07-01",
      idempotencyKey: testIdempotencyKey("idem-duplicate"),
    };

    const first = await payObligation(ctx.userA, input);
    const second = await payObligation(ctx.userA, input);

    expect(second.settlementId).toBe(first.settlementId);
    expect(second.paidCents).toBe(first.paidCents);

    // Only one settlement row
    const settlementCount = await countSettlements(ctx.pool, ctx.userA, obligationId);
    expect(settlementCount).toBe(1);

    // Only one movement
    const movementCount = await countMovements(ctx.pool, ctx.userA, accountId);
    expect(movementCount).toBe(1);

    // Balance debited once
    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(15000);
  });

  it("same key with a different payload is rejected", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2026-08");
    const accountId = await makeAccount(ctx.userA, 20000);
    const key = testIdempotencyKey("idem-conflict");

    await payObligation(ctx.userA, {
      obligationId,
      amountCents: 3000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-08-01",
      idempotencyKey: key,
    });

    await expect(
      payObligation(ctx.userA, {
        obligationId,
        amountCents: 5000,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2026-08-01",
        idempotencyKey: key,
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });
});

describe("Step10 payments: rollback fault injection", () => {
  it("payment with a non-existent account leaves no partial state", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2026-09");

    await expect(
      payObligation(ctx.userA, {
        obligationId,
        amountCents: 4000,
        mode: "UPDATE_ACCOUNT",
        accountId: "999999999",
        businessDate: "2026-09-01",
        idempotencyKey: testIdempotencyKey("rollback-nonexistent-acct"),
      }),
    ).rejects.toThrow(SettlementNotFoundError);

    // No settlement row created
    const settlementCount = await countSettlements(ctx.pool, ctx.userA, obligationId);
    expect(settlementCount).toBe(0);

    // Obligation paid is still 0
    const obligation = await getObligation(ctx.userA, obligationId);
    expect(obligation.paidCents).toBe(0);
  });

  it("payment on a non-existent obligation rejects and leaves no settlement", async () => {
    const accountId = await makeAccount(ctx.userA, 20000);

    await expect(
      payObligation(ctx.userA, {
        obligationId: "999999999",
        amountCents: 4000,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2026-09-01",
        idempotencyKey: testIdempotencyKey("rollback-nonexistent-oblig"),
      }),
    ).rejects.toThrow(SettlementNotFoundError);

    // Account balance unchanged
    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(20000);
  });
});

describe("Step10 payments: UPDATE_ACCOUNT vs ALREADY_REFLECTED", () => {
  it("UPDATE_ACCOUNT reduces account balance and creates a movement", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2026-10");
    const accountId = await makeAccount(ctx.userA, 30000);

    const result = await payObligation(ctx.userA, {
      obligationId,
      amountCents: 2000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-10-01",
      idempotencyKey: testIdempotencyKey("update-acct"),
    });
    expect(result.accountNewBalance).toBe(28000);

    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(28000);

    const movements = await countMovements(ctx.pool, ctx.userA, accountId);
    expect(movements).toBe(1);
  });

  it("ALREADY_REFLECTED does not change account balance and creates no movement", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2026-11");
    const accountId = await makeAccount(ctx.userA, 30000);

    const result = await payObligation(ctx.userA, {
      obligationId,
      amountCents: 2000,
      mode: "ALREADY_REFLECTED",
      accountId: null,
      businessDate: "2026-11-01",
      idempotencyKey: testIdempotencyKey("already-reflected"),
    });
    expect(result.accountNewBalance).toBe(null);
    expect(result.mode).toBe("ALREADY_REFLECTED");

    // Balance unchanged
    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(30000);

    // No movement created
    const movements = await countMovements(ctx.pool, ctx.userA, accountId);
    expect(movements).toBe(0);

    // Paid still tracked
    const obligation = await getObligation(ctx.userA, obligationId);
    expect(obligation.paidCents).toBe(2000);
    expect(obligation.remainingCents).toBe(6000);
  });

  it("UPDATE_ACCOUNT from a never-set balance results in negative balance", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2026-12");
    const { account } = await createAccount(ctx.userA, {
      name: "Never set",
      initialBalanceCents: null,
      trackBalance: true,
    });

    const result = await payObligation(ctx.userA, {
      obligationId,
      amountCents: 2000,
      mode: "UPDATE_ACCOUNT",
      accountId: account.id,
      businessDate: "2026-12-01",
      idempotencyKey: testIdempotencyKey("never-set-pay"),
    });
    expect(result.accountNewBalance).toBe(-2000);
  });
});

describe("Step10 payments: validation", () => {
  it("rejects zero amount", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2027-01");
    const accountId = await makeAccount(ctx.userA, 10000);
    await expect(
      payObligation(ctx.userA, {
        obligationId,
        amountCents: 0,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2027-01-01",
        idempotencyKey: testIdempotencyKey("zero-pay"),
      }),
    ).rejects.toThrow(SettlementValidationError);
  });

  it("rejects negative amount", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2027-02");
    const accountId = await makeAccount(ctx.userA, 10000);
    await expect(
      payObligation(ctx.userA, {
        obligationId,
        amountCents: -1000,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "2027-02-01",
        idempotencyKey: testIdempotencyKey("neg-pay"),
      }),
    ).rejects.toThrow(SettlementValidationError);
  });

  it("rejects UPDATE_ACCOUNT without an account", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2027-03");
    await expect(
      payObligation(ctx.userA, {
        obligationId,
        amountCents: 1000,
        mode: "UPDATE_ACCOUNT",
        accountId: null,
        businessDate: "2027-03-01",
        idempotencyKey: testIdempotencyKey("no-acct"),
      }),
    ).rejects.toThrow(SettlementValidationError);
  });

  it("rejects invalid business date", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2027-04");
    const accountId = await makeAccount(ctx.userA, 10000);
    await expect(
      payObligation(ctx.userA, {
        obligationId,
        amountCents: 1000,
        mode: "UPDATE_ACCOUNT",
        accountId,
        businessDate: "invalid",
        idempotencyKey: testIdempotencyKey("bad-date"),
      }),
    ).rejects.toThrow(SettlementValidationError);
  });

  it("rejects archived account", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2027-05");
    // Create an account with zero balance, then archive it
    const { account: zeroAccount } = await createAccount(ctx.userA, {
      name: "To archive",
      initialBalanceCents: 0,
      trackBalance: true,
    });
    const { archiveAccount } = await import("../../lib/accounts/service");
    await archiveAccount(ctx.userA, zeroAccount.id);

    await expect(
      payObligation(ctx.userA, {
        obligationId,
        amountCents: 1000,
        mode: "UPDATE_ACCOUNT",
        accountId: zeroAccount.id,
        businessDate: "2027-05-01",
        idempotencyKey: testIdempotencyKey("archived-acct"),
      }),
    ).rejects.toThrow(SettlementValidationError);
  });
});

describe("Step10 payments: closed month", () => {
  it("rejects payment on a closed month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-07");
    const { obligation: ob2 } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "To be closed",
      plannedCents: 5000,
      monthKey: "2027-07",
    });
    const acct2 = await makeAccount(ctx.userA, 10000);
    await closePlanDirect(ctx.pool, ctx.userA, "2027-07");
    await closePlanDirect(ctx.pool, ctx.userA, "2027-07");

    await expect(
      payObligation(ctx.userA, {
        obligationId: ob2.id,
        amountCents: 1000,
        mode: "UPDATE_ACCOUNT",
        accountId: acct2,
        businessDate: "2027-07-01",
        idempotencyKey: testIdempotencyKey("closed-month"),
      }),
    ).rejects.toThrow(ClosedMonthError);
  });
});

describe("Step10 payments: cross-owner isolation", () => {
  it("user B cannot pay user A's obligation", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2027-08");
    const bAccount = await makeAccount(ctx.userB, 10000);

    await expect(
      payObligation(ctx.userB, {
        obligationId,
        amountCents: 1000,
        mode: "UPDATE_ACCOUNT",
        accountId: bAccount,
        businessDate: "2027-08-01",
        idempotencyKey: testIdempotencyKey("cross-pay"),
      }),
    ).rejects.toThrow(SettlementNotFoundError);

    // A's obligation paid is still 0
    const obligation = await getObligation(ctx.userA, obligationId);
    expect(obligation.paidCents).toBe(0);
  });

  it("user A cannot pay using user B's account", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2027-09");
    const bAccount = await makeAccount(ctx.userB, 10000);

    await expect(
      payObligation(ctx.userA, {
        obligationId,
        amountCents: 1000,
        mode: "UPDATE_ACCOUNT",
        accountId: bAccount,
        businessDate: "2027-09-01",
        idempotencyKey: testIdempotencyKey("cross-acct"),
      }),
    ).rejects.toThrow(SettlementNotFoundError);

    // B's account balance unchanged
    const acct = await readAccountDirect(ctx.pool, ctx.userB, bAccount);
    expect(acct.currentBalanceCents).toBe(10000);
  });
});

describe("Step10 payments: reserve target", () => {
  it("paying a reserved obligation reduces its outstanding amount", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-10");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Φόρος",
      plannedCents: 10000,
      monthKey: "2027-10",
    });
    const accountId = await makeAccount(ctx.userA, 50000);

    const result = await payObligation(ctx.userA, {
      obligationId: reserve.id,
      amountCents: 4000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2027-10-01",
      idempotencyKey: testIdempotencyKey("reserve-pay"),
    });
    expect(result.paidCents).toBe(4000);
    expect(result.remainingCents).toBe(6000);

    // Planned unchanged
    const direct = await readObligationDirect(ctx.pool, ctx.userA, reserve.id);
    expect(direct.plannedCents).toBe(10000);

    // Account debited
    const acct = await readAccountDirect(ctx.pool, ctx.userA, accountId);
    expect(acct.currentBalanceCents).toBe(46000);
  });
});

describe("Step10 payments: paid/remaining derivation after multiple payments", () => {
  it("getObligation reflects paid from non-reversed settlements only", async () => {
    const obligationId = await makeGasObligation(ctx.userA, "2027-11", 10000);
    const accountId = await makeAccount(ctx.userA, 100000);

    await payObligation(ctx.userA, {
      obligationId,
      amountCents: 3000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2027-11-01",
      idempotencyKey: testIdempotencyKey("multi-1"),
    });
    await payObligation(ctx.userA, {
      obligationId,
      amountCents: 2000,
      mode: "ALREADY_REFLECTED",
      accountId: null,
      businessDate: "2027-11-02",
      idempotencyKey: testIdempotencyKey("multi-2"),
    });

    const obligation = await getObligation(ctx.userA, obligationId);
    expect(obligation.paidCents).toBe(5000);
    expect(obligation.remainingCents).toBe(5000);
    expect(obligation.plannedCents).toBe(10000);
  });
});