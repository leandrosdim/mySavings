# Step17 — Security audit

Project: `/home/leandrosdim777/projects/mySavings`
Reviewer: OpenCode (implementer self-audit, audit-only mode)
Date: 2026-09-29
Mode: Audit only; no application remediation without separate approval.

## Scope

All server entrypoints, authenticated data boundaries, SQL/transaction scopes,
private cache policy, service worker, security headers, cookies, dependencies,
and rate limits. No application code, dependencies, schema, auth policy, or
existing test assertions were modified.

## Entrypoint inventory

38 API route handlers under `app/api/`:
- Auth: `POST /api/auth/logout`
- Accounts: GET/POST `/api/accounts`, GET `/api/accounts/[id]`, POST `/api/accounts/[id]/refresh`, POST `/api/accounts/[id]/archive`, PATCH `/api/accounts/[id]/rename`, POST `/api/accounts/transfer`, POST `/api/accounts/create`
- Plans: GET `/api/plans`, POST `/api/plans/create`, PATCH `/api/plans/[id]/target`
- Templates: GET `/api/templates`, POST `/api/templates/create`, PATCH `/api/templates/[id]`
- Obligations: GET `/api/obligations`, POST `/api/obligations/create`, PATCH `/api/obligations/[id]`, POST `/api/obligations/[id]/cancel`, POST `/api/obligations/[id]/release`, GET `/api/obligations/[id]/settlements`
- Income: GET `/api/income`, POST `/api/income/create`, PATCH `/api/income/[id]`, POST `/api/income/[id]/cancel`, GET `/api/income/[id]/receipts`
- Settlements: POST `/api/settlements/pay`, POST `/api/settlements/receive`, POST `/api/settlements/reverse`
- Receipts: POST `/api/receipts/reverse`
- Rollover: GET `/api/rollover/preview`, POST `/api/rollover/apply`
- History: GET `/api/history`, GET `/api/history/[monthKey]`, POST `/api/history/close`
- Exports: GET `/api/exports/csv`, GET `/api/exports/json`
- Generation: POST `/api/generate`

Server actions: `lib/auth/actions.ts` (`loginAction`, `logoutAction`).
Edge proxy: `proxy.ts` (auth barrier for non-API routes).
Private layout: `app/(private)/layout.tsx` (session-gated render barrier).

## Findings

### Confirmed findings

#### SEC-01 — No security headers configured (MEDIUM)

**Severity**: MEDIUM
**Affected paths**: `next.config.ts` (all routes)
**Evidence**: `curl -sI http://localhost:3000/login` shows no `Content-Security-Policy`,
`X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`,
`Referrer-Policy`, or `Permissions-Policy` headers. `X-Powered-By: Next.js`
is exposed.
**User impact**: No CSP means a successful XSS (if one were found) is not
mitigated at the browser level. No `X-Frame-Options` allows clickjacking
embedding. No HSTS means a first-visit HTTP downgrade is possible in production.
**Recommended fix**: Add a `headers()` entry in `next.config.ts` applying
`Content-Security-Policy` (default-src 'self'; connect-src 'self'; frame-ancestors 'none'),
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Strict-Transport-Security: max-age=63072000; includeSubDomains`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy:
camera=(), microphone=(), geolocation=()`, and set `poweredByHeader: false`.
**Regression test**: Assert response headers on `/login`, `/dashboard`, and
an API route via a integration test or browser `curl -sI` check.

#### SEC-02 — TRUSTED_ORIGIN / TRUSTED_ORIGIN_DEV absent from .env file (LOW)

**Severity**: LOW (dev-only; the running dev process has `TRUSTED_ORIGIN_DEV`
set in its environment, so the origin gate works in this session)
**Affected paths**: `.env` (missing keys), `lib/auth/origin.ts`
**Evidence**: `grep TRUSTED_ORIGIN .env` returns nothing. The `.env.example`
documents both keys. The running dev server process has
`TRUSTED_ORIGIN_DEV=http://localhost:3000` in its process environment
(verified via `/proc/<pid>/environ`), so the origin gate is active.
**User impact**: If the dev server is restarted without the external env var,
all mutating API calls (POST/PATCH) will return 403 "Forbidden" because
`validateRequestOrigin` returns `{ valid: false, reason: "not_configured" }`.
A developer following `.env.example` would not know to set it unless they
read the origin.ts source.
**Recommended fix**: Add `TRUSTED_ORIGIN_DEV=http://localhost:3000` to `.env`
(or document it prominently in `.env.example` as required-for-dev). In
production, `TRUSTED_ORIGIN` must be set to the canonical HTTPS origin.
**Regression test**: The existing origin tests in `tests/auth/` cover the
gate logic; a startup check that warns when neither is set would help.

