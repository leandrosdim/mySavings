# Authentication decision (Step04)

## Approved approach
Email + password with DB-backed sessions, implemented with stable libraries
over raw SQL. No external identity provider, no public registration, no custom
cryptography.

## Selected libraries and versions
- `iron-session@9.0.1` — encrypted, stateless cookie that stores only the
  opaque session ID. Used purely as the cookie seal, not as the session store.
- `@node-rs/argon2@2.2.1` — Argon2id password hashing via native bindings
  ( maintained, OWASP-recommended memory-hard KDF ). No JS-only or hand-rolled
  hashing.
- `pg@8.23.0` (already present) — raw parameterized SQL for all identity and
  session queries. No ORM, no query builder, no auth adapter.

## Sign-in method
Email + password. The two private users are provisioned by the operator via
`scripts/provision-user.mjs`, which reads credentials from interactive stdin
(never `argv`, never committed files). Passwords are hashed with Argon2id
before reaching the database. No public registration route exists.

## Session strategy
DB-backed sessions for true revocation before cookie expiry.

1. On successful login the server creates a row in `sessions` and stores only
   the session id inside an iron-session-sealed HttpOnly cookie.
2. Every protected server request re-reads the session row from the database
   and checks `expires_at` and `revoked_at`. Deleting/revoking the row logs the
   user out immediately, regardless of cookie TTL.
3. The cookie value is opaque (a sealed id, not user data). No user id, email,
  password hash or token ever reaches the client.

## Route protection
- `proxy.ts` (Next.js 16) performs optimistic cookie-only checks and redirects
  unauthenticated users to `/login`. This is the documented Next.js 16 pattern;
  no `middleware.ts` is created.
- Every Server Component data fetch, Server Action and Route Handler calls the
  data-access-layer `verifySession()` independently. Proxy is not the only
  line of defense.
- APIs return 401/403 JSON, never a login HTML page. The API guard
  (`requireApiSession` / `requireApiUser`) returns JSON 401/503 independently
  of any proxy. Pages retain redirects.
- Ownership is always derived from the verified server session, never from
  submitted `user_id`. The API guard alone does not provide financial
  isolation; scoped reads/writes must use the session's `userId` in their
  `WHERE` clauses (two-user isolation).

## CSRF and origin
- Server Actions rely on Next.js' built-in Origin/Host validation. If a custom
  domain is added, `experimental.serverActions.allowedOrigins` is configured.
- Login/logout are Server Actions; no cross-origin form submissions accepted.
- SameSite=Lax, HttpOnly, Secure (production) cookies.

## Rate limiting and account enumeration
- Login attempts write to `login_attempts` (throttled window per email). The
  in-process counter is backed by the database so it survives serverless
  restarts and is not a process-local map.
- Login errors return a single generic "invalid credentials" message whether
  the email is unknown or the password is wrong, to avoid account enumeration.

## Admission before hash (S4-01 remediation)
- Admission is atomic and happens BEFORE any credential lookup or hashing.
  The `admitLoginAttempt` function acquires a single global
  `pg_try_advisory_xact_lock` (non-blocking, fail-fast) to bound hash
  concurrency to 1 across instances. Within the same transaction it checks
  per-account (5 attempts/5 min) and global (100/10 min) failure windows,
  executes the credential lookup + real/dummy Argon2 verification callback,
  records the attempt (success or failure), and commits.
- `pg_try_advisory_xact_lock` is non-blocking: a request that cannot acquire
  the lock returns a "busy" retry message instead of queueing. This bounds
  cross-instance hash concurrency to 1 without session locks (Neon pooler
  safe).
- Unknown emails perform a real Argon2id verification against a cached dummy
  hash at the same parameters as a known user, so the login path spends
  comparable CPU regardless of whether the email exists. The dummy hash is
  cached and never exposed before admission.
- Per-account 5 attempts/5 min, global explicit budget (100/10 min).
  Active-window records are never deleted to bypass quota. Retention
  cleanup deletes ONLY expired records in a bounded batch (500), under the
  SAME admission transaction on the SAME client (no nested locks). The
  inlined cleanup runs after the global advisory lock is acquired and
  before the per-account/global window checks, so it cannot reduce the
  active counts. A standalone `cleanupOldLoginAttempts` export is kept for
  direct unit testing of the expired-only/bounded semantics.
- Availability policy (strict private-app): the per-account 5 failures / 5
  min and global 100 failures / 10 min throttles CAN TEMPORARILY BLOCK a
  legitimate login. A real user with repeated typos can hit the per-account
  cap; a burst that consumes the global budget blocks everyone until the
  window slides. This is NOT "no account lockout" — it is an intentional
  strict throttle for a private two-user app with no public registration.
  The hash-concurrency-1 fail-fast (`pg_try_advisory_xact_lock`) is also
  deliberate: concurrent legitimate logins may see the "busy" retry message
  and must retry. The tradeoff favors DoS resistance over concurrent-login
  convenience for two users.
- The callback returns `passwordOk: false` for wrong passwords (does NOT
  throw). Genuine DB errors propagate and roll back the transaction without
  recording an attempt.
