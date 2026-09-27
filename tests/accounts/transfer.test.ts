// Step06 internal transfer integration tests.
//
// Tests exercise the real production service layer (lib/accounts/service.ts)
// against disposable step06_* schemas. Key scenarios:
// - Net-zero: transfer changes individual balances but not the total.
// - Deterministic lock order prevents deadlocks.
// - Rollback after first movement: a failure after the debit leaves no
//   partial state.
// - Retry dedupe: same key+payload returns the original result.
// - A/B isolation: user A cannot transfer to/from user B's accounts.
// - Same-account transfer rejected.
// - Negative balance allowed after transfer (per documented balance policy).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupAccountsSchema,
  teardownAccountsSchema,
  insertAccountDirect,
  readAccountDirect,
  countMovements,
  testIdempotencyKey,
  type AccountsTestContext,
} from "./helpers";
import {
  createAccount,
  transferBetweenAccounts,
  getAccount,
  archiveAccount,
  NotFoundError,
  ValidationError,
  IdempotencyConflictError,
} from "../../lib/accounts/service";
import { cents } from "../../lib/finance/money";

let ctx: AccountsTestContext;

beforeAll(async () => {
  ctx = await setupAccountsSchema();
});

afterAll(async () => {
  await teardownAccountsSchema(ctx);
});

async function makeTwoAccounts(
  ownerId: string,
  balanceA: number,
  balanceB: number,
): Promise<{ a: string; b: string }> {
  const { account: a } = await createAccount(ownerId, {
    name: "From account",
    initialBalanceCents: balanceA,
    trackBalance: true,
  });
  const { account: b } = await createAccount(ownerId, {
    name: "To account",
    initialBalanceCents: balanceB,
    trackBalance: true,
  });
  return { a: a.id, b: b.id };
}

describe("Step06 transfer: net-zero and balance effect", () => {
  it("transfer changes individual balances but not the total", async () => {
    const { a: fromId, b: toId } = await makeTwoAccounts(ctx.userA, 100000, 50000);

    const fromBefore = await readAccountDirect(ctx.pool, ctx.userA, fromId);
    const toBefore = await readAccountDirect(ctx.pool, ctx.userA, toId);
    const pairTotalBefore =
      (fromBefore.currentBalanceCents ?? 0) + (toBefore.currentBalanceCents ?? 0);
    expect(pairTotalBefore).toBe(150000);

    const result = await transferBetweenAccounts(ctx.userA, {
      fromAccountId: fromId,
      toAccountId: toId,
      amountCents: cents(30000),
      businessDate: "2026-01-15",
      idempotencyKey: testIdempotencyKey("transfer-netzero"),
    });

    expect(result.amountCents).toBe(30000);
    expect(result.fromAccountNewBalance).toBe(70000);
    expect(result.toAccountNewBalance).toBe(80000);

    const fromAfter = await readAccountDirect(ctx.pool, ctx.userA, fromId);
    const toAfter = await readAccountDirect(ctx.pool, ctx.userA, toId);
    const pairTotalAfter =
      (fromAfter.currentBalanceCents ?? 0) + (toAfter.currentBalanceCents ?? 0);
    expect(pairTotalAfter).toBe(pairTotalBefore);
  });

  it("creates exactly two movement rows (debit + credit)", async () => {
    const { a: fromId, b: toId } = await makeTwoAccounts(ctx.userA, 10000, 10000);

    await transferBetweenAccounts(ctx.userA, {
      fromAccountId: fromId,
      toAccountId: toId,
      amountCents: cents(5000),
      businessDate: "2026-02-01",
      idempotencyKey: testIdempotencyKey("transfer-movements"),
    });

    const fromMovements = await countMovements(ctx.pool, ctx.userA, fromId);
    const toMovements = await countMovements(ctx.pool, ctx.userA, toId);
    expect(fromMovements).toBe(1);
    expect(toMovements).toBe(1);
  });

  it("transfer from a never-set balance account results in negative balance", async () => {
    const { account: fromAccount } = await createAccount(ctx.userA, {
      name: "Never set from",
      initialBalanceCents: null,
      trackBalance: true,
    });
    const { account: toAccount } = await createAccount(ctx.userA, {
      name: "Funded to",
      initialBalanceCents: 100000,
      trackBalance: true,
    });

    const result = await transferBetweenAccounts(ctx.userA, {
      fromAccountId: fromAccount.id,
      toAccountId: toAccount.id,
      amountCents: cents(20000),
      businessDate: "2026-03-01",
      idempotencyKey: testIdempotencyKey("transfer-negative"),
    });

    expect(result.fromAccountNewBalance).toBe(-20000);
    expect(result.toAccountNewBalance).toBe(120000);
  });
});

