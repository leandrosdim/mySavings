// Step06 balance refresh integration tests.
//
// Tests exercise the real production service layer (lib/accounts/service.ts)
// against disposable step06_* schemas. Key scenarios:
// - Refresh REPLACES (not adds) the current balance.
// - Immutable adjustment audit row with old/new/delta/as-of.
// - Version guard: stale expectedVersion causes a ConflictError.
// - Same-client rollback: a failed refresh leaves balance unchanged.
// - Concurrency: two concurrent refreshes with the same version; one wins,
//   one gets a conflict.
// - Idempotency: retry with same key returns the original result.
// - Idempotency conflict: same key with different payload is rejected.
// - Never-entered balance (null) distinct from explicit zero.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupAccountsSchema,
  teardownAccountsSchema,
  insertAccountDirect,
  readAccountDirect,
  countAdjustments,
  testIdempotencyKey,
  type AccountsTestContext,
} from "./helpers";
import {
  createAccount,
  refreshBalance,
  getAccount,
  archiveAccount,
  ConflictError,
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

describe("Step06 balance refresh: replace not add", () => {
  it("replaces the current balance rather than adding to it", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Replace test",
      initialBalanceCents: 100000,
      trackBalance: true,
    });
    const key = testIdempotencyKey("refresh-replace");
    const result = await refreshBalance(ctx.userA, {
      accountId: account.id,
      newBalanceCents: cents(50000),
      asOf: new Date(),
      expectedVersion: 1,
      idempotencyKey: key,
    });
    expect(result.newBalanceCents).toBe(50000);
    expect(result.previousBalanceCents).toBe(100000);
    expect(result.differenceCents).toBe(-50000);
    expect(result.newVersion).toBe(2);

    const updated = await getAccount(ctx.userA, account.id);
    expect(updated.currentBalanceCents).toBe(50000);
    expect(updated.version).toBe(2);
  });

  it("writes an immutable adjustment audit row", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Audit test",
      initialBalanceCents: 200000,
      trackBalance: true,
    });
    const key = testIdempotencyKey("refresh-audit");
    await refreshBalance(ctx.userA, {
      accountId: account.id,
      newBalanceCents: cents(250000),
      asOf: new Date(),
      expectedVersion: 1,
      idempotencyKey: key,
    });
    const adjCount = await countAdjustments(ctx.pool, ctx.userA, account.id);
    expect(adjCount).toBe(1);
  });

  it("distinguishes never-entered (null) from explicit zero on first refresh", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Never entered",
      initialBalanceCents: null,
      trackBalance: true,
    });
    expect(account.currentBalanceCents).toBe(null);

    const key = testIdempotencyKey("refresh-null-to-zero");
    const result = await refreshBalance(ctx.userA, {
      accountId: account.id,
      newBalanceCents: cents(0),
      asOf: new Date(),
      expectedVersion: 1,
      idempotencyKey: key,
    });
    expect(result.previousBalanceCents).toBe(null);
    expect(result.newBalanceCents).toBe(0);
    expect(result.differenceCents).toBe(0);

    const updated = await getAccount(ctx.userA, account.id);
    expect(updated.currentBalanceCents).toBe(0);
  });

  it("can refresh to a negative balance (overdraft)", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Overdraft refresh",
      initialBalanceCents: 1000,
      trackBalance: true,
    });
    const key = testIdempotencyKey("refresh-negative");
    const result = await refreshBalance(ctx.userA, {
      accountId: account.id,
      newBalanceCents: cents(-5000),
      asOf: new Date(),
      expectedVersion: 1,
      idempotencyKey: key,
    });
    expect(result.newBalanceCents).toBe(-5000);
    expect(result.differenceCents).toBe(-6000);
  });
});

describe("Step06 balance refresh: version guard", () => {
  it("rejects a stale expectedVersion with a ConflictError", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Stale version",
      initialBalanceCents: 10000,
      trackBalance: true,
    });
    // First refresh succeeds, bumps version to 2.
    await refreshBalance(ctx.userA, {
      accountId: account.id,
      newBalanceCents: cents(20000),
      asOf: new Date(),
      expectedVersion: 1,
      idempotencyKey: testIdempotencyKey("stale-first"),
    });
    // Second refresh with the old version 1 should fail.
    await expect(
      refreshBalance(ctx.userA, {
        accountId: account.id,
        newBalanceCents: cents(30000),
        asOf: new Date(),
        expectedVersion: 1,
        idempotencyKey: testIdempotencyKey("stale-second"),
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("ConflictError carries the current version for client retry", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Conflict version info",
      initialBalanceCents: 10000,
      trackBalance: true,
    });
    await refreshBalance(ctx.userA, {
      accountId: account.id,
      newBalanceCents: cents(20000),
      asOf: new Date(),
      expectedVersion: 1,
      idempotencyKey: testIdempotencyKey("conflict-info-first"),
    });
    try {
      await refreshBalance(ctx.userA, {
        accountId: account.id,
        newBalanceCents: cents(30000),
        asOf: new Date(),
        expectedVersion: 1,
        idempotencyKey: testIdempotencyKey("conflict-info-second"),
      });
      expect.fail("Should have thrown ConflictError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).currentVersion).toBe(2);
    }
  });
});

