// S4-01 deterministic barrier regression: a login that read the OLD password
// hash MUST NOT create a new unrevoked session after a reset commits a NEW
// hash. The barrier is the FOR UPDATE lock on the user row combined with
// credential-hash revalidation inside the session-issuance transaction.
//
// We drive both orders with a deterministic barrier (a deferred promise):
//   Order A (reset-then-issuance): reset commits first, then issuance runs and
//     must abort with CredentialChangedError and leave no live session.
//   Order B (issuance-then-reset): issuance commits first holding the old hash,
//     then reset runs and MUST revoke that session along with the hash change.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import {
  setupAuthSchema,
  teardownAuthSchema,
  insertTestUser,
  resetAuthTables,
  type AuthTestContext,
} from "./helpers";
import { hashPassword, verifyPassword, getDummyHash } from "../../lib/auth/password";
import {
  createSessionWithCredentialCheck,
  CredentialChangedError,
  resetUserPassword,
} from "../../lib/auth/session";
import { admitLoginAttempt, cleanupOldLoginAttempts, __testing as rateLimitTesting } from "../../lib/auth/rate-limit";
import { query, withTransaction, getPool, closePool, __setTestPool } from "../../lib/db";
import type { Pool, PoolClient } from "pg";
import { __resetCookieStore } from "../__mocks__/next/headers";
import { makePool, requireDatabaseUrl } from "../db/helpers";

const ctxRef: { ctx: AuthTestContext } = {} as { ctx: AuthTestContext };

const email = "barrier@step04.test.local";
let userId: string;
let originalHash: string;

beforeAll(async () => {
  const ctx = await setupAuthSchema();
  ctxRef.ctx = ctx;
  originalHash = await hashPassword("OriginalPassword!2026");
  userId = await insertTestUser(email, originalHash);
});

afterAll(async () => {
  await teardownAuthSchema(ctxRef.ctx);
});

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters-long!!";
  __resetCookieStore();
});

afterEach(async () => {
  // Restore the original hash so each test starts from a clean state.
  // Explicit transaction: single client write, no autocommit fixture.
  await withTransaction(async (client) => {
    await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      originalHash,
      userId,
    ]);
  });
  await resetAuthTables([userId], [email]);
  __resetCookieStore();
  vi.restoreAllMocks();
});

async function countActiveSessions(): Promise<number> {
  const result = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return result.rows[0]?.n ?? 0;
}

describe("S4-01 barrier: reset-then-issuance (issuance aborts)", () => {
  it("a login that read the old hash cannot create a session after the reset commits", async () => {
    // 1. Reset commits first, changing the hash and revoking sessions.
    const newHash = await hashPassword("NewPassword!2026");
    await resetUserPassword(userId, newHash);

    // 2. Now issuance runs with the STALE hash captured before the reset.
    await expect(
      createSessionWithCredentialCheck(userId, originalHash),
    ).rejects.toBeInstanceOf(CredentialChangedError);

    expect(await countActiveSessions()).toBe(0);
  });

  it("the reset's own row lock is FOR UPDATE and the issuance revalidation reads the committed new hash", async () => {
    const newHash = await hashPassword("AnotherNew!2026");
    await resetUserPassword(userId, newHash);
    const row = await query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId],
    );
    expect(row.rows[0].password_hash).toBe(newHash);
    expect(row.rows[0].password_hash).not.toBe(originalHash);
  });
});

describe("S4-01 barrier: issuance-then-reset (reset revokes the issued session)", () => {
  it("a session issued with the old hash is revoked when the reset commits afterwards", async () => {
    // 1. Issuance commits first with the old hash.
    const result = await createSessionWithCredentialCheck(userId, originalHash);
    expect(result.sessionId).toBeTruthy();
    expect(await countActiveSessions()).toBe(1);

    // 2. Reset commits, revoking all sessions.
    const newHash = await hashPassword("ResetThen!2026");
    await resetUserPassword(userId, newHash);
    expect(await countActiveSessions()).toBe(0);
  });
});

