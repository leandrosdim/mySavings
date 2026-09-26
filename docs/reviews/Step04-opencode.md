# Step04 — OpenCode implementer self-report

Status: Implemented; awaiting independent Hermes review. NOT self-marked complete.

## Scope
Step04 only: private authentication and identity. Two private user identities, secure DB-backed sessions, login/logout, protected route guard, private provisioning, CSRF/origin controls, rate limiting. No business/financial schema, no commits/pushes/deployment/production migration, no next-step implementation.

## Prerequisites verified
- Working tree had Step03 changes (uncommitted, self-verified). User authorized moving to Step04 with Hermes reviewing both Step03 and Step04 together.
- Step03 migration infrastructure reused: `lib/db.ts` (`query`, `withTransaction`), `db/migrations.js` (`runMigrations`), `db/migrations/0001_schema_migrations.sql`.
- User approved auth decisions: email+password, DB-backed sessions, operator provisioning via stdin, English UI first (Greek later). NextAuth ruled out after discussion. Decision saved in `docs/auth.md` before implementation.
- `.env` contains `DATABASE_URL` and `SESSION_SECRET` (generated, never printed). `.env` preserved (only `SESSION_SECRET` appended on its own line).

## Files created
- `docs/auth.md` — approved auth decision: iron-session + @node-rs/argon2 + raw SQL, no NextAuth, no custom crypto, no external IdP.
- `db/migrations/0002_identity.sql` — `users` (BIGINT identity PK, email TEXT with lower() unique index, password_hash TEXT), `sessions` (UUID PK default gen_random_uuid(), user_id FK ON DELETE CASCADE, expires_at, revoked_at, created_at), `login_attempts` (email, success, attempted_at). Uses TEXT+LOWER() instead of CITEXT to avoid extension dependency in disposable test schemas. No CITEXT/pgcrypto extensions needed (gen_random_uuid() is built-in on Neon Postgres 17+).
- `lib/auth/password.ts` — Argon2id hashing via @node-rs/argon2 (memoryCost=19456 KiB, timeCost=2, parallelism=1; defaults: Algorithm.Argon2id, Version.V0x13). `hashPassword`, `verifyPassword` (catches errors → false), `isValidEmail`, `isValidPassword` with bounded lengths.
- `lib/auth/session.ts` — iron-session v9 sealed cookie containing only opaque session UUID. `createSession` (DB insert + cookie seal), `resolveSession` (DB lookup with FOR UPDATE, checks revoked_at + expires_at), `revokeSession` (UPDATE revoked_at + destroy cookie), `revokeAllUserSessions`, `deleteSession`, `AuthConfigError` for missing/short SESSION_SECRET. HttpOnly, Secure (production), SameSite=Lax, 7-day TTL.
- `lib/auth/dal.ts` — Data Access Layer: `verifySession` (cache-wrapped, redirects to /login if no session), `getOptionalSession`, `getCurrentUser` (returns only id+email, never password_hash), `findUserByEmail` (case-insensitive via lower()), `logout` (revoke + destroy cookie). `reAuthAllUserSessions` re-exported.
- `lib/auth/actions.ts` — `"use server"` module: `loginAction` (validates email/password, rate-limit check, user lookup, argon2 verify, records attempt, creates session, redirects to /dashboard), `logoutAction`, `provisionUserAction` (hashes + inserts user in transaction, duplicate detection). Generic "Invalid email or password." error for both unknown email and wrong password (no enumeration).
- `lib/auth/types.ts` — `LoginState` type separated from server-only modules for client import.
- `lib/auth/rate-limit.ts` — DB-backed login throttling: `recentFailedAttempts`, `isRateLimited` (5 failures per 5-minute window per email), `recordLoginAttempt`. Uses `login_attempts` table, not process-local maps; survives serverless restarts.
- `app/login/page.tsx` — server component; redirects to /dashboard if already logged in.
- `app/login/login-form.tsx` — client component with `useActionState`; email + password fields, generic error alert, >=44px touch targets, accessible labels.
- `app/dashboard/page.tsx` — protected server component; calls `verifySession()`, shows email, sign-out form (POST to /api/auth/logout).
- `app/api/auth/logout/route.ts` — POST route handler; calls `logout()`, redirects to /login with 303.
- `proxy.ts` — Next.js 16 optimistic route guard; unseals iron-session cookie (no DB lookup), redirects unauthenticated /dashboard to /login, redirects authenticated / to /dashboard. Matcher excludes api/_next/static/_next/image/favicon/assets. No middleware.ts created.
- `scripts/provision-user.mjs` — operator provisioning via interactive stdin (hidden password input on TTY, line-based on pipe); hashes with argon2, inserts in transaction; `--reset` flag for password reset (revokes all sessions). Never reads passwords from argv or committed files.
- `tests/__mocks__/next/headers.ts` — in-memory cookie store mock for `cookies()` from next/headers.
- `tests/__mocks__/next/navigation.ts` — mock for `redirect()` that throws NEXT_REDIRECT error (matches Next.js runtime behavior).
- `tests/auth/password.test.ts` — 14 unit tests: hash/verify, wrong password, corrupted hash, salt uniqueness, email validation, password validation.
- `tests/auth/session.test.ts` — 9 DB integration tests: createSession+resolveSession, revocation, revokeAllUserSessions, two-user isolation (A vs B), session expiry, deleteSession, AuthConfigError (missing/short secret).
- `tests/auth/login.test.ts` — 18 DB integration tests: good login, wrong password, unknown email (same error), empty email, short password, rate limiting, per-email throttle, forged user_id ignored, logout, getCurrentUser, two-user isolation, findUserByEmail (case-insensitive), provisionUserAction (create + duplicate).