describe("Step06 balance refresh: rollback", () => {
  it("a failed refresh leaves the balance unchanged (same-client rollback)", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Rollback test",
      initialBalanceCents: 42000,
      trackBalance: true,
    });
    // Attempt a refresh with a stale version to trigger a rollback.
    // The balance should remain 42000 and no adjustment should be written.
    await expect(
      refreshBalance(ctx.userA, {
        accountId: account.id,
        newBalanceCents: cents(99000),
        asOf: new Date(),
        expectedVersion: 999,
        idempotencyKey: testIdempotencyKey("rollback-stale"),
      }),
    ).rejects.toThrow();

    const direct = await readAccountDirect(ctx.pool, ctx.userA, account.id);
    expect(direct.currentBalanceCents).toBe(42000);
    expect(direct.version).toBe(1);
    const adjCount = await countAdjustments(ctx.pool, ctx.userA, account.id);
    expect(adjCount).toBe(0);
  });

  it("a refresh on a non-existent account rolls back and throws NotFoundError", async () => {
    await expect(
      refreshBalance(ctx.userA, {
        accountId: "999999999",
        newBalanceCents: cents(1000),
        asOf: new Date(),
        expectedVersion: 1,
        idempotencyKey: testIdempotencyKey("rollback-notfound"),
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("Step06 balance refresh: concurrency", () => {
  it("two concurrent refreshes with the same version: one wins, one conflicts", async () => {
    // Create an account directly with a known starting state.
    const accountId = await insertAccountDirect(ctx.pool, ctx.userA, "Concurrent refresh", 100000);
    const account = await getAccount(ctx.userA, accountId);
    expect(account.version).toBe(1);

    const key1 = testIdempotencyKey("concurrent-a");
    const key2 = testIdempotencyKey("concurrent-b");

    // Fire both refreshes concurrently. Both send expectedVersion=1.
    // The one that commits first wins; the other sees version=2 and fails.
    const results = await Promise.allSettled([
      refreshBalance(ctx.userA, {
        accountId,
        newBalanceCents: cents(110000),
        asOf: new Date(),
        expectedVersion: 1,
        idempotencyKey: key1,
      }),
      refreshBalance(ctx.userA, {
        accountId,
        newBalanceCents: cents(120000),
        asOf: new Date(),
        expectedVersion: 1,
        idempotencyKey: key2,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0]).toMatchObject({ status: "rejected" });
    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejection).toBeInstanceOf(ConflictError);
  });
});

describe("Step06 balance refresh: idempotency", () => {
  it("retried refresh with the same key and payload returns the original result", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Idempotent refresh",
      initialBalanceCents: 30000,
      trackBalance: true,
    });
    const key = testIdempotencyKey("idempotent-retry");
    const asOf = new Date("2026-01-15T10:00:00Z");
    const input = {
      accountId: account.id,
      newBalanceCents: cents(35000),
      asOf,
      expectedVersion: 1,
      idempotencyKey: key,
    };
    const first = await refreshBalance(ctx.userA, input);
    const second = await refreshBalance(ctx.userA, input);
    expect(second.newBalanceCents).toBe(first.newBalanceCents);
    expect(second.previousBalanceCents).toBe(first.previousBalanceCents);
    expect(second.differenceCents).toBe(first.differenceCents);

    // Only one adjustment row should exist.
    const adjCount = await countAdjustments(ctx.pool, ctx.userA, account.id);
    expect(adjCount).toBe(1);
  });

  it("same key with a different payload is rejected", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Idempotency conflict",
      initialBalanceCents: 10000,
      trackBalance: true,
    });
    const key = testIdempotencyKey("idempotent-conflict");
    await refreshBalance(ctx.userA, {
      accountId: account.id,
      newBalanceCents: cents(20000),
      asOf: new Date(),
      expectedVersion: 1,
      idempotencyKey: key,
    });
    await expect(
      refreshBalance(ctx.userA, {
        accountId: account.id,
        newBalanceCents: cents(99999),
        asOf: new Date(),
        expectedVersion: 2,
        idempotencyKey: key,
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });
});

describe("Step06 balance refresh: archived account", () => {
  it("rejects refreshing balance on an archived account", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Archived refresh",
      initialBalanceCents: 0,
      trackBalance: true,
    });
    await archiveAccount(ctx.userA, account.id);
    await expect(
      refreshBalance(ctx.userA, {
        accountId: account.id,
        newBalanceCents: cents(1000),
        asOf: new Date(),
        expectedVersion: 1,
        idempotencyKey: testIdempotencyKey("archived-refresh"),
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("Step06 balance refresh: cross-user isolation", () => {
  it("user A cannot refresh user B's account", async () => {
    const { account: bAccount } = await createAccount(ctx.userB, {
      name: "B's balance",
      initialBalanceCents: 50000,
      trackBalance: true,
    });
    await expect(
      refreshBalance(ctx.userA, {
        accountId: bAccount.id,
        newBalanceCents: cents(0),
        asOf: new Date(),
        expectedVersion: 1,
        idempotencyKey: testIdempotencyKey("cross-refresh"),
      }),
    ).rejects.toThrow(NotFoundError);
  });
});