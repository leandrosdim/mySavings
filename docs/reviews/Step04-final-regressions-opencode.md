# Step04 final bounded regressions — implementer self-report

Project: /home/leandrosdim777/projects/mySavings
Model: ollama-cloud/glm-5.2
Date: 2026-09-21

This is an implementation self-report for the FINAL bounded Step04 gaps from
the continuation prompt. It is NOT independent approval. Hermes reviews
independently. No commits/pushes/deployment/production migrations/public
writes were performed. The existing test harness (direct Neon, verified
startup own-schema on 4 connections) was preserved unchanged.

## Scope

Only the four concrete gap areas (A, B, C, D) from the final prompt. No new
features, no Step05, no registry/independent-review edits.

## Production changes

### A1 — Logout clear-cookie header carries explicit Expires epoch

File: `lib/auth/session.ts` (`buildSessionClearCookieHeader`)

**Problem:** Real curl against the live HTTPS logout response showed the
returned `Set-Cookie` was an EMPTY VALUE WITHOUT `Max-Age`/`Expires`
(`mysavings_session=; Path=/; Secure; HttpOnly; SameSite=lax`). Next merges
cookie-store writes with response `Set-Cookie` headers and has been observed
dropping `Max-Age=0` on the merged value, leaving the browser with an
empty-value cookie that has no expiry directive.

**Fix:** `buildSessionClearCookieHeader` now emits BOTH `Max-Age=0` AND an
explicit `Expires=Thu, 01 Jan 1970 00:00:00 GMT` epoch. The explicit epoch is
a stable fallback every browser honors as "already expired", so the merged
response actually deletes the cookie regardless of which directive Next
preserves. The header is now:
`mysavings_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax[; Secure]`

### A2 — bad_config returns 503/no-store/safe error; forbidden origins stay 403/no-cookie

File: `app/api/auth/logout/route.ts`

**Problem:** `validateRequestOrigin` returns `bad_config` when the configured
`TRUSTED_ORIGIN` is malformed, but the logout route collapsed every invalid
case into 403. `bad_config` is a SERVER config fault, not a client forbidden
request, and should be 503 no-store with a safe config error message and NO
cookie clear (a misconfigured origin gate must not be leveraged to wipe the
session cookie). Forbidden origins (missing/malformed/not_configured/mismatch)
remain 403 with no `Set-Cookie` and `no-store`.

**Fix:** The route now branches on `originCheck.reason === "bad_config"`:
- bad_config -> 503, `Cache-Control: no-store`, safe config error JSON, NO
  `Set-Cookie`.
- other invalid reasons -> 403, `Cache-Control: no-store`, no `Set-Cookie`.

Both 403 and 503 now also carry `Cache-Control: no-store` (the prior 403 path
did not set it explicitly).

## Test changes

### A3 — REAL POST route tests (new file `tests/auth/logout-route.test.ts`)

Imports the REAL `POST` from `app/api/auth/logout/route.ts` and drives it
against the injected disposable schema. No fake response functions.

Tests (5):
1. Forbidden mismatched Origin -> 403, no `Set-Cookie`, `no-store`, cookie
   store untouched.
2. Missing Origin -> 403, no `Set-Cookie`.
3. bad_config (TRUSTED_ORIGIN with a path) -> 503, `no-store`, no
   `Set-Cookie`, safe config error message containing "configuration", cookie
   store untouched.
4. Success (valid origin, live session, revocation succeeds) -> 303 to the
   configured non-localhost `https://app.mysavings.test/login`, `Location`
   header is the trusted origin /login (never localhost/127.0.0.1),
   `Cache-Control: no-store`, `Set-Cookie` carries `Max-Age=0` AND
   `Expires=Thu, 01 Jan 1970 00:00:00 GMT`, `HttpOnly`, `SameSite=Lax`,
   empty value form `mysavings_session=;`.
5. 503 after SUCCESSFUL session lookup but failing UPDATE revocation: a
   BEFORE UPDATE trigger on sessions raises on UPDATE, so
   `resolveSessionDetailed` succeeds (SELECT) but `revokeSessionDetailed`'s
   UPDATE fails. Route returns 503, `no-store`, `Set-Cookie` clears with
   `Max-Age=0` + Expires epoch, body carries the safe retry message with no
   session-id / DB-error leak. Trigger dropped in `finally`.