- Session issuance happens AFTER the admission transaction commits, using
  the existing credential row-lock revalidation in
  `createSessionWithCredentialCheck` (FOR UPDATE on the user row, hash
  comparison). A reset that committed between the admission transaction and
  session issuance causes `CredentialChangedError` and no session is created.

## CSRF and origin (S4-03 remediation)
- Server Actions rely on Next.js' built-in Origin/Host validation. If a custom
  domain is added, `experimental.serverActions.allowedOrigins` is configured.
- Login/logout are Server Actions; no cross-origin form submissions accepted.
- SameSite=Lax, HttpOnly, Secure (production) cookies.
- The logout route (`app/api/auth/logout/route.ts`) validates the request
  `Origin` header against the canonical configured trusted origin. It
  requires a canonical HTTP(S) origin exactly: scheme://host, no path, query,
  fragment, or userinfo. Config origins may have a trailing slash normalized
  away; request origins may not. Production requires HTTPS. Literal
  null/undefined, multi-origin (comma-separated), and malformed configured
  origins are rejected. Bad config returns a safe 503, never builds a redirect
  from raw invalid input.
- Never clears the cookie for a forbidden Origin (no cross-site logout CSRF).

## Logout honesty (S4-02 remediation)
- On a DB revocation failure, the logout route returns an honest 503
  `no-store` response with the local `Set-Cookie` cleared and a safe
  retry/recovery message. It does NOT return a normal 303 success redirect
  identical to the success path.
- The `logoutAction` server action also does not fake normal success on DB
  failure; it redirects to `/login` but the DB failure is not hidden from
  the caller.
- The unrevoked server session will expire naturally per `SESSION_TTL_SECONDS`
  (7 days). During an outage, replay of the sealed cookie is possible until
  the server session row expires; this limitation is documented honestly
  rather than hidden behind false success.

## Provisioning and recovery
- `scripts/provision-user.mjs` is operator-only. It prompts for email and
  password via stdin (hidden input where available), hashes the password, and
  inserts the user inside a `withTransaction` block.
- Recovery is operator-driven: reset a password by re-running the script with
  a `--reset` flag against an existing email. No self-service recovery flow.
- Real user provisioning requires explicit user authorization. QA uses two
  disposable synthetic identities (A/B) that are cleaned up after tests.

## UI language
English copy for the login screen in v1. Greek localization is deferred to a
later step. This is a deliberate deviation from the product.md Greek
assumption, recorded here for Hermes review. Code identifiers and docs stay
English.

## Not selected (and why)
- NextAuth/Auth.js: v5 (proxy.ts-native) is beta (conflicts with "no beta");
  v4 leans on middleware.ts and JWT-by-default. The `@auth/pg-adapter` owns
  the identity schema and generates SQL, conflicting with the raw-SQL rule.
  Ruled out after user discussion.
- Magic link: requires a mail provider (extra secret/dependency) for 2 users.
- OAuth: adds third-party client secrets and metadata leakage for 2 private
  users.

## Boundaries
- No business or financial schema here. Only `users`, `sessions`,
  `login_attempts`. Owner-scoped financial tables arrive in Step05.
- No commits, pushes, deployment or production migration in this step.
- `.env` is never printed. `SESSION_SECRET` is documented in `.env.example`
  as a blank placeholder.

## Test fixture setup and cleanup (S4-05)
- All auth integration tests run against disposable, uniquely-named
  `step04_*` schemas on the approved project test database — never against the
  `public` schema. The identity migration (0001 + 0002) is applied into each
  disposable schema via the real migration runner.
- A test-only Pool with a per-connection `SET search_path` override is injected
  into `lib/db` via `__setTestPool` so production auth code resolves to the
  disposable schema's tables without any production code change. `__setTestPool`
  is guarded: it throws unless `NODE_ENV=test`, refuses in production builds,
  and refuses to overwrite a non-test cached pool.
- `createSession` (test/CLI-only direct session creation) is guarded: it throws
  unless `NODE_ENV=test`. Production login must use
  `createSessionWithCredentialCheck`.
- No public/global fixture writes. No public `login_attempt` cleanup in tests.
  Each test file owns its own schema and tears it down in `afterAll` via
  `DROP SCHEMA ... CASCADE`.
- All DB fixture writes are explicit transactions (BEGIN/COMMIT/ROLLBACK on one
  client). Isolated schemas/options ensure production helpers use the test
  schema.
- The `vitest.db.config.mts` config runs all DB test files in a single thread
  (`fileParallelism: false`, `singleThread: true`) because the global advisory
  lock and pool injection are process-global. This serializes test files to
  avoid lock contention and pool-injection races.
- Safe fixture review: inspect `tests/auth/helpers.ts` and `tests/db/helpers.ts`
  before running. `dropDisposableSchema` refuses to drop non-test schemas
  (only `step03_*` and `step04_*` prefixes are allowed).
- Run: `DB_TEST_ALLOW_WRITES=1 npm run test:db -- tests/auth`