# Step03 — OpenCode implementer self-report

Status: Implemented; awaiting independent Hermes review. NOT self-marked complete.

## Scope
Step03 only: Neon PostgreSQL connection and forward SQL migration infrastructure. No business or authentication schema, no commits/pushes/deployment/production migration, no next-step implementation.

## Prerequisites verified
- Working tree was clean before launch (git status empty, git diff --check clean).
- Step02 independently verified (129 finance tests); its review read.
- User explicitly authorized this project's private `.env` Neon URL for Step03 development/test migrations and isolated disposable tests. The URL was never printed/logged/committed. `.env` preserved exactly (not modified).
- `.env` contains only `DATABASE_URL` (verified keys only, values redacted). Treated as mySavings dev/test Neon target per user authorization; not inferred as production.

## Files created
- `lib/db.ts` — server-only (`import "server-only"`) pg pool, env validation, `getPool`/`closePool`/`query`/`withTransaction`, `DatabaseConfigError`. TLS `rejectUnauthorized: true`. Connection/query timeouts. Safe errors that never include URL values.
- `db/migrations.js` — CJS forward SQL migration runner: loads `.env` without logging, validates URL, `schema_migrations(version PK, checksum, applied_at)` ledger, transaction-level `pg_advisory_xact_lock` held inside the same BEGIN/COMMIT that records the ledger row, SHA-256 checksum mismatch refusal, idempotent skip on second run, atomic SQL+ledger, non-transactional statement blocklist (VACUUM/CREATE DATABASE/CONCURRENTLY/ALTER SYSTEM/CLUSTER/TABLESPACE). Accepts optional `{ migrationsDir, schema }` so tests exercise the real production function against disposable schemas without duplicating logic.
- `db/migrations/0001_schema_migrations.sql` — first forward migration creating the durable ledger.
- `scripts/db-check.mjs` — ephemeral `SELECT 1` reachable-boolean check; prints `database:reachable=true|false`, never the URL.
- `scripts/load-env.mjs` — minimal `.env` loader (no logging), shared by scripts/tests.
- `tests/__mocks__/server-only.ts` — empty stub so vitest can import `lib/db.ts` (which is guarded by `server-only`) without Next runtime.
- `tests/db/helpers.ts` — DB test helpers: disposable unique schema create/drop, `schemaHasTable`, pool factory.
- `tests/db/migrations.test.ts` — 5 migration integration tests (real Neon).
- `tests/db/db.test.ts` — 7 lib/db integration tests (real Neon).
- `docs/database.md` — connection modes, pooled vs direct/migration URL rationale, transaction-level advisory lock explanation, npm scripts, file naming.

## Files modified
- `package.json` — added `pg@8.23.0`, `server-only@0.0.1` deps; `@types/pg@8.11.10` devDep; `db:migrate` and `db:check` scripts. Existing deps remain exact-pinned.
- `package-lock.json` — lockfile updated by npm install.
- `.env.example` — added `MIGRATION_DATABASE_URL` blank placeholder with rationale; `DATABASE_URL` blank preserved.
- `vitest.config.mts` — added `server-only` alias to the empty test mock.

## Schema/API decisions
- Only migration metadata table `schema_migrations` created in `public` (real project ledger) and in disposable per-test schemas. No business/auth tables.
- Migration lock: `pg_advisory_xact_lock` (transaction-level), NOT `pg_advisory_lock` (session-level). Rationale: Neon's pooled endpoint fronts PgBouncer transaction mode where session locks do not survive. Transaction-level lock is bound to the same transaction that writes the ledger, safe under transaction pooling. `MIGRATION_DATABASE_URL` (optional, direct endpoint) documented as defense-in-depth; falls back to `DATABASE_URL`.
- `withTransaction` checks out one client, BEGIN/work/COMMIT, ROLLBACK on error, release in finally. Never uses `pool.query` for transactional statements.
- All SQL parameterized; no ORM/query builder.

## Real Neon integration tests (genuine, not mocked)
Run against the authorized mySavings dev/test Neon database using uniquely-named disposable schemas (`step03_test_<rand>` / `step03_db_test_<rand>`), dropped after each test. Tests call the real `runMigrations` production function and real `lib/db` pool.