#### SEC-03 — Close month returns 500 on QA user with accumulated mixed data (MEDIUM)

**Severity**: MEDIUM (functional, not a security breach)
**Affected paths**: `app/api/history/close/route.ts`, `lib/history/service.ts`,
`lib/finance/forecast.ts`
**Evidence**: `POST /api/history/close {"monthKey":"2026-09"}` returns
`{"error":"Internal server error"}` HTTP 500 for the persistent QA user.
The QA user has accumulated accounts from multiple prior review sessions
(some with null balances, some with mixed settlement states). The error is
not surfaced as a structured service error — it falls through to the generic
500 in `mapServiceError`. The DB integration tests (870 passing) verify
`closeMonth` works with clean disposable fixtures, so this is likely a
forecast edge case with the accumulated real QA data.
**User impact**: A user with specific data states cannot close their month;
they get a generic 500 with no actionable message.
**Recommended fix**: Investigate the forecast computation for the specific
data state causing the throw. Wrap the forecast call in a typed error that
maps to a 400 with a descriptive message rather than a 500. Consider
cleaning the persistent QA user between review sessions.
**Regression test**: Add a DB test that closes a month with mixed null/non-null
account balances and partially-settled reserves.

### Already mitigated / confirmed safe

#### Owner resolution — CONFIRMED SAFE

All 38 API route handlers use `handlePost`/`handlePatch`/`handleGet` from
`lib/finance-routes.ts` or `lib/accounts/routes.ts`, which call
`requireApiUser()` → `resolveSessionDetailed()` → server-side session lookup.
No route accepts ownerId from client input. Verified in every route file.

#### Nested relation scoping — CONFIRMED SAFE

