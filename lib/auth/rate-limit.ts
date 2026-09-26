import "server-only";
import { query, withTransaction, type PoolClient } from "@/lib/db";

const LOGIN_WINDOW_SECONDS = 60 * 5;
const LOGIN_MAX_FAILURES = 5;
const GLOBAL_BUDGET_WINDOW_SECONDS = 60 * 10;
const GLOBAL_BUDGET_MAX_FAILURES = 100;
const LOGIN_ATTEMPTS_RETENTION_SECONDS = 60 * 60 * 24;
const LOGIN_ATTEMPTS_CLEANUP_BATCH = 500;

// Single global advisory transaction lock key used to bound cross-instance
// hash-verification concurrency to 1. pg_try_advisory_xact_lock is
// non-blocking: a request that cannot acquire it fails fast with a "busy"
// retry message instead of queueing. This is safe with Neon's pooled endpoint
// because the lock is transaction-scoped (released on COMMIT/ROLLBACK).
const GLOBAL_HASH_LOCK_SEED = BigInt("0x6d73617667686c6b");
const GLOBAL_HASH_LOCK_KEY = GLOBAL_HASH_LOCK_SEED & BigInt("0x7fffffffffffffff");

export type LoginAttemptResult = {
  userFound: boolean;
  passwordOk: boolean;
  userId?: string;
  passwordHash?: string;
};

export type LoginCallback = (client: PoolClient) => Promise<LoginAttemptResult>;

export type AdmissionOutcome =
  | { status: "admitted"; result: LoginAttemptResult }
  | { status: "rate_limited"; reason: "per_account" | "global_budget" }
  | { status: "busy" };

async function countRecentFailures(client: PoolClient, email: string): Promise<number> {
  const result = await client.query<{ failures: number }>(
    `SELECT count(*)::int AS failures
     FROM login_attempts
     WHERE lower(email) = lower($1)
       AND success = false
       AND attempted_at > clock_timestamp() - ($2 || ' seconds')::interval`,
    [email, String(LOGIN_WINDOW_SECONDS)],
  );
  return result.rows[0]?.failures ?? 0;
}

async function countGlobalFailures(client: PoolClient): Promise<number> {
  const result = await client.query<{ failures: number }>(
    `SELECT count(*)::int AS failures
     FROM login_attempts
     WHERE success = false
       AND attempted_at > clock_timestamp() - ($1 || ' seconds')::interval`,
    [String(GLOBAL_BUDGET_WINDOW_SECONDS)],
  );
  return result.rows[0]?.failures ?? 0;
}

