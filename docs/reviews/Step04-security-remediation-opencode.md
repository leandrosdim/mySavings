# Step04 security remediation — implementer self-report

Project: /home/leandrosdim777/projects/mySavings
Model: ollama-cloud/glm-5.2
Date: 2026-09-20

This is an implementation self-report, not independent approval. Hermes
reviews independently.

## Scope

Narrow concrete blockers from the continuation prompt, addressing S4-01
through S4-05 and the API JSON guard gap. No push/commit/production/public
migrations/Step05/secrets printed.

## Fixes applied

### S4-01: Admission before hash (lib/auth/rate-limit.ts, lib/auth/actions.ts)

**Problem:** `actions.ts` hashed before `admitFailure`, and successful guesses
bypassed admission entirely. Global failure count was under per-email locks
only, so rotating-email concurrency raced the global cap.

**Fix:** Replaced `admitFailure` with `admitLoginAttempt` which:
- Acquires a single global `pg_try_advisory_xact_lock` (non-blocking,
  fail-fast) to bound hash concurrency to 1 across instances (Neon pooler
  safe — transaction-scoped lock).
- Checks per-account (5/5min) and global (100/10min) failure windows BEFORE
  any credential lookup or hash verification.
- Executes the credential lookup + real/dummy Argon2 verification inside the
  callback within the same transaction. The callback returns `passwordOk`
  instead of throwing for expected failures. Genuine errors propagate and
  roll back without recording an attempt.
- Records the attempt (success or failure) and commits within the same
  transaction.
- `clock_timestamp()` used instead of `now()` for accurate active-window
  time (transaction `now()` before lock wait is stale).
- `actions.ts` now calls `admitLoginAttempt` BEFORE any hashing. Unknown
  emails perform real Argon2 verification against a cached dummy hash inside
  the callback. Blocked (rate-limited or busy) requests never invoke the
  callback, so no hash work is performed.
- Session issuance happens after the admission transaction commits, using
  `createSessionWithCredentialCheck` with FOR UPDATE row-lock revalidation.
- Retention cleanup deletes ONLY expired records in a bounded batch (500),
  under a safe transaction. Active-window records are never deleted. Not
  invoked publicly during QA.

**Test coverage:** `tests/auth/barrier.test.ts` — both reset/issuance
orderings, sequential cap exhaustion (5 admitted, 6th rate-limited),
concurrent burst lock bound (at most 5 admitted, rest busy/rate-limited),
rotating-email global budget tracking, blocked requests don't verify a hash.

### S4-02: Logout honesty (app/api/auth/logout/route.ts, lib/auth/actions.ts)

**Problem:** Logout route `dbError` branch was identical to success 303.

**Fix:**
- On DB revocation failure, the route returns honest 503 with
  `Cache-Control: no-store`, `Set-Cookie` cleared, and a safe retry/recovery
  JSON message. NOT a normal 303 redirect.
- On success, the route returns 303 with `Set-Cookie` cleared and
  `Cache-Control: no-store`.