### A4 — logoutAction failure paths (added to `tests/auth/login.test.ts`)

Tests (4):
1. logoutAction dbError throws safe failure: a BEFORE UPDATE trigger on
   sessions makes `revokeSessionDetailed` fail; `logoutAction` throws a real
   `Error` (NOT a `NEXT_REDIRECT`), message contains "logout"/"failed", no
   internal leak (no trigger name, no simulated exception text).
2. Cookie-clearing failure accurate: `clearSessionCookie()` returns `false`
   when the iron-session store throws on init; the cookie remains present.
   Verified directly against the helper so the `cookieCleared=false`
   contract is independent of the lookup path (which honestly propagates the
   init error).
3. logoutAction config failure (missing SESSION_SECRET): `validateSessionConfig`
   runs before any DB write and throws `AuthConfigError`; `logoutAction`
   propagates a real `Error` (not a redirect), message mentions
   `session_secret`.
4. logoutAction config failure (too-short SESSION_SECRET): same, real
   `Error` (not a redirect).

### B — Deterministic barrier overlap via pool/client query instrumentation

File: `tests/auth/barrier.test.ts`

**Problem:** The prior overlap test waited for issuance to COMPLETION then
started reset (sequential, not overlapping), and `waitForLockWaiter` matched
ANY global waiter rather than tying the waiter to the specific held backend
PID.

**Fix:** Replaced with test-only pool/client `query` instrumentation that
wraps the injected test Pool. The FIRST `SELECT ... FROM users WHERE id = $1
FOR UPDATE` issued through the pool pauses AFTER the real FOR UPDATE query
resolves (the transaction genuinely holds the row lock) and blocks until
`releasePause()` is called. The held backend PID is captured via
`pg_backend_pid()` on the pausing client. No production code is altered.

Two ordering tests:
- Order A (pause issuance, then start reset): launch issuance; wait for
  pause engaged (real FOR UPDATE resolved, lock held); NOW launch reset;
  confirm reset's backend is blocked SPECIFICALLY by issuance's held backend
  PID via `pg_blocking_pids` (not any global waiter); release pause ->
  issuance commits (session created) -> reset acquires lock, changes hash,
  revokes ALL sessions -> no active sessions remain.
- Order B (pause reset, then start stale issuance): launch reset; wait for
  pause engaged; NOW launch stale issuance with the OLD hash; confirm
  issuance's backend is blocked SPECIFICALLY by reset's held backend PID;
  release pause -> reset commits (hash changed, sessions revoked) -> issuance
  acquires lock, sees new hash != old hash, aborts with
  `CredentialChangedError` -> no new session.

Both tests release the pause and await both tasks in `finally` before
restoring the original pool, so teardown is clean even on assertion failure.

### C — Global budget + concurrency-1 + loginAction spy

File: `tests/auth/barrier.test.ts` (global budget), `tests/auth/login.test.ts`
(loginAction spy)

**Problem:** The existing "3 distinct emails prove nothing" test only
asserted the budget constant was greater than 0; it never exercised the
global cap. No concurrency-1 proof existed. No loginAction-level spy proved
blocked requests never reach `verifyPassword`.

**Fix:** Replaced the 3-email test with two real tests:

1. Seed `GLOBAL_BUDGET_MAX_FAILURES - 1` (99) failures in ONE bulk INSERT
   inside an explicit transaction (all distinct emails so the per-account cap
   is never the limiter). Then DIFFERENT emails call production
   `admitLoginAttempt`:
   - 1st different email -> `admitted` (the 100th global failure), callback
     invoked exactly once.
   - 2nd different email -> `rate_limited` with `reason: "global_budget"`,
     ZERO additional callbacks.

2. Concurrency-1 proof: hold ONE admission callback open with a deferred
   barrier while it holds the global advisory transaction lock. Several
   competitors (5 different emails) race to acquire the lock; because
   `pg_try_advisory_xact_lock` is non-blocking, every competitor returns
   `busy` with ZERO callback invocations. Release the held callback -> it
   finishes and commits; maximum callback concurrency across the whole run
   is 1 (the holder only).