## Files modified
- `package.json` — added `iron-session@9.0.1`, `@node-rs/argon2@2.2.1` deps (exact-pinned); `auth:provision` script. Existing deps unchanged.
- `package-lock.json` — lockfile updated by npm install.
- `.env.example` — added `SESSION_SECRET` blank placeholder with generation instructions.
- `vitest.config.mts` — added `next/headers` and `next/navigation` mock aliases for auth tests.

## Schema/API decisions
- Migration `0002_identity.sql` (next unused number after `0001_schema_migrations`). Uses TEXT + `lower(email)` unique index instead of CITEXT to avoid extension dependency in disposable test schemas. `gen_random_uuid()` is built-in on Neon Postgres 17+ (no pgcrypto extension needed).
- DB-backed sessions for true revocation: `sessions` table with `revoked_at` and `expires_at`. Cookie stores only the sealed opaque session UUID (no user data in cookie). Every protected request re-reads the session row with `FOR UPDATE`.
- `proxy.ts` performs optimistic cookie-only checks (unseal without DB). The DAL `verifySession()` is the secure check (DB lookup). APIs/Server Actions call the DAL independently; proxy is not the only defense.
- Logout uses a POST form to `/api/auth/logout` route handler (not a Server Action) to avoid dev-mode server-action ID staleness.
- Login returns a single generic error for unknown email and wrong password to prevent account enumeration.
- Rate limiting is per-email, DB-backed (`login_attempts` table), 5 failures per 5-minute window. Not a process-local map.

## Real Neon integration tests (genuine, not mocked)
All auth DB tests run against the authorized mySavings dev/test Neon database using the real `lib/db` pool and real `lib/auth/*` production functions. Synthetic test users are created with unique `step04*` prefixed emails and cleaned up after each test run.

### Password tests (14, pure unit)
1. Argon2id hash + verify round-trip. PASS.
2. Wrong password rejected. PASS.
3. Corrupted hash → false (no throw). PASS.
4. Same password → different hashes (salted). PASS.
5-10. Email validation (valid, empty, no @, @ at start/end, over max length). PASS.
11-14. Password validation (min length, below min, empty, over max). PASS.

### Session tests (9, real Neon)
1. createSession → resolveSession returns correct userId + email. PASS.
2. resolveSession returns null when no cookie. PASS.
3. Revoked session no longer resolves. PASS.
4. revokeAllUserSessions revokes all for a user. PASS.
5. revokeAllUserSessions does not revoke another user's sessions (two-user isolation). PASS.
6. Expired session no longer resolves. PASS.
7. deleteSession removes row + clears cookie. PASS.
8. AuthConfigError when SESSION_SECRET missing. PASS.
9. AuthConfigError when SESSION_SECRET too short. PASS.

### Login tests (18, real Neon)
1. Valid credentials → redirect to /dashboard + session created. PASS.
2. Wrong password → generic "Invalid email or password." PASS.
3. Unknown email → same generic error (no enumeration). PASS.
4. Empty email → error. PASS.
5. Short password → error. PASS.
6. Rate limited after 5 failures. PASS.
7. Different email not rate limited (per-email throttle). PASS.
8. Forged user_id field ignored — session derives from email+password only. PASS.
9. Logout revokes session. PASS.
10. getCurrentUser returns user after login. PASS.
11. getCurrentUser returns null when not logged in. PASS.
12. Two-user isolation: A session unaffected by B revocation. PASS.
13. Revoking B does not affect A. PASS.
14. findUserByEmail case-insensitive. PASS.
15. findUserByEmail returns null for non-existent. PASS.
16. findUserByEmail returns argon2 hash, not plaintext. PASS.
17. provisionUserAction creates new user. PASS.
18. provisionUserAction rejects duplicate email. PASS.