Migration tests (tests/db/migrations.test.ts):
1. Idempotence: apply 0001+0002 (applied=2), second run skips both (applied=0, skipped=2). PASS.
2. Failure rollback: 0003 references nonexistent table → error; 0003 ledger row absent; 0002 table absent (whole run transaction rolled back atomically). PASS.
3. Checksum mismatch: apply 0001+0002, overwrite 0002 SQL, re-run → /Checksum mismatch/ error; table columns unchanged. PASS.
4. Concurrency: two `runMigrations` in parallel via Promise.all → advisory lock serializes; total applied=2, total skipped=2; exactly one ledger row for 0002_concurrent. PASS.
5. Non-transactional rejection: 0002 contains VACUUM → /non-transactional/ error before applying. PASS.

lib/db tests (tests/db/db.test.ts):
1. Missing DATABASE_URL → DatabaseConfigError /Missing required env/. PASS.
2. Non-postgres URL → DatabaseConfigError /expected postgres protocol/. PASS.
3. Secret marker in invalid URL not present in error message. PASS.
4. `query("SELECT 1 AS ok")` → rows[0].ok === 1 (reachable). PASS.
5. `withTransaction` commit: table+row persist after commit. PASS.
6. `withTransaction` rollback: error → table absent. PASS.
7. Pool.query does not share transaction state (explicit BEGIN/ROLLBACK on a checked-out client leaves no table). PASS.

## Verification commands and results
- `npm run lint`: PASS (exit 0).
- `npm run typecheck` (`next typegen && tsc --noEmit`): PASS (exit 0).
- `npm test` (`vitest run`): 6 files, 141 tests PASS (129 finance + 12 DB), 6.54s.
- `npm run build`: PASS (exit 0); static `/` and `/_not-found` routes only, no new routes.
- `npm audit`: 0 vulnerabilities (exit 0).
- `npm run db:check`: `database:reachable=true`.
- `npm run db:migrate` (real project `public`): first run `1 applied, 0 skipped`; second run `0 applied, 1 skipped` (idempotent).
- `git diff --check`: PASS (no whitespace errors).
- `git status --short --untracked-files=all`: 4 modified, 9 new untracked files (listed above).

## Synthetic fixture cleanup
- All disposable test schemas (`step03_test_*`, `step03_db_test_*`) dropped after each test via afterEach/afterAll.
- Verified post-run: `information_schema.schemata` reports 0 leftover `step03_test_%` / `step03_db_test_%` schemas.
- Real `public.schema_migrations` intact: exactly 1 row, version `0001_schema_migrations`.
- No test-owned processes/servers left running; test pools closed in afterAll.
- Temp migration directories removed from OS tmpdir after each test.

## Deviations and verification impact
- `runMigrations` extended with optional `{ migrationsDir, schema }` params (defaults unchanged) so tests exercise the real production function against disposable schemas instead of duplicating logic. CLI path (`npm run db:migrate`) uses defaults and is identical to production behavior.
- `server-only` stub added under `tests/__mocks__/` and aliased in vitest config so the server-only boundary can be unit-tested without removing the production guard. The real `server-only` package remains a production dependency and still blocks client-component imports in Next builds.
- pg SSL warning (`sslmode=require` treated as `verify-full` alias in pg 8.x) is informational only; `rejectUnauthorized: true` is set explicitly. No TLS verification disabled.

## Remaining risks / boundaries
- `withTransaction` and migration runner tested on real Neon; session-level advisory locks and pgbouncer-specific behavior beyond transaction mode not exercised (transaction-level lock is the supported path).
- No business schema, owner scoping, two-user isolation, or auth yet — those are Step04/Step05 integration tests.
- pg 8.23.0 SSL-mode aliasing will change semantics in pg v9; revisit before any pg major upgrade.
- No commits/pushes/deployment performed. `.env` unchanged. No global configuration edited.

## Handoff
Step03 implementation complete and self-verified. Awaiting independent Hermes review (`docs/reviews/Step03.md`) before status update. STOP — no next step started.