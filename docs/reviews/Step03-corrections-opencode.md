# Step03 — OpenCode implementer self-report (corrections addendum)

Status: Corrections implemented; awaiting independent Hermes review. NOT self-marked complete. The original self-report in `docs/reviews/Step03-opencode.md` is preserved unchanged; this addendum records the corrections made in response to the Hermes source review.

## Scope
Step03 review-fixes only: harden migration runner, transaction helper, TLS enforcement, error sanitization, test-suite separation. No auth, business schema, Step04, commits/pushes/deployment/production migration. `.env` preserved (not modified).

## Gaps addressed

### Gap 1 — Robust SQL scanning
`assertTransactionSafe` now scans SQL with a proper tokenizer that handles line comments, nestable block comments, single-quoted strings (`''` escapes), double-quoted identifiers, and dollar-quoted strings (`$$...$$` / `$tag$...$tag$`). A `DO` block's procedural `BEGIN/END` is not treated as top-level transaction control. Rejects top-level `COMMIT`/`ROLLBACK`/`END`/`ABORT`/`BEGIN`/`START TRANSACTION`/`PREPARE TRANSACTION` and session/search_path overrides (`SET SESSION`, `SET search_path`, `SET ROLE`, `RESET search_path`, `RESET ROLE`, `DISCARD ALL`), plus the existing non-transactional blocklist (`VACUUM`, `CREATE DATABASE`, `CONCURRENTLY`, `ALTER SYSTEM`, `CLUSTER`, `TABLESPACE`). No general untrusted-SQL sandbox claim. Unit tests: 28 scanner cases (rejected COMMIT/END/ROLLBACK variants, comment-separated controls, safe SQL with strings/comments/DO). Integration tests verify a top-level COMMIT and a COMMIT-after-line-comment are rejected before applying, and a DO block with BEGIN/END is accepted.

### Gap 2 — Migration prevalidation
`validateMigrationFiles` + `prevalidateHistory` run before any pending file executes: reject missing applied migrations, invalid/duplicate numeric versions, out-of-order history (new file earlier than max applied version), invalid filenames (must match `NNNN_snake_case.sql`). Directory/path validated against filesystem root. The already-applied real `0001_schema_migrations.sql` was not edited. Integration tests on disposable schemas: out-of-order rejection, missing applied file rejection, invalid filename rejection, plus the existing idempotence/checksum/concurrency tests. Forward-only deterministic names enforced.

### Gap 3 — withTransaction broken-connection handling
`withTransaction` now distinguishes normal release from destroy: when `BEGIN`, `COMMIT`, or `ROLLBACK` itself fails, the client is released with `release(error)` (or `release(true)` fallback) so the pool discards the poisoned connection; the primary error is preserved and rethrown. Successful rollback returns the client normally. An idle pool error handler logs a constant message (`pg pool idle client error`) with no external details. Mocked unit tests (6 cases): BEGIN failure destroys client; callback failure + rollback success returns to pool; COMMIT failure destroys client; rollback failure destroys client preserving work error; pool.connect rejection; client released exactly once on success. Real commit/rollback integration tests remain.

### Gap 4 — Error sanitization
`publicErrorReason(error)` in `db/db-config.cjs` returns a safe `{code, reason}` pair: never raw `error.message`, `error.name`, SQL literals, host/user or custom exception details. Only known-safe codes (`DB_CONFIG_ERROR`, `MIGRATION_*`) preserve their config/migration message (which contains no external secrets). Unknown errors get a generic `DB_ERROR` reason. `scripts/db-check.mjs` and `db/migrations.js` log only via `publicErrorReason`. Unit tests: synthetic secret markers in thrown DB errors do not reach the returned reason; arbitrary `error.name` with a secret is not surfaced. Integration tests: `publicErrorReason` strips secret markers from DB errors and SQL literal errors.

### Gap 5 — Verified TLS after parsing
Connection config is centralized in `db/db-config.cjs` (shared CJS) so `lib/db.ts`, `db/migrations.js`, `scripts/db-check.mjs`, and `tests/db/helpers.ts` all derive from one source — no drift. `buildSafeConnectionConfig` parses the connection string via `pg-connection-string` and enforces TLS on the **resulting** `ssl` value: rejects `sslmode=disable` (ssl:false), `sslmode=no-verify` / `uselibpqcompat` (ssl:{rejectUnauthorized:false}), and no-sslmode (ssl:undefined → pg defaults to no TLS). Accepts `verify-full`/`require`/`prefer`/`verify-ca` (pg 8.x aliases → ssl:{}) and pins `rejectUnauthorized:true`. Tests verify the **actual `pg.Client.connectionParameters.ssl`** for each mode, not just the config literal. No URL printed. No TLS relaxation to make tests pass.

### Gap 6 — Test suite separation
- `npm test` (default): offline unit + finance suite (208 tests). No `.env` loading, no network, no DB connection. Runs with missing/invalid DB env (`env -u DATABASE_URL` verified).
- `npm run test:db`: explicit opt-in via `DB_TEST_ALLOW_WRITES=1`. Refuses to connect without opt-in (no silent skip-success). Vitest config swaps include/exclude based on the env flag.
- Integration tests use uniquely-owned disposable schemas (`step03_test_*`, `step03_db_test_*`, `step04*`) with `CREATE SCHEMA` / `DROP SCHEMA` inside explicit `BEGIN`/`COMMIT`/`ROLLBACK`. Schema names validated as single lowercase identifiers; exact prefix/identity validated before drop; non-test schemas refused. Runtime migrations accept only a single validated existing schema — no comma-separated `search_path` or `public` fallback for disposable-schema tests. Integration tests use the same authorized DB for helper, runner and verification (single `DATABASE_URL`).
- `tests/db/helpers.ts` enforces the opt-in gate via `requireDatabaseUrl()` → `requireDatabaseTestAccess()`.