Every service function takes `ownerId` as its first parameter and scopes
every SQL query with `WHERE owner_id = $1`. Nested IDs (obligation_id,
settlement_id, account_id, income_id) are always queried with an
owner-scoped predicate. Cross-user access returns 404 "not found", not
the other user's data. Verified via API probes:
- User A cookie → `GET /api/accounts/1` (not owned) → 404
- User A cookie → `POST /api/settlements/pay {"obligationId":"1"}` (not owned) → 404
- User B cookie → `GET /api/accounts/6` (user A's) → 404
- User B cookie → `GET /api/obligations/4/settlements` (user A's) → 200 with empty list

#### CSRF / Origin gate — CONFIRMED SAFE

`lib/auth/origin.ts` validates the Origin header against a configured
trusted origin on all mutating routes. The gate rejects:
- Missing Origin → 403
- Malformed/multi-origin → 403
- Mismatched origin → 403
- Bad config → 503
- Not configured → 403

GET (read) routes do not check origin (safe for reads). The logout route
additionally refuses to clear the cookie on bad_config to prevent
cross-site logout CSRF.

#### SQL injection — CONFIRMED SAFE

All SQL uses parameterized queries via `client.query(text, params)`.
The only string interpolation in SQL is SAVEPOINT names
(`sp_carry_inc_${row.id}`, `sp_gen_income_${template.id}`) where the
interpolated value is a DB-returned bigint string, not user input.
No user input is ever interpolated into SQL.

#### Session management — CONFIRMED SAFE

- Iron-session with HttpOnly, SameSite=Lax, Secure (production) cookies.
- Session ID is an opaque UUID stored in DB `sessions` table.
- Password reset revokes all sessions atomically under a FOR UPDATE lock.
- Login revalidates the credential hash under FOR UPDATE to prevent
  stale-password session issuance.
- Logout revokes the DB session and clears the cookie with both Max-Age=0
  and Expires epoch.
- Test-only `createSession` is guarded against production use.

#### Rate limiting — CONFIRMED SAFE

Login admission uses a single global `pg_try_advisory_xact_lock` to
bound hash-verification concurrency to 1. Per-account 5 failures / 5 min
and global 100 failures / 10 min throttles. Bounded expired-record
cleanup inside the same transaction. Dummy-hash timing equalization for
unknown emails.

#### Cache policy / service worker — CONFIRMED SAFE

The service worker (`public/sw.js`) precaches only public static assets
(icons, /offline, manifest). Navigation is network-first with offline
shell fallback. API, RSC/flight, auth, export, and mutation responses
are never cached. No background sync or payment queue. On activate, only
obsolete `mysavings-*` caches are deleted. Verified via browser cache
inspection after logout: only 7 public asset URLs in cache, zero
private/auth/API/RSC entries.

All authenticated API responses include `Cache-Control: no-store`
(via the `NO_STORE` constant in route handlers). Verified via
`curl -sI` on authenticated `/api/accounts` and `/api/exports/csv`.

#### Export injection — CONFIRMED SAFE

`lib/exports/csv.ts` neutralizes formula injection on every text cell
by prefixing `'` when the de-whitespaced cell starts with `=`, `+`, `-`,
or `@`. RFC 4180 quoting is applied after neutralization. Numeric cells
are canonical EUR strings (never formula triggers).

#### Dependencies — CONFIRMED SAFE

`npm audit` reports 0 vulnerabilities. Dependencies are minimal:
`@node-rs/argon2`, `iron-session`, `next`, `pg`, `react`, `react-dom`,
`server-only`. The pg SSL warning about `sslmode=require` aliasing
`verify-full` in pg 8.x is a deprecation notice, not a vulnerability;
`db/db-config.cjs` enforces `rejectUnauthorized: true` and rejects
connections that disable TLS or certificate verification.

#### TLS enforcement — CONFIRMED SAFE

`db/db-config.cjs` rejects connection strings that disable TLS
(`ssl:false`, `ssl:undefined`, `sslmode=disable`) or disable certificate
verification (`rejectUnauthorized:false`, `sslmode=no-verify`). Production
trusted origin must be HTTPS.

#### Transaction / lock order — CONFIRMED SAFE

All writes use `withTransaction` (explicit BEGIN/COMMIT/ROLLBACK on one
checked-out client). Settlement lock order: operation_log INSERT →
obligation/income FOR UPDATE → account FOR UPDATE. Transfer locks both
accounts in deterministic ascending ID order. Concurrent payments
serialize on the obligation row lock; overpayment is rejected under lock.

#### Idempotency — CONFIRMED SAFE

Owner+operation idempotency keys deduplicate retries. Same key + same
payload hash returns the original result. Same key + changed payload is
rejected (409). Verified via API: replay returns original 201; changed
payload returns 409.

#### Immutable closing snapshots — CONFIRMED SAFE (with SEC-03 caveat)

`closeMonth` locks the plan row, builds a consistent snapshot inside the
transaction, and inserts into `closing_snapshots` with a
UNIQUE(owner_id, month_key) constraint. A second close on a closed month
is rejected. Reversals create compensating immutable rows; originals are
never UPDATEd. (SEC-03 notes a 500 error on specific data states, but
the immutability invariant itself is sound.)

#### Carryover dedup — CONFIRMED SAFE

Rollover carries obligations by reference (same row, `current_month_key`
updated) — no duplication. Reserves always carry by reference. Income
carry inserts a NEW expectation with a SAVEPOINT + unique-violation catch
to dedup against template-generated instances. Release choices are
validated as owner-scoped and in the source month.

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 2 | SEC-01 (no security headers), SEC-03 (close 500) |
| Low | 1 | SEC-02 (TRUSTED_ORIGIN_DEV not in .env) |

No critical or high unresolved issues. SEC-01 (security headers) is the
most impactful finding and should be addressed before production deployment.
SEC-03 (close month 500) is a functional bug that needs investigation.
Both are recommended for separate scoped remediation prompts.

The core security architecture — owner-scoped parameterized SQL, session
management, CSRF/origin gate, rate limiting, cache privacy, export
injection defense, transaction/lock order, idempotency, and cross-user
isolation — is sound and verified by 870 DB integration tests and live
API/browser probes.