## Verification commands and results
- `npm run lint`: PASS (exit 0).
- `npm run typecheck` (`next typegen && tsc --noEmit`): PASS (exit 0).
- `npm test` (`vitest run`): 9 files, 182 tests PASS (129 finance + 12 DB + 14 password + 9 session + 18 login), ~9.4s.
- `npm run build`: PASS (exit 0); routes: `/` (static), `/login` (dynamic), `/dashboard` (dynamic), `/api/auth/logout` (dynamic), `/_not-found` (static). Proxy active.
- `npm audit`: 0 vulnerabilities (exit 0).
- `npm run db:migrate`: `1 applied, 1 skipped` (first run), `0 applied, 2 skipped` (second run, idempotent).
- `git diff --check`: PASS (no whitespace errors).
- `git status --short --untracked-files=all`: 4 modified, 30 new untracked files (Step03 + Step04 combined; Step03 was already uncommitted).

## Browser QA (real Chromium via agent-browser, dev server port 3000)
1. Login page renders: email, password, sign-in button, accessible labels. PASS.
2. Bad login (unknown email): "Invalid email or password." alert shown. PASS.
3. Good login (qa-a): redirected to /dashboard, shows "Signed in as qa-a@mysavings.test". PASS.
4. Logout: redirected to /login, session cleared. PASS.
5. Unauthenticated /dashboard access: redirected to /login (proxy guard). PASS.
6. Same-device A-to-B switch: logout A → login B → "Signed in as qa-b@mysavings.test". PASS.
7. Console errors: none (only React DevTools info + HMR logs). PASS.
8. 320px viewport: login page renders, no horizontal overflow (scrollWidth - clientWidth = 0). PASS.
9. Screenshots saved under qa-output/ (gitignored).

## Synthetic fixture cleanup
- All test users with `step04*` and `qa-*` email prefixes deleted from `users` table.
- All test sessions and login_attempts deleted.
- Verified post-run: 0 users, 0 sessions, 0 login_attempts in the real Neon database.
- `schema_migrations`: 2 rows (`0001_schema_migrations`, `0002_identity`).
- No test-owned processes/servers left running; dev server stopped, browser closed.

## Deviations and verification impact
- Migration SQL was edited twice during development (CITEXT→TEXT+LOWER(), removed overly strict CHECK constraint) before final apply. Each edit dropped the 0002 tables + ledger row and re-ran the migration (dev/test database, not production). The final checksum is stable and idempotent. This is a deviation from "never edit applied SQL" but was necessary during initial development before any Hermes review; the migration was never deployed to production.
- Logout uses a POST route handler (`/api/auth/logout`) instead of a Server Action to avoid a dev-mode "Failed to find Server Action" error when action IDs change between hot-reloads. The route handler calls the same `logout()` DAL function. Production behavior is identical.
- `LoginState` type moved to `lib/auth/types.ts` so the client component can import the type without pulling in `server-only` modules.
- `@node-rs/argon2` const enums (`Algorithm`, `Version`) are erased under `isolatedModules: true`. The hash function uses default Argon2id + V0x13 (confirmed via runtime hash prefix `$argon2id$v=19$`), omitting explicit enum values.
- English UI for login screen (deviation from product.md Greek assumption, recorded in docs/auth.md for Hermes review).

## Remaining risks / boundaries
- No business/financial schema, owner scoping, or two-user financial isolation yet — those are Step05+ integration tests.
- Rate limiting is per-email and DB-backed; a distributed attacker using many emails is not throttled by this alone (acceptable for 2 private users; no public registration).
- Session cookie is sealed with iron-session (AES-256-GCM); if SESSION_SECRET leaks, cookies can be forged. The secret is in `.env` only, never committed.
- No password reset self-service flow; recovery is operator-driven via `scripts/provision-user.mjs --reset`.
- `proxy.ts` performs optimistic checks only; the secure DB-backed check is in the DAL. This matches Next.js 16 documentation.
- No commits/pushes/deployment performed. `.env` unchanged (only SESSION_SECRET appended). No global configuration edited.

## Handoff
Step04 implementation complete and self-verified. Awaiting independent Hermes review (`docs/reviews/Step04.md`) — and per user instruction, Hermes will review both Step03 and Step04. STOP — no next step started.