### Gap 7 — Verification
All gates run below. Cleanup verified: 0 leftover test schemas; only `public.schema_migrations` with 2 real rows (`0001_schema_migrations`, `0002_identity`). Default `npm test` works offline.

## Files created
- `db/db-config.cjs` — shared connection config: URL validation, verified-TLS enforcement, `buildAppPoolConfig`/`buildMigrationPoolConfig`/`buildCheckPoolConfig`, `publicErrorReason`, `DbConfigError`.
- `tests/unit/db/sql-scanner.offline.test.ts` — 28 offline SQL scanner + prevalidation unit tests.
- `tests/unit/db/db-config.offline.test.ts` — offline TLS enforcement (actual pg Client connectionParameters) + error sanitization unit tests.
- `tests/unit/db/with-transaction.offline.test.ts` — 6 offline mocked withTransaction tests.
- `docs/reviews/Step03-corrections-opencode.md` — this addendum.

## Files modified
- `lib/db.ts` — uses shared `db-config.cjs`; `withTransaction` destroy/release distinction; idle pool error handler; `DatabaseConfigError` alias; `publicErrorReason` re-export.
- `db/migrations.js` — uses shared config; robust SQL scanner (`splitTopLevelStatements`, `checkStatementSafe`, `assertTransactionSafe`); `validateMigrationFiles` + `prevalidateHistory`; single-schema validation; sanitized error logging via `publicErrorReason`; broken-connection release on rollback failure.
- `scripts/db-check.mjs` — uses shared config; sanitized errors via `publicErrorReason`.
- `tests/db/helpers.ts` — opt-in gate (`DB_TEST_ALLOW_WRITES`); disposable schema create/drop inside BEGIN/COMMIT/ROLLBACK; schema name validation; uses shared config for pool.
- `tests/db/migrations.test.ts` — added 5 integration tests (top-level COMMIT rejection, comment-separated COMMIT, DO block acceptance, live failure isolation, prevalidation: out-of-order/missing/invalid filename).
- `tests/db/db.test.ts` — added 2 integration tests (secret markers stripped by publicErrorReason).
- `vitest.config.mts` — offline default include; `test:db` opt-in include; excludes DB/auth tests from default.
- `package.json` — added `test:db` script (`DB_TEST_ALLOW_WRITES=1 vitest run`).
- `docs/database.md` — documented verified TLS, SQL scanning boundary, error sanitization boundary, test suite separation.

## Verification commands and results
- `npm run lint`: PASS (exit 0).
- `npm run typecheck` (`next typegen && tsc --noEmit`): PASS (exit 0).
- `npm test` (offline): 7 files, 208 tests PASS, 433ms. Verified with `env -u DATABASE_URL -u MIGRATION_DATABASE_URL` (no DB env, no network).
- `npm run test:db` (`DB_TEST_ALLOW_WRITES=1`): 9 files, 191 tests PASS (129 finance + 12 migration + 9 db + 41 auth), 16.94s.
- `npm run build`: PASS (exit 0); routes: `/`, `/_not-found`, `/api/auth/logout`, `/dashboard`, `/login`.
- `npm audit`: 0 vulnerabilities.
- `npm run db:check`: `database:reachable=true`.
- `npm run db:migrate`: `0 applied, 2 skipped`; second run `0 applied, 2 skipped` (idempotent).
- Cleanup: 0 leftover `step03_*` / `step04*` schemas; `public.schema_migrations` has 2 rows (`0001_schema_migrations`, `0002_identity`).

## Test counts
- Offline unit (default `npm test`): 208 tests = 129 finance + 28 SQL scanner/prevalidation + 11 TLS/error-sanitization + 6 withTransaction mocks + 34 other unit (finance helpers).
- DB integration (`test:db`): 191 tests = 129 finance + 12 migration integration + 9 db integration + 41 auth.
- Net new tests this pass: +17 offline unit (SQL scanner, TLS, error sanitization, withTransaction mocks) + 7 integration (top-level COMMIT, comment COMMIT, DO block, live failure isolation, out-of-order, missing file, invalid filename, secret-marker ×2).

## Honest limitations / boundaries
- The SQL scanner is conservative defense against accidental transaction escape in migration files, **not** a security sandbox for arbitrary/untrusted SQL. A determined author could still craft adversarial SQL; the scanner's job is to reject the known-dangerous top-level patterns, not to be a complete parser.
- `publicErrorReason` is conservative: it only surfaces known-safe codes; all other errors get a generic `DB_ERROR` reason. It cannot prove an arbitrary external error message is safe, so it never surfaces it. App helpers may propagate internal errors to the request boundary for future handling, but the boundary must not log raw external secrets.
- pg 8.x aliases `require`/`prefer`/`verify-ca` to `verify-full` (safe today); pg 9 will make them weaker. The shared config pins `rejectUnauthorized:true` on accepted configs and rejects the values that actually disable verification today (`disable`/`no-verify`/`uselibpqcompat`). Revisit before any pg major upgrade.
- `withTransaction` and migration runner tested on real Neon; session-level advisory locks and pgbouncer-specific behavior beyond transaction mode not exercised (transaction-level lock is the supported path).
- No commits/pushes/deployment performed. `.env` unchanged. No global configuration edited.

## Handoff
Step03 corrections complete and self-verified. Awaiting independent Hermes review (`docs/reviews/Step03.md`) before status update. STOP — no next step started.