// Atomic admission BEFORE any credential lookup or hash verification.
// Acquires a single global pg_try_advisory_xact_lock (non-blocking, fail-fast)
// to bound hash concurrency to 1 across instances. Within the same transaction:
//   1. Runs bounded expired-record-only retention cleanup (same client, no
//      nested locks). Only records older than LOGIN_ATTEMPTS_RETENTION_SECONDS
//      are deleted; active-window records are NEVER touched so cleanup cannot
//      bypass quota. This is the single internal caller of cleanupOldLoginAttempts.
//   2. Checks per-account and global failure windows.
//   3. Executes the callback (credential lookup + real/dummy Argon2 verify).
//   4. Records the attempt (success or failure) and commits.
// The callback must NOT throw for expected failures (wrong password); it
// returns passwordOk=false. Throws propagate and roll back the transaction
// (no attempt recorded, no cleanup committed). Session issuance happens AFTER
// this transaction commits, using the existing credential row-lock
// revalidation in createSessionWithCredentialCheck.
//
// Availability policy (strict private-app): per-account 5 failures / 5 min and
// global 100 failures / 10 min can TEMPORARILY block a legitimate login (a
// real user with repeated typos, or a burst that consumes the global budget,
// must wait for the window to slide). This is NOT "no account lockout" — it
// is an intentional strict throttle for a private two-user app with no public
// registration. Hash-concurrency-1 fail-fast (pg_try_advisory_xact_lock) is
// also deliberate: concurrent legitimate logins may see "busy" and must retry.
export async function admitLoginAttempt(
  normalizedEmail: string,
  callback: LoginCallback,
): Promise<AdmissionOutcome> {
  return withTransaction(async (client) => {
    const lockResult = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1) AS locked`,
      [GLOBAL_HASH_LOCK_KEY.toString()],
    );
    if (!lockResult.rows[0]?.locked) {
      return { status: "busy" } as const;
    }

    // Bounded expired-record-only retention cleanup, inside the admission
    // transaction on the SAME client. No nested advisory lock (we already
    // hold the global lock). Deletes at most LOGIN_ATTEMPTS_CLEANUP_BATCH
    // records older than the retention period; active-window records are
    // never deleted so the per-account/global counts are unaffected. A
    // cleanup failure rolls back the whole admission (fail-closed).
    await client.query(
      `WITH deleted AS (
         DELETE FROM login_attempts
         WHERE id IN (
           SELECT id FROM login_attempts
           WHERE attempted_at < clock_timestamp() - ($1 || ' seconds')::interval
           LIMIT $2
         )
         RETURNING id
       )
       SELECT count(*)::int AS deleted FROM deleted`,
      [String(LOGIN_ATTEMPTS_RETENTION_SECONDS), String(LOGIN_ATTEMPTS_CLEANUP_BATCH)],
    );

    const perEmailFailures = await countRecentFailures(client, normalizedEmail);
    if (perEmailFailures >= LOGIN_MAX_FAILURES) {
      return { status: "rate_limited", reason: "per_account" } as const;
    }

    const globalFailures = await countGlobalFailures(client);
    if (globalFailures >= GLOBAL_BUDGET_MAX_FAILURES) {
      return { status: "rate_limited", reason: "global_budget" } as const;
    }

    const result = await callback(client);

    await client.query(
      `INSERT INTO login_attempts (email, success, attempted_at) VALUES ($1, $2, clock_timestamp())`,
      [normalizedEmail, result.passwordOk],
    );

    return { status: "admitted", result } as const;
  });
}

export async function recordSuccess(normalizedEmail: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO login_attempts (email, success, attempted_at) VALUES ($1, true, clock_timestamp())`,
      [normalizedEmail],
    );
  });
}

export async function recentFailedAttempts(email: string): Promise<number> {
  const result = await query<{ failures: number }>(
    `SELECT count(*)::int AS failures
     FROM login_attempts
     WHERE lower(email) = lower($1)
       AND success = false
       AND attempted_at > clock_timestamp() - ($2 || ' seconds')::interval`,
    [email, String(LOGIN_WINDOW_SECONDS)],
  );
  return result.rows[0]?.failures ?? 0;
}

export async function isRateLimited(email: string): Promise<boolean> {
  const failures = await recentFailedAttempts(email);
  return failures >= LOGIN_MAX_FAILURES;
}

// Retention cleanup: deletes ONLY expired records (older than the retention
// period) in a bounded batch. Active-window records are NEVER deleted to bypass
// quota. Runs in its own safe transaction with explicit BEGIN/COMMIT/ROLLBACK
// on one client. The PRODUCTION caller is the inlined cleanup step inside
// admitLoginAttempt (same client, same admission transaction, no nested
// locks). This exported standalone form is kept for direct unit testing of
// the expired-only/bounded semantics without driving a full admission.
export async function cleanupOldLoginAttempts(): Promise<number> {
  return withTransaction(async (client) => {
    const result = await client.query<{ deleted: number }>(
      `WITH deleted AS (
         DELETE FROM login_attempts
         WHERE id IN (
           SELECT id FROM login_attempts
           WHERE attempted_at < clock_timestamp() - ($1 || ' seconds')::interval
           LIMIT $2
         )
         RETURNING id
       )
       SELECT count(*)::int AS deleted FROM deleted`,
      [String(LOGIN_ATTEMPTS_RETENTION_SECONDS), String(LOGIN_ATTEMPTS_CLEANUP_BATCH)],
    );
    return result.rows[0]?.deleted ?? 0;
  });
}

export const __testing = {
  LOGIN_WINDOW_SECONDS,
  LOGIN_MAX_FAILURES,
  GLOBAL_BUDGET_WINDOW_SECONDS,
  GLOBAL_BUDGET_MAX_FAILURES,
  LOGIN_ATTEMPTS_RETENTION_SECONDS,
  LOGIN_ATTEMPTS_CLEANUP_BATCH,
  GLOBAL_HASH_LOCK_KEY,
  countRecentFailures,
  countGlobalFailures,
};