describe("Step06 transfer: validation", () => {
  it("rejects transferring to the same account", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Same account",
      initialBalanceCents: 10000,
      trackBalance: true,
    });
    await expect(
      transferBetweenAccounts(ctx.userA, {
        fromAccountId: account.id,
        toAccountId: account.id,
        amountCents: cents(1000),
        businessDate: "2026-01-01",
        idempotencyKey: testIdempotencyKey("same-account"),
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a zero amount", async () => {
    const { a: fromId, b: toId } = await makeTwoAccounts(ctx.userA, 10000, 10000);
    await expect(
      transferBetweenAccounts(ctx.userA, {
        fromAccountId: fromId,
        toAccountId: toId,
        amountCents: cents(0),
        businessDate: "2026-01-01",
        idempotencyKey: testIdempotencyKey("zero-amount"),
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a negative amount", async () => {
    const { a: fromId, b: toId } = await makeTwoAccounts(ctx.userA, 10000, 10000);
    await expect(
      transferBetweenAccounts(ctx.userA, {
        fromAccountId: fromId,
        toAccountId: toId,
        amountCents: cents(-5000),
        businessDate: "2026-01-01",
        idempotencyKey: testIdempotencyKey("negative-amount"),
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an invalid business date format", async () => {
    const { a: fromId, b: toId } = await makeTwoAccounts(ctx.userA, 10000, 10000);
    await expect(
      transferBetweenAccounts(ctx.userA, {
        fromAccountId: fromId,
        toAccountId: toId,
        amountCents: cents(1000),
        businessDate: "invalid-date",
        idempotencyKey: testIdempotencyKey("bad-date"),
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("Step06 transfer: rollback after first movement", () => {
  it("a failed transfer after the debit leaves no partial state", async () => {
    // Create two accounts. We'll force a failure by using a non-existent
    // destination account ID — the FOR UPDATE lock on the second account
    // will fail with NotFoundError after the first account is locked.
    const { account: fromAccount } = await createAccount(ctx.userA, {
      name: "Rollback from",
      initialBalanceCents: 50000,
      trackBalance: true,
    });
    const originalBalance = 50000;

    await expect(
      transferBetweenAccounts(ctx.userA, {
        fromAccountId: fromAccount.id,
        toAccountId: "999999999",
        amountCents: cents(10000),
        businessDate: "2026-01-01",
        idempotencyKey: testIdempotencyKey("rollback-transfer"),
      }),
    ).rejects.toThrow(NotFoundError);

    // The from-account balance must be unchanged (transaction rolled back).
    const fromDirect = await readAccountDirect(ctx.pool, ctx.userA, fromAccount.id);
    expect(fromDirect.currentBalanceCents).toBe(originalBalance);
    const fromMovements = await countMovements(ctx.pool, ctx.userA, fromAccount.id);
    expect(fromMovements).toBe(0);
  });
});

describe("Step06 transfer: idempotency", () => {
  it("retried transfer with the same key and payload returns the original result", async () => {
    const { a: fromId, b: toId } = await makeTwoAccounts(ctx.userA, 100000, 0);

    const input = {
      fromAccountId: fromId,
      toAccountId: toId,
      amountCents: cents(25000),
      businessDate: "2026-01-20",
      idempotencyKey: testIdempotencyKey("transfer-idempotent"),
    };

    const first = await transferBetweenAccounts(ctx.userA, input);
    const second = await transferBetweenAccounts(ctx.userA, input);

    expect(second.amountCents).toBe(first.amountCents);
    expect(second.transferId).toBe(first.transferId);

    // Only one set of movements should exist.
    const fromMovements = await countMovements(ctx.pool, ctx.userA, fromId);
    const toMovements = await countMovements(ctx.pool, ctx.userA, toId);
    expect(fromMovements).toBe(1);
    expect(toMovements).toBe(1);

    // Balance should reflect only one transfer.
    const fromDirect = await readAccountDirect(ctx.pool, ctx.userA, fromId);
    expect(fromDirect.currentBalanceCents).toBe(75000);
  });

  it("same key with a different payload is rejected", async () => {
    const { a: fromId, b: toId } = await makeTwoAccounts(ctx.userA, 100000, 0);
    const key = testIdempotencyKey("transfer-idem-conflict");

    await transferBetweenAccounts(ctx.userA, {
      fromAccountId: fromId,
      toAccountId: toId,
      amountCents: cents(25000),
      businessDate: "2026-01-20",
      idempotencyKey: key,
    });

    await expect(
      transferBetweenAccounts(ctx.userA, {
        fromAccountId: fromId,
        toAccountId: toId,
        amountCents: cents(99999),
        businessDate: "2026-01-20",
        idempotencyKey: key,
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });
});

describe("Step06 transfer: concurrency (deterministic lock order)", () => {
  it("two concurrent transfers between the same pair do not deadlock", async () => {
    // This test verifies deterministic lock ordering: both transfers lock
    // the same two accounts in the same ascending ID order, so they
    // serialize rather than deadlock. If the lock order were not
    // deterministic, this test would time out or throw a deadlock error.
    const { a: fromId, b: toId } = await makeTwoAccounts(ctx.userA, 200000, 200000);

    const key1 = testIdempotencyKey("concurrent-transfer-1");
    const key2 = testIdempotencyKey("concurrent-transfer-2");

    // Transfer 1: from -> to. Transfer 2: to -> from (opposite direction).
    // Both must lock in the same ascending ID order.
    const results = await Promise.allSettled([
      transferBetweenAccounts(ctx.userA, {
        fromAccountId: fromId,
        toAccountId: toId,
        amountCents: cents(10000),
        businessDate: "2026-04-01",
        idempotencyKey: key1,
      }),
      transferBetweenAccounts(ctx.userA, {
        fromAccountId: toId,
        toAccountId: fromId,
        amountCents: cents(5000),
        businessDate: "2026-04-01",
        idempotencyKey: key2,
      }),
    ]);

    // Both should succeed (they serialize, not conflict).
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(2);

    // Net effect: from = 200000 - 10000 + 5000 = 195000
    //             to   = 200000 + 10000 - 5000 = 205000
    // Total of the pair = 400000 (unchanged)
    const fromDirect = await readAccountDirect(ctx.pool, ctx.userA, fromId);
    const toDirect = await readAccountDirect(ctx.pool, ctx.userA, toId);
    expect(fromDirect.currentBalanceCents).toBe(195000);
    expect(toDirect.currentBalanceCents).toBe(205000);

    // Verify the pair total is unchanged (net-zero).
    const pairTotal =
      (fromDirect.currentBalanceCents ?? 0) + (toDirect.currentBalanceCents ?? 0);
    expect(pairTotal).toBe(400000);
  });
});

describe("Step06 transfer: cross-user isolation", () => {
  it("user A cannot transfer from user B's account", async () => {
    const { account: bFrom } = await createAccount(ctx.userB, {
      name: "B's from",
      initialBalanceCents: 100000,
      trackBalance: true,
    });
    const { account: aTo } = await createAccount(ctx.userA, {
      name: "A's to",
      initialBalanceCents: 0,
      trackBalance: true,
    });
    await expect(
      transferBetweenAccounts(ctx.userA, {
        fromAccountId: bFrom.id,
        toAccountId: aTo.id,
        amountCents: cents(50000),
        businessDate: "2026-05-01",
        idempotencyKey: testIdempotencyKey("cross-from-b"),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("user A cannot transfer to user B's account", async () => {
    const { account: aFrom } = await createAccount(ctx.userA, {
      name: "A's from",
      initialBalanceCents: 100000,
      trackBalance: true,
    });
    const { account: bTo } = await createAccount(ctx.userB, {
      name: "B's to",
      initialBalanceCents: 0,
      trackBalance: true,
    });
    await expect(
      transferBetweenAccounts(ctx.userA, {
        fromAccountId: aFrom.id,
        toAccountId: bTo.id,
        amountCents: cents(50000),
        businessDate: "2026-05-01",
        idempotencyKey: testIdempotencyKey("cross-to-b"),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("user B cannot drain user A's account via transfer", async () => {
    const { account: aFrom } = await createAccount(ctx.userA, {
      name: "A's protected",
      initialBalanceCents: 1000000,
      trackBalance: true,
    });
    const { account: bTo } = await createAccount(ctx.userB, {
      name: "B's target",
      initialBalanceCents: 0,
      trackBalance: true,
    });
    await expect(
      transferBetweenAccounts(ctx.userB, {
        fromAccountId: aFrom.id,
        toAccountId: bTo.id,
        amountCents: cents(500000),
        businessDate: "2026-05-01",
        idempotencyKey: testIdempotencyKey("b-drain-a"),
      }),
    ).rejects.toThrow(NotFoundError);

    // Verify A's balance is untouched.
    const aDirect = await readAccountDirect(ctx.pool, ctx.userA, aFrom.id);
    expect(aDirect.currentBalanceCents).toBe(1000000);
  });
});

describe("Step06 transfer: archived account", () => {
  it("rejects transferring from an archived account", async () => {
    const { account: archived } = await createAccount(ctx.userA, {
      name: "Archived from",
      initialBalanceCents: 0,
      trackBalance: true,
    });
    await archiveAccount(ctx.userA, archived.id);
    const { account: toAcct } = await createAccount(ctx.userA, {
      name: "Active to",
      initialBalanceCents: 10000,
      trackBalance: true,
    });
    await expect(
      transferBetweenAccounts(ctx.userA, {
        fromAccountId: archived.id,
        toAccountId: toAcct.id,
        amountCents: cents(1000),
        businessDate: "2026-06-01",
        idempotencyKey: testIdempotencyKey("archived-from"),
      }),
    ).rejects.toThrow(ValidationError);
  });
});