- `logoutAction` does not fake normal success on DB failure; it still
  redirects to `/login` (cookie cleared locally) but does not hide the DB
  failure from the caller (the `LogoutResult.dbError` is available to the
  action's caller).
- Never clears cookies for a forbidden Origin (403 without Set-Cookie).
- Documents replay limitation during outage honestly.

**Test coverage:** `tests/auth/logout-guard.test.ts` — logout clears cookie
on valid/expired/revoked/missing/tampered session, reports dbError honestly
(via `ALTER TABLE sessions RENAME` injection), 503 on DB error.

### S4-03: Strict origin validation (lib/auth/origin.ts)

**Problem:** Accepted any URL by host/protocol, including paths/queries/
userinfo/fragments and malformed configured origins.

**Fix:**
- `normalizeConfigOrigin` validates config origins: canonical HTTP(S) only,
  no path/query/fragment/userinfo, production HTTPS required, rejects literal
  null/undefined, normalizes one trailing slash for CONFIG ONLY.
- `parseRequestOrigin` validates request origins: canonical HTTP(S) only, no
  path/query/fragment/userinfo, rejects literal null/undefined, rejects
  multi-origin (comma-separated).
- `validateRequestOrigin` returns `{ valid: false, reason: "bad_config" }`
  on bad config (safe 503), never builds a redirect from raw invalid origin.
- `getSafeLogoutRedirect` returns `new URL('/login', validatedOrigin)` or
  falls back to `/login` on bad/missing config. Never falls back to localhost
  or forwarded host.
- Config cache with `__resetConfigCache` for test env changes.

**Test coverage:** `tests/auth/logout-guard.test.ts` — accepts exact match,
rejects missing/empty/malformed/sibling/forged/protocol-mismatch/path/query/
fragment/userinfo/null/multi-origin, config validation (trailing slash
normalization, path/fragment rejection, literal null rejection, safe
fallback).

### S4-04: Test-only bypass guards (lib/db.ts, lib/auth/session.ts, tests/auth/helpers.ts)

**Fix:**
- `__setTestPool` now requires `NODE_ENV=test` (throws otherwise), refuses in
  production builds, refuses to overwrite a non-test cached pool.
- `createSession` now requires `NODE_ENV=test` (throws otherwise).
- Both vitest configs set `env: { NODE_ENV: "test" }`.
- Fixed typecheck errors in `tests/auth/helpers.ts` (implicit `any` params
  on the `pool.query` override).
- `vitest.db.config.mts` runs with `fileParallelism: false` and
  `singleThread: true` because the global advisory lock and pool injection
  are process-global. This serializes test files to avoid lock contention
  and pool-injection races.

### S4-05: Adversarial regression tests

**Test files and coverage:**

| File | Tests | Coverage |
|------|-------|----------|
| `tests/auth/password.test.ts` | 17 | Hashing, verify, dummy hash timing equalization |
| `tests/auth/session.test.ts` | 12 | Create/resolve/revoke/delete, expiry, credential revalidation both orderings, cookie-save failure rollback |
| `tests/auth/login.test.ts` | 19 | Login success/failure, rate limiting (no account lockout on valid login), per-email throttle, forged owner ignored, two-user isolation, provisionUser |
| `tests/auth/barrier.test.ts` | 7 | Reset-then-issuance (aborts), issuance-then-reset (revokes), sequential cap exhaustion, concurrent burst lock bound, rotating-email global budget, blocked requests don't verify hash |
| `tests/auth/logout-guard.test.ts` | 42 | Strict Origin enforcement (12 tests), config validation (6), safe logout redirect (4), logout cookie clearing (6, including DB error), API JSON guard (8), token replay/expiry/revocation (3) |
| `tests/auth/identity.test.ts` | 6 | Same-device user switching (A→logout→B), both logout, two-user isolation, API guard 401, API guard userId from session not input, API guard not financial isolation |
| **Total** | **101** | |

All tests use disposable `step04_*` schemas with the real migration runner. No
public/global fixture writes. All DB writes are explicit transactions.

## Quality gates

| Gate | Result |
|------|--------|
| `npm run lint` | Pass (no errors) |
| `npm run typecheck` | Pass (no errors) |
| `npm test` (offline) | Pass: 7 files, 309 tests |
| `npm run build` | Pass (routes generated) |
| `npm audit` | 0 vulnerabilities |
| `git diff --check` | Clean (no whitespace errors) |
| `DB_TEST_ALLOW_WRITES=1 npm run test:db` | Pass: 15 files, 443 tests |
| `DB_TEST_ALLOW_WRITES=1 npm run test:db -- tests/auth` | Pass: 6 files, 101 tests |

## Migrations

No new migrations. The existing identity migration (0001 + 0002) is reused
via the real migration runner into disposable `step04_*` schemas. No public
or production migrations were applied.

## Remaining risks and limitations

1. **Replay during outage:** If the DB is unavailable at logout time, the
   local cookie is cleared but the server-side session row is not revoked.
   The unrevoked session will expire naturally per `SESSION_TTL_SECONDS`
   (7 days). During this window, replay of the sealed cookie is theoretically
   possible if the DB comes back. This is documented honestly in the 503
   response rather than hidden behind false success.

2. **Global lock fail-fast:** `pg_try_advisory_xact_lock` is non-blocking.
   Under concurrent login bursts, requests that cannot acquire the lock
   return "busy" with a retry message. This bounds hash concurrency to 1
   (DoS protection) but means concurrent legitimate logins may see the
   "busy" message and need to retry. This is the intended tradeoff for a
   private two-user app.

3. **Single-session enforcement not implemented:** Multiple sessions per user
   are allowed. `createSession` (test-only) does not revoke prior sessions.
   Full single-session enforcement is a future policy choice. The login path
   (`loginAction` → `createSessionWithCredentialCheck`) also does not revoke
   prior sessions.

4. **API guard is access gating, not financial isolation:** The API guard
   (`requireApiSession`/`requireApiUser`) only gates access. Financial
   isolation requires scoped queries using the session's `userId` in WHERE
   clauses. This is documented in `docs/auth.md` and tested in
   `tests/auth/identity.test.ts`.

5. **No real-browser QA in this pass:** Per the prompt, no browsers/servers
   were started. Parent does real-browser QA.

6. **Config cache:** The origin config is cached at module level. Tests must
   call `__resetConfigCache()` after changing env vars. Production does not
   change env vars at runtime so the cache is safe.