3. loginAction-level spy (in `login.test.ts`):
   - A rate-limited `loginAction` (per-account cap exhausted) does NOT call
     `verifyPassword` (spy count stays 0 on the 6th attempt).
   - A busy `loginAction` (global lock held by a deferred-barrier holder for
     a different email) returns the "busy" error and does NOT call
     `verifyPassword` (spy count 0).

### D — All fixture writes use explicit withTransaction

Files: `tests/auth/barrier.test.ts`, `tests/auth/login.test.ts`,
`tests/auth/logout-guard.test.ts`, `tests/auth/session.test.ts`

**Problem:** Previous harness report falsely accepted autocommit; single
`query()` INSERT/UPDATE/DELETE fixtures were used throughout.

**Fix:** Replaced every single `query()` write (INSERT/UPDATE/DELETE/ALTER)
with `withTransaction(async (client) => client.query(...))` on one checked-out
client. Reads (`SELECT count(*)`, `SELECT password_hash`) remain `query()`.
Production `query()` calls were NOT changed to auto-transaction. The
`tests/auth/helpers.ts` `insertTestUser` and `resetAuthTables` already used
`withTransaction` and were preserved.

Specific replacements:
- `barrier.test.ts`: afterEach hash restore; burst-seq/burst-conc user +
  attempt cleanup; nocab attempt cleanup; retention test cleanups (3 sites).
- `login.test.ts`: provisionUser user cleanup; loginAction-spy holder
  attempt cleanup.
- `logout-guard.test.ts`: `expireSession`, `revokeSessionRow` helpers.
- `session.test.ts`: `expireSessionRow` helper; credential-revalidation
  hash change + restore; cleanup-failure test final session cleanup.

Unused `query` imports were removed from `login.test.ts` and
`logout-guard.test.ts` (no remaining reads there).

## Quality gates

| Gate | Result |
|------|--------|
| `npm run lint` | Pass (0 errors, 0 warnings) |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | Pass |
| `npm test` (offline) | Pass: 7 files, 309 tests |
| `DB_TEST_ALLOW_WRITES=1 npm run test:db -- tests/auth` | Pass: 7 files, 123 tests |
| `DB_TEST_ALLOW_WRITES=1 npm run test:db` (full DB suite) | Pass: 16 files, 465 tests |
| `npm audit` | 0 vulnerabilities |

Auth test count went from 101 to 123 (+22 new tests):
- `logout-route.test.ts`: +5 (new file)
- `login.test.ts` logoutAction failure paths: +4
- `login.test.ts` loginAction spy: +2
- `barrier.test.ts` deterministic barrier (replaced 2 sequential tests with
  2 real overlap tests): net +0 count, real coverage
- `barrier.test.ts` global budget (replaced 1 weak test with 2 real tests): +1
- retention/burst tests: unchanged count, D-fixed fixtures

## Harness preserved

The direct-Neon, verified-startup-own-schema-on-4-connections harness in
`tests/auth/helpers.ts` was NOT modified. The `makeInstrumentedPool` helper
in `barrier.test.ts` wraps the injected test Pool at the test layer only;
`tests/auth/helpers.ts` and `lib/db.ts` are unchanged.

## No build

Per the prompt, no `npm run build` was run while the parent-owned QA server
exists. The parent rebuilds after this stop.

## Boundaries kept

- No commits/pushes/deployment/production migrations/public writes.
- No `/tmp/external` tools, no git stash, no global configuration edits.
- No edits to independent review files or `steps/registry.json`.
- No new features beyond the four gap areas.
- No real data import; all fixtures are synthetic `@step04.test.local` emails
  in disposable `step04_*` schemas, cleaned up in `finally`/`afterEach`.

## Remaining risks (unchanged from prior reports)

1. Replay during outage: if the DB is unavailable at logout, the local cookie
   is cleared but the server session row is not revoked; it expires naturally
   per `SESSION_TTL_SECONDS` (7 days). Documented honestly in the 503 body.
2. Global lock fail-fast: concurrent legitimate logins may see "busy" and
   must retry. Intentional for a private two-user app.
3. Single-session enforcement not implemented; multiple sessions per user
   are allowed. Future policy choice.
4. API guard is access gating, not financial isolation; scoped queries must
   use the session `userId` in WHERE clauses.

## STOP

Step04 final bounded regressions implemented and self-verified. Awaiting
independent Hermes review. No next step started.