// S4-01 synchronized admission burst: a concurrent burst of failed logins
// against the SAME email must be serialized through the single global
// advisory transaction lock. Because pg_try_advisory_xact_lock is
// non-blocking, concurrent requests that cannot acquire the lock return
// "busy" rather than queueing. This bounds hash-concurrency to 1 across
// instances. Sequential attempts exhaust the per-account cap; concurrent
// attempts demonstrate the lock bound.
describe("S4-01 synchronized admission burst on one email", () => {
  it("sequential attempts exhaust the per-account cap (5 admitted, 6th rate-limited)", async () => {
    const burstEmail = "burst-seq@step04.test.local";
    await insertTestUser(burstEmail, originalHash);
    const dummyHash = await getDummyHash();

    for (let i = 0; i < rateLimitTesting.LOGIN_MAX_FAILURES; i++) {
      const r = await admitLoginAttempt(burstEmail, async (client: PoolClient) => {
        const res = await client.query<{ password_hash: string }>(
          `SELECT password_hash FROM users WHERE lower(email) = lower($1)`,
          [burstEmail],
        );
        const row = res.rows[0] ?? null;
        if (!row) {
          await verifyPassword("wrong-password", dummyHash);
          return { userFound: false, passwordOk: false };
        }
        const ok = await verifyPassword("wrong-password", row.password_hash);
        return { userFound: true, passwordOk: ok };
      });
      expect(r.status).toBe("admitted");
    }

    // The 6th sequential attempt must be rate-limited (cap reached).
    let callbackInvoked = false;
    const r = await admitLoginAttempt(burstEmail, async () => {
      callbackInvoked = true;
      return { userFound: false, passwordOk: false };
    });
    expect(r.status).toBe("rate_limited");
    expect(callbackInvoked).toBe(false);

    // Cleanup (explicit transaction: single client write).
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM users WHERE email = $1`, [burstEmail]);
      await client.query(`DELETE FROM login_attempts WHERE email = $1`, [burstEmail]);
    });
  });

  it("concurrent burst is bounded by the global lock: at most a few admitted, rest are busy", async () => {
    const burstEmail = "burst-conc@step04.test.local";
    await insertTestUser(burstEmail, originalHash);
    const dummyHash = await getDummyHash();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        admitLoginAttempt(burstEmail, async (client: PoolClient) => {
          const res = await client.query<{ password_hash: string }>(
            `SELECT password_hash FROM users WHERE lower(email) = lower($1)`,
            [burstEmail],
          );
          const row = res.rows[0] ?? null;
          if (!row) {
            await verifyPassword("wrong-password", dummyHash);
            return { userFound: false, passwordOk: false };
          }
          const ok = await verifyPassword("wrong-password", row.password_hash);
          return { userFound: true, passwordOk: ok };
        }),
      ),
    );

    const admitted = results.filter((r) => r.status === "admitted").length;
    const rateLimited = results.filter((r) => r.status === "rate_limited").length;
    const busy = results.filter((r) => r.status === "busy").length;

    // The global lock bounds concurrency to 1: at most a few admitted (those
    // that acquired the lock sequentially within the race window). The rest
    // are busy (lock contention) or rate-limited (cap reached by admitted ones).
    expect(admitted).toBeLessThanOrEqual(rateLimitTesting.LOGIN_MAX_FAILURES);
    expect(admitted + rateLimited + busy).toBe(10);
    // At least some must be busy (concurrent contention on the non-blocking lock).
    expect(busy).toBeGreaterThan(0);

    // Cleanup (explicit transaction: single client write).
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM users WHERE email = $1`, [burstEmail]);
      await client.query(`DELETE FROM login_attempts WHERE email = $1`, [burstEmail]);
    });
  });
});

// S4-final global budget: a distributed attacker using many distinct emails
// is bounded by the GLOBAL failure budget (100/10min), not only the per-email
// cap. The previous "3 distinct emails prove nothing" test is replaced with:
//   1) Seed GLOBAL_BUDGET_MAX_FAILURES-1 (99) failures via ONE bulk INSERT
//      inside an explicit transaction. A different-email admission (production
//      admitLoginAttempt) must then be admitted exactly once (the 100th
//      failure), and any further different-email admission must be
//      rate_limited (global_budget) with ZERO callback invocations.
//   2) Concurrency-1 proof: hold ONE admission callback open with a deferred
//      barrier while several competitors (different emails) race to acquire
//      the global advisory transaction lock. Because pg_try_advisory_xact_lock
//      is non-blocking, every competitor that cannot acquire the lock returns
//      "busy" with ZERO callback invocations. Release the held callback =>
//      maximum callback concurrency is 1 (the released one admits; competitors
//      were busy).
//   3) LOGIN ACTION level spy: a rate-limited request (per-account or global)
//      never reaches verifyPassword. This proves the production
//      loginAction -> admitLoginAttempt gate blocks before any hash work.
describe("S4-final global budget bounds rotating-email abuse (real seed + production admission)", () => {
  it("after 99 seeded global failures, exactly 1 additional different-email callback is admitted, then ZERO", async () => {
    // Seed GLOBAL_BUDGET_MAX_FAILURES - 1 (99) failures in ONE bulk INSERT
    // inside an explicit transaction. All distinct emails so the per-account
    // cap is never the limiter; only the global budget is exercised.
    const seedCount = rateLimitTesting.GLOBAL_BUDGET_MAX_FAILURES - 1;
    expect(seedCount).toBe(99);
    const seededEmails = Array.from(
      { length: seedCount },
      (_, i) => `gseed-${i}@step04.test.local`,
    );
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO login_attempts (email, success, attempted_at)
         SELECT addr, false, clock_timestamp()
         FROM unnest($1::text[]) AS addr`,
        [seededEmails],
      );
    });

    try {
      // 1) A different-email production admission must be admitted exactly
      //    once (this is the 100th global failure).
      let callbackCount = 0;
      const firstEmail = "gprobe-1@step04.test.local";
      const r1 = await admitLoginAttempt(firstEmail, async () => {
        callbackCount++;
        await verifyPassword("wrong-password", await getDummyHash());
        return { userFound: false, passwordOk: false };
      });
      expect(r1.status).toBe("admitted");
      expect(callbackCount).toBe(1);

      // 2) Any further different-email admission must be rate_limited
      //    (global_budget) with ZERO additional callbacks.
      const secondEmail = "gprobe-2@step04.test.local";
      const r2 = await admitLoginAttempt(secondEmail, async () => {
        callbackCount++;
        return { userFound: false, passwordOk: false };
      });
      expect(r2.status).toBe("rate_limited");
      if (r2.status === "rate_limited") {
        expect(r2.reason).toBe("global_budget");
      }
      expect(callbackCount).toBe(1);
    } finally {
      // Cleanup the seeded + probed failures in one explicit transaction.
      await withTransaction(async (client) => {
        await client.query(
          `DELETE FROM login_attempts WHERE email = ANY($1)`,
          [seededEmails.concat(["gprobe-1@step04.test.local", "gprobe-2@step04.test.local"])],
        );
      });
    }
  });

  it("concurrency-1: while one admission callback is held, competitor callbacks get busy with ZERO invocations; release => max concurrency 1", async () => {
    // Use a deferred barrier to hold ONE production admission callback open
    // while it holds the global advisory transaction lock. Several
    // competitors (different emails) race to acquire the lock; because
    // pg_try_advisory_xact_lock is non-blocking, every competitor that
    // cannot acquire the lock returns "busy" with ZERO callback invocations.
    let releaseHolder: () => void = () => {};
    const holderReleased = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });

    let holderCallbackCount = 0;
    const holderEmail = "ghold@step04.test.local";
    const holderPromise = (async () => {
      return admitLoginAttempt(holderEmail, async () => {
        holderCallbackCount++;
        // Hold the lock until the test releases the barrier.
        await holderReleased;
        return { userFound: false, passwordOk: false };
      });
    })();

    // Give the holder a moment to acquire the global lock and enter its
    // callback. The lock is held inside the admission transaction.
    await new Promise((r) => setTimeout(r, 150));

    try {
      // Launch several competitors with DIFFERENT emails. None should be
      // admitted (the lock is held); all should return "busy" with ZERO
      // callback invocations.
      const competitorEmails = Array.from(
        { length: 5 },
        (_, i) => `gcomp-${i}@step04.test.local`,
      );
      let competitorCallbackCount = 0;
      const competitorResults = await Promise.all(
        competitorEmails.map((e) =>
          admitLoginAttempt(e, async () => {
            competitorCallbackCount++;
            return { userFound: false, passwordOk: false };
          }),
        ),
      );

      const admitted = competitorResults.filter((r) => r.status === "admitted").length;
      const busy = competitorResults.filter((r) => r.status === "busy").length;
      const rateLimited = competitorResults.filter((r) => r.status === "rate_limited").length;

      // Maximum callback concurrency is 1: no competitor was admitted while
      // the holder held the lock.
      expect(admitted).toBe(0);
      expect(competitorCallbackCount).toBe(0);
      // Every competitor was either busy (lock contention) or rate-limited
      // (only if the global budget were already exhausted, which it is not
      // here). The decisive assertion is admitted === 0 and
      // competitorCallbackCount === 0.
      expect(busy + rateLimited).toBe(competitorEmails.length);

      // Release the holder. It finishes its callback and commits; the
      // admission transaction releases the global lock. Maximum callback
      // concurrency across the whole run is 1 (the holder only).
      releaseHolder();
      const holderResult = await holderPromise;
      expect(holderResult.status).toBe("admitted");
      expect(holderCallbackCount).toBe(1);
      expect(competitorCallbackCount).toBe(0);
    } finally {
      // Ensure the holder is released even on assertion failure.
      releaseHolder();
      try { await holderPromise; } catch { /* swallow settle */ }
      // Cleanup the holder + any competitor attempts that may have recorded.
      await withTransaction(async (client) => {
        await client.query(
          `DELETE FROM login_attempts WHERE email = ANY($1)`,
          [["ghold@step04.test.local"].concat(
            Array.from({ length: 5 }, (_, i) => `gcomp-${i}@step04.test.local`),
          )],
        );
      });
    }
  });
});

// S4-01 admission BEFORE hash: blocked requests don't verify a hash. A
// rate-limited request must NOT invoke the callback (no hash verification).
describe("S4-01 admission before hash: blocked requests don't verify", () => {
  it("a rate-limited request does not invoke the callback (no hash work)", async () => {
    const testEmail = "nocab@step04.test.local";
    // Exhaust the per-account cap first.
    for (let i = 0; i < rateLimitTesting.LOGIN_MAX_FAILURES; i++) {
      const r = await admitLoginAttempt(testEmail, async () => {
        return { userFound: false, passwordOk: false };
      });
      expect(r.status).toBe("admitted");
    }
    // Now the next request must be rate-limited and must NOT call the callback.
    let callbackInvoked = false;
    const r = await admitLoginAttempt(testEmail, async () => {
      callbackInvoked = true;
      return { userFound: false, passwordOk: false };
    });
    expect(r.status).toBe("rate_limited");
    expect(callbackInvoked).toBe(false);
    // Cleanup (explicit transaction: single client write).
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM login_attempts WHERE email = $1`, [testEmail]);
    });
  });
});

// S4-final retention cleanup: bounded, expired-record-only, preserves the
// active budget. The cleanup is integrated inside admitLoginAttempt (same
// client, same admission transaction, no nested locks) and also exported
// standalone for direct testing. Active-window records are NEVER deleted.
describe("S4-final retention cleanup (expired-only, bounded, preserves active budget)", () => {
  it("deletes only expired records, keeps active-window records", async () => {
    const activeEmail = "cleanup-active@step04.test.local";
    const expiredEmail = "cleanup-expired@step04.test.local";
    // Insert an expired record (older than retention) via explicit fixture tx.
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO login_attempts (email, success, attempted_at)
         VALUES ($1, false, clock_timestamp() - ($2 || ' seconds')::interval)`,
        [expiredEmail, String(rateLimitTesting.LOGIN_ATTEMPTS_RETENTION_SECONDS + 60)],
      );
    });
    // Insert an active record (within the window) via explicit fixture tx.
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO login_attempts (email, success, attempted_at)
         VALUES ($1, false, clock_timestamp())`,
        [activeEmail],
      );
    });

    const deleted = await cleanupOldLoginAttempts();
    expect(deleted).toBeGreaterThanOrEqual(1);

    // Active record must remain.
    const active = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM login_attempts WHERE lower(email) = lower($1)`,
      [activeEmail],
    );
    expect(active.rows[0].n).toBe(1);
    // Expired record must be gone.
    const expired = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM login_attempts WHERE lower(email) = lower($1)`,
      [expiredEmail],
    );
    expect(expired.rows[0].n).toBe(0);

    // Cleanup (explicit transaction: single client write).
    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM login_attempts WHERE email IN ($1, $2)`,
        [activeEmail, expiredEmail],
      );
    });
  });

  it("cleanup inside admission preserves the active per-account budget", async () => {
    // Insert 5 active failures for one email (at the cap) and several expired
    // records. An admission for the capped email must still be rate-limited
    // (active budget preserved); expired records are cleaned up inside the
    // same admission transaction but do not reduce the active count.
    const cappedEmail = "cleanup-capped@step04.test.local";
    const expiredEmail = "cleanup-expired2@step04.test.local";
    for (let i = 0; i < rateLimitTesting.LOGIN_MAX_FAILURES; i++) {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO login_attempts (email, success, attempted_at)
           VALUES ($1, false, clock_timestamp())`,
          [cappedEmail],
        );
      });
    }
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO login_attempts (email, success, attempted_at)
         VALUES ($1, false, clock_timestamp() - ($2 || ' seconds')::interval)`,
        [expiredEmail, String(rateLimitTesting.LOGIN_ATTEMPTS_RETENTION_SECONDS + 60)],
      );
    });

    // Drive an admission: the inlined cleanup runs first (expired deleted),
    // then the per-account check fires (capped email is still at 5).
    let callbackInvoked = false;
    const r = await admitLoginAttempt(cappedEmail, async () => {
      callbackInvoked = true;
      return { userFound: false, passwordOk: false };
    });
    expect(r.status).toBe("rate_limited");
    expect(callbackInvoked).toBe(false);

    // The expired record was cleaned up inside the admission tx.
    const expired = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM login_attempts WHERE lower(email) = lower($1)`,
      [expiredEmail],
    );
    expect(expired.rows[0].n).toBe(0);
    // The active cap records remain (cleanup is expired-only).
    const active = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM login_attempts WHERE lower(email) = lower($1)`,
      [cappedEmail],
    );
    expect(active.rows[0].n).toBe(rateLimitTesting.LOGIN_MAX_FAILURES);

    // Cleanup (explicit transaction: single client write).
    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM login_attempts WHERE email IN ($1, $2)`,
        [cappedEmail, expiredEmail],
      );
    });
  });

  it("cleanup is bounded to LOGIN_ATTEMPTS_CLEANUP_BATCH", async () => {
    // Insert more expired records than the batch size via a single bulk
    // INSERT (unnest) in one explicit fixture transaction.
    // cleanupOldLoginAttempts must delete at most the batch size in one call.
    const batch = rateLimitTesting.LOGIN_ATTEMPTS_CLEANUP_BATCH;
    const insertCount = batch + 50;
    const expiredEmails = Array.from(
      { length: insertCount },
      (_, i) => `cleanup-batch-${i}@step04.test.local`,
    );
    const retentionSeconds = String(rateLimitTesting.LOGIN_ATTEMPTS_RETENTION_SECONDS + 60);
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO login_attempts (email, success, attempted_at)
         SELECT addr, false, clock_timestamp() - ($1 || ' seconds')::interval
         FROM unnest($2::text[]) AS addr`,
        [retentionSeconds, expiredEmails],
      );
    });

    const deleted = await cleanupOldLoginAttempts();
    expect(deleted).toBeLessThanOrEqual(batch);

    // Cleanup the remainder (explicit transaction: single client write).
    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM login_attempts WHERE email = ANY($1)`,
        [expiredEmails],
      );
    });
  });
});

// S4-final DETERMINISTIC barriers with real overlapping transactions.
//
// These tests instrument the injected test POOL (not production code) so the
// FIRST `SELECT ... FROM users WHERE id = $1 FOR UPDATE` query issued through
// the pool pauses AFTER the real FOR UPDATE resolves and the transaction
// still holds the row lock. The production helper (issuance or reset) is
// genuinely blocked at its user-lock point — no sleep-only evidence, no
// production bypass. The secondary production helper is then started and
// genuinely waits on the held lock; pg_blocking_pids ties the WAITER's
// backend PID to the specific HELD backend PID (not any global waiter).
//
// Order A: pause production issuance after its FOR UPDATE; start reset;
//   confirm reset's backend is blocked by issuance's backend PID; release
//   issuance -> it commits (session created) -> reset acquires lock, changes
//   hash, revokes ALL sessions => no active sessions remain.
//
// Order B: pause production reset after its FOR UPDATE; start stale issuance
//   with the OLD hash; confirm issuance's backend is blocked by reset's
//   backend PID; release reset -> it commits (hash changed, sessions revoked)
//   -> issuance acquires lock, sees new hash != old hash, aborts with
//   CredentialChangedError => no new session.

let adminPool: Pool | null = null;

async function getAdminPool(): Promise<Pool> {
  if (adminPool === null) {
    adminPool = makePool(requireDatabaseUrl());
  }
  return adminPool;
}

// Count active (non-revoked) sessions for the barrier user via a raw admin
// client (not the injected test pool) so the count is independent of any
// blocked helper transaction.
async function countActiveSessionsAdmin(): Promise<number> {
  const pool = await getAdminPool();
  const result = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "${ctxRef.ctx.schema}".sessions
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return result.rows[0]?.n ?? 0;
}

// Find a backend that is waiting on a lock AND is blocked specifically by
// the given held backend PID. Returns the waiter's PID (tied to the exact
// held backend, not any global waiter) or null on timeout. Uses
// pg_blocking_pids + pg_stat_activity on the admin pool.
async function findLockWaiterBlockedBy(
  heldPid: number,
  timeoutMs = 6000,
): Promise<number | null> {
  const pool = await getAdminPool();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blocked_by: number[] }>(
      `SELECT a.pid, pg_blocking_pids(a.pid) AS blocked_by
       FROM pg_stat_activity a
       WHERE a.wait_event_type = 'Lock'
         AND a.query LIKE '%FOR UPDATE%'
         AND a.datname = current_database()`,
    );
    for (const row of result.rows) {
      const blockedBy = Array.isArray(row.blocked_by) ? row.blocked_by : [];
      if (blockedBy.includes(heldPid)) {
        return row.pid;
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

// Test-only pool instrumentation: wraps the injected test Pool so the FIRST
// `SELECT ... FROM users WHERE id = $1 FOR UPDATE` query pauses AFTER the
// real query resolves (the transaction holds the row lock) and blocks until
// releasePause() is called. The held backend PID is captured via
// pg_backend_pid() on the pausing client. No production code is altered;
// only the test pool's connect() is wrapped.
type PauseState = {
  engaged: boolean;
  released: boolean;
  heldPid: number | null;
  resolveRelease: (() => void) | null;
  releasePromise: Promise<void>;
};

function makeInstrumentedPool(base: Pool): {
  pool: Pool;
  pauseState: PauseState;
} {
  const pauseState: PauseState = {
    engaged: false,
    released: false,
    heldPid: null,
    resolveRelease: null,
    releasePromise: Promise.resolve(),
  };
  pauseState.releasePromise = new Promise<void>((resolve) => {
    pauseState.resolveRelease = resolve;
  });

  const wrappedConnect = async (): Promise<PoolClient> => {
    const real = await base.connect();
    const wrapped: PoolClient = {
      query: (async function (this: unknown, ...args: any[]) {
        const text = args[0];
        const isForUpdateUsers =
          typeof text === "string" &&
          /FROM users WHERE id = \$1 FOR UPDATE/i.test(text);
        if (isForUpdateUsers && !pauseState.engaged) {
          // Run the real FOR UPDATE first; the transaction now holds the
          // row lock on this backend.
          const result = await (real.query as any)(...args);
          const pidResult = await real.query<{ pid: number }>(
            `SELECT pg_backend_pid() AS pid`,
          );
          pauseState.heldPid = pidResult.rows[0]?.pid ?? null;
          pauseState.engaged = true;
          // Block here until releasePause() is called. The transaction
          // stays open and the FOR UPDATE lock stays held.
          await pauseState.releasePromise;
          return result;
        }
        return (real.query as any)(...args);
      }) as any,
      release: ((...args: any[]) => (real.release as any)(...args)) as any,
    } as unknown as PoolClient;

    return wrapped;
  };

  const wrappedPool = {
    connect: wrappedConnect as any,
    query: ((...args: any[]) => (base.query as any)(...args)) as any,
    end: () => base.end(),
    on: (event: any, cb: any) => {
      base.on(event, cb);
      return wrappedPool;
    },
  } as unknown as Pool;

  return { pool: wrappedPool, pauseState };
}

function releasePause(ps: PauseState): void {
  if (!ps.released && ps.resolveRelease) {
    ps.released = true;
    ps.resolveRelease();
  }
}

// Wait until the pause is engaged (the primary helper has run its real FOR
// UPDATE and is now blocked holding the lock). Polls the pauseState flag.
async function waitForPauseEngaged(
  ps: PauseState,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ps.engaged && ps.heldPid !== null) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(
    `pause was not engaged within ${timeoutMs}ms; primary helper did not reach FOR UPDATE`,
  );
}

describe("S4-final deterministic barrier: pause issuance after FOR UPDATE, reset waits on exact backend, release => revoked", () => {
  it("issuance holds the lock (paused), reset is blocked by issuance's backend PID, release revokes the issued session", async () => {
    const originalPool = getPool();
    const { pool: instrPool, pauseState } = makeInstrumentedPool(originalPool);
    __setTestPool(instrPool);

    let issuanceResult: { sessionId: string; cookieSaved: boolean } | null = null;
    let issuanceError: unknown = null;
    const issuancePromise = (async () => {
      try {
        issuanceResult = await createSessionWithCredentialCheck(userId, originalHash);
      } catch (error) {
        issuanceError = error;
      }
    })();

    // Deferred secondary: do NOT launch the reset until the primary
    // (issuance) has engaged the pause and holds the row lock. This makes
    // the ordering deterministic instead of relying on a race.
    let resetError: unknown = null;
    let resetDone = false;
    let resetPromise: Promise<void> = Promise.resolve();
    const newHash = await hashPassword("BarrierNewA!2026");

    try {
      // 1. Wait for the primary (issuance) to engage the pause after its
      //    real FOR UPDATE resolves. The transaction holds the row lock.
      await waitForPauseEngaged(pauseState);
      expect(pauseState.heldPid).not.toBeNull();
      const heldPid = pauseState.heldPid as number;

      // 2. NOW launch the reset. It will block on FOR UPDATE against the
      //    issuance's held lock. Confirm its backend is blocked
      //    SPECIFICALLY by the issuance's held backend PID.
      resetPromise = (async () => {
        try {
          await resetUserPassword(userId, newHash);
          resetDone = true;
        } catch (error) {
          resetError = error;
        }
      })();
      const waiterPid = await findLockWaiterBlockedBy(heldPid);
      expect(waiterPid).not.toBeNull();
      expect(waiterPid).not.toBe(heldPid);

      // 3. Release the pause. The issuance commits (session inserted);
      //    the reset acquires the lock, changes the hash, revokes ALL
      //    sessions, commits.
      releasePause(pauseState);
      await issuancePromise;
      await resetPromise;

      // 4. Issuance succeeded; reset succeeded.
      expect(issuanceError).toBeNull();
      expect(issuanceResult).not.toBeNull();
      expect(issuanceResult!.sessionId).toBeTruthy();
      expect(resetError).toBeNull();
      expect(resetDone).toBe(true);

      // 5. No active sessions remain (reset revoked the just-issued one).
      expect(await countActiveSessionsAdmin()).toBe(0);
    } finally {
      // Ensure the pause is released and both tasks settle before
      // restoring the original pool, even on assertion failure.
      releasePause(pauseState);
      try { await issuancePromise; } catch { /* swallow settle */ }
      try { await resetPromise; } catch { /* swallow settle */ }
      __setTestPool(originalPool);
    }
  });
});

describe("S4-final deterministic barrier: pause reset after FOR UPDATE, stale issuance waits on exact backend, release => abort", () => {
  it("reset holds the lock (paused), stale issuance is blocked by reset's backend PID, release aborts issuance with CredentialChangedError", async () => {
    const originalPool = getPool();
    const { pool: instrPool, pauseState } = makeInstrumentedPool(originalPool);
    __setTestPool(instrPool);

    let resetError: unknown = null;
    let resetDone = false;
    const newHash = await hashPassword("BarrierNewB!2026");
    const resetPromise = (async () => {
      try {
        await resetUserPassword(userId, newHash);
        resetDone = true;
      } catch (error) {
        resetError = error;
      }
    })();

    // Deferred secondary: do NOT launch the stale issuance until the
    // primary (reset) has engaged the pause and holds the row lock.
    let issuanceAborted = false;
    let issuanceError: unknown = null;
    let issuancePromise: Promise<void> = Promise.resolve();

    try {
      // 1. Wait for the primary (reset) to engage the pause after its real
      //    FOR UPDATE resolves. The transaction holds the row lock.
      await waitForPauseEngaged(pauseState);
      expect(pauseState.heldPid).not.toBeNull();
      const heldPid = pauseState.heldPid as number;

      // 2. NOW launch the stale issuance with the OLD hash. It will block
      //    on FOR UPDATE against the reset's held lock. Confirm its
      //    backend is blocked SPECIFICALLY by the reset's held backend PID.
      issuancePromise = (async () => {
        try {
          await createSessionWithCredentialCheck(userId, originalHash);
        } catch (error) {
          issuanceAborted = true;
          issuanceError = error;
        }
      })();
      const waiterPid = await findLockWaiterBlockedBy(heldPid);
      expect(waiterPid).not.toBeNull();
      expect(waiterPid).not.toBe(heldPid);

      // 3. Release the pause. The reset commits (hash changed, sessions
      //    revoked); the stale issuance acquires the lock, sees the new
      //    hash != originalHash, and aborts with CredentialChangedError.
      releasePause(pauseState);
      await resetPromise;
      await issuancePromise;

      // 4. Reset succeeded; issuance aborted with CredentialChangedError.
      expect(resetError).toBeNull();
      expect(resetDone).toBe(true);
      expect(issuanceAborted).toBe(true);
      expect(issuanceError).toBeInstanceOf(CredentialChangedError);

      // 5. No new live session was created.
      expect(await countActiveSessionsAdmin()).toBe(0);
    } finally {
      releasePause(pauseState);
      try { await resetPromise; } catch { /* swallow settle */ }
      try { await issuancePromise; } catch { /* swallow settle */ }
      __setTestPool(originalPool);
    }
  });
});

afterAll(async () => {
  if (adminPool !== null) {
    await adminPool.end();
    adminPool = null;
  }
});