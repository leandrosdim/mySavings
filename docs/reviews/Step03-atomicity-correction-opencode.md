# Step03 — OpenCode implementer self-report (bounded atomicity correction)

Status: Bounded S3-01 correction implemented and self-verified; awaiting independent Hermes review. NOT self-marked complete. This is a correction pass in response to `docs/reviews/Step03.md` S3-01; it does not change Step03/Step04 approval status or the registry. Step04 independently user-implemented work is preserved untouched.

## Scope (bounded)
Only the S3-01 migration-scanner atomicity blocker and the related test-safety observation from `docs/reviews/Step03.md`:
- No auth changes, new migrations, Step05 work, commits/pushes, global config changes, production migrations or real-user changes.
- Applied migration SQL (`db/migrations/0001_schema_migrations.sql`, `db/migrations/0002_identity.sql`) and the production `public.schema_migrations` ledger were not altered.
- `.env` not read into prompts/logs and not modified.
- No real DB errors, connection strings or credentials printed.

## S3-01 fix: transaction-control family escape

### Root cause
`db/migrations.js` `firstToken` captured up to two whitespace-separated words and `checkStatementSafe` compared the result by exact equality against a fixed keyword list. Thus `COMMIT` was rejected, but `COMMIT WORK`, `COMMIT TRANSACTION`, `COMMIT AND CHAIN`, `COMMIT AND NO CHAIN`, `END WORK`, `START/**/TRANSACTION` (comment between keywords), `SET LOCAL search_path`, and `RESET` variants did not equal any list entry and were accepted. An early `COMMIT` in a migration file released the outer migration transaction (and the advisory lock), so a later failure left the table and the `schema_migrations` ledger persisted despite the runner reporting failure — defeating atomic SQL+ledger guarantees and runner serialization.

### Correction
Replaced `firstToken` + exact-list match with a leading-keyword tokenizer (`extractLeadingKeywords`) and a family-prefix matcher (`isTransactionControlOrOverride`). `splitTopLevelStatements` already faithfully handled line comments, nestable block comments, single-quoted strings (`''` escapes), double-quoted identifiers, and dollar-quoted strings; the new matcher builds on that by skipping whitespace AND comments between leading keywords, so `START/**/TRANSACTION` and `/* ... */`-separated controls cannot evade the guard.

Rejected by leading keyword family (regardless of trailing clauses):
- `COMMIT` — covers `COMMIT`, `COMMIT WORK`, `COMMIT TRANSACTION`, `COMMIT AND CHAIN`, `COMMIT AND NO CHAIN`.
- `ROLLBACK` — covers `ROLLBACK`, `ROLLBACK WORK`, `ROLLBACK TRANSACTION`, `ROLLBACK AND CHAIN`, `ROLLBACK AND NO CHAIN`, `ROLLBACK TO SAVEPOINT ...`.
- `END` — covers `END`, `END WORK`, `END TRANSACTION`, `END AND CHAIN`.
- `ABORT` — covers `ABORT`, `ABORT WORK`.
- `BEGIN`, `DISCARD` (covers `DISCARD ALL`/`TEMP`/`PLANS`/`SEQUENCES`), `UNLISTEN`.
- `START TRANSACTION` — prefix match; also covers `START/**/TRANSACTION` and `START /* ... */ TRANSACTION` (comments skipped between keywords).
- `PREPARE TRANSACTION` — two-phase commit.
- `SET` / `RESET` overrides: `SET SESSION ...`, `SET LOCAL ...`, `SET ROLE ...`, `SET search_path ...`, `SET TRANSACTION ...`, `SET SESSION AUTHORIZATION ...`, `SET SESSION CHARACTERISTICS ...`; `RESET search_path`, `RESET ROLE`, `RESET ALL`, `RESET SESSION AUTHORIZATION`, `RESET LOCAL ...`; quoted setting identifiers (`SET "search_path" ...`, `SET LOCAL "role" ...`, `RESET "search_path"`, `SET "session_authorization" ...`). A bare `SET`/`RESET` with no target, or an unterminated quoted identifier, is rejected as ambiguous rather than allowed to bypass the guard.

Preserved (still accepted):
- Ordinary GUCs that do not affect the transaction, role or `search_path` (e.g. `SET statement_timeout = 5000`, `SET work_mem = '64MB'`, `SET TimeZone = 'UTC'`).
- `DO` block procedural `BEGIN`/`END` (matched by leading `DO`; the dollar-quoted body is never scanned for top-level control).
- Transaction keywords inside strings, comments, and dollar-quoted bodies.
- Quoted identifiers that look like keywords (`SELECT "COMMIT" FROM foo`).

Non-transactional utility statements (`VACUUM`, `CREATE DATABASE`, `CREATE INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY`, `ALTER SYSTEM`, `CLUSTER`, `CREATE/DROP TABLESPACE`) are now matched by leading keyword prefix, so occurrences inside strings/comments can no longer trip a false positive.

### Boundary (honest)
The scanner is a conservative defense against accidental transaction escape in **trusted, reviewed** migration files under `db/migrations/*.sql` — the only files the runner executes. It is **not** a security sandbox for arbitrary, untrusted or procedurally hostile SQL. The migration directory is a reviewed, trusted boundary; the scanner rejects the known-dangerous top-level patterns but does not attempt to be a complete SQL parser. This is documented in `docs/database.md`.

## Tests added

### Offline production-scanner tests (`tests/unit/db/sql-scanner.offline.test.ts`)
Added 58 new cases (file grew from 54 → 112 tests):
- The real failing regression sequence `CREATE TABLE escaped(id integer); COMMIT WORK; SELECT 1/0;` (rejected).
- COMMIT family: `COMMIT WORK`, `COMMIT TRANSACTION`, `COMMIT AND CHAIN`, `COMMIT AND NO CHAIN`, bare `COMMIT`, `COMMIT WORK` after DDL.
- ROLLBACK family: `ROLLBACK WORK`, `ROLLBACK TRANSACTION`, `ROLLBACK AND CHAIN`, `ROLLBACK AND NO CHAIN`, `ROLLBACK TO SAVEPOINT`, bare `ROLLBACK`.
- END/ABORT family: `END WORK`, `END TRANSACTION`, `END AND CHAIN`, bare `END`, `ABORT WORK`, bare `ABORT`.
- `START/**/TRANSACTION`, `START /* x */ TRANSACTION`, `START TRANSACTION READ ONLY`.
- `PREPARE TRANSACTION 'tx1'`, `PREPARE TRANSACTION 'tx1' FOR COMMIT`.
- Commented forms: `COMMIT WORK` after line/block/nested comments; `COMMIT AND CHAIN` after block comment; `ROLLBACK` after nested block comment.
- Session/search_path/role overrides: `SET SESSION search_path`, `SET LOCAL search_path`, `SET SESSION AUTHORIZATION`, `SET ROLE`, `SET search_path = / TO`, `SET LOCAL ROLE`, `SET TRANSACTION ISOLATION LEVEL`, `SET SESSION CHARACTERISTICS`, `RESET search_path`, `RESET ROLE`, `RESET ALL`, `RESET SESSION AUTHORIZATION`, `RESET LOCAL search_path`, `DISCARD ALL`, `DISCARD TEMP`, `UNLISTEN *`, and quoted forms `SET "search_path"`, `SET LOCAL "role"`, `RESET "search_path"`, `SET "session_authorization"`.
- Preserved safe SET of ordinary GUCs: `SET statement_timeout`, `SET statement_timeout TO`, `SET work_mem`, `SET TimeZone`, `SET client_min_messages`.
- Preserved legitimate strings/comments/dollar quotes/DO: transaction keywords inside DO dollar-quoted body, inside a dollar-quoted string literal, only inside block comments, only inside a single-quoted string, and quoted identifiers that look like keywords.

### Isolated live production-runner tests (`tests/db/migrations.test.ts`)
Added 6 new cases (file grew from 12 → 18 tests), all against unique disposable `step03_test_*` schemas with create/drop inside explicit `BEGIN`/`COMMIT`/`ROLLBACK`; no failure probes in `public`:
- `S3-01 atomicity: COMMIT WORK escape is rejected before applying` — writes the real failing sequence `CREATE TABLE escaped(id integer); COMMIT WORK; SELECT 1/0;` and proves the runner rejects it (`/top-level|override|MIGRATION_UNSAFE_SQL/`) with no surviving `escaped` table and no `schema_migrations` table in the disposable schema (the whole run rolled back, including the bootstrap ledger).
- `rejects COMMIT AND CHAIN with no surviving table or ledger`.
- `rejects START/**/TRANSACTION with no surviving ledger`.
- `rejects SET LOCAL search_path override with no surviving table`.
- `S3-01 atomicity: retained valid DO block and idempotent re-run` — accepts and applies a `DO $$ BEGIN ... END $$` whose body contains `BEGIN/END`, then a second run skips both (idempotent).
- `retains history across runs: applied ledger matches file checksums`.

The existing 12 migration integration tests (idempotence, rollback, checksum refusal, concurrency serialization, VACUUM rejection, top-level COMMIT rejection, comment-separated COMMIT, DO block acceptance, live failure isolation, prevalidation out-of-order/missing/invalid filename) are unchanged and still pass.

## Test safety fix (observation from Step03.md "Other observations")

- `npm test` now forces `DB_TEST_ALLOW_WRITES=` empty in the script (`package.json`) so an inherited `DB_TEST_ALLOW_WRITES=1` can never silently switch the ordinary offline run into a write-enabled DB run. Verified: `DB_TEST_ALLOW_WRITES=1 npm test` still runs the offline suite (266 tests, 7 files, no DB).
- `npm run test:db` no longer sets `DB_TEST_ALLOW_WRITES=1` itself. It runs `node scripts/require-db-test-env.mjs && vitest run`, which fails loudly (exit 1, clear message) when `DB_TEST_ALLOW_WRITES=1` is not supplied externally. Exact live command: `DB_TEST_ALLOW_WRITES=1 npm run test:db`. Verified: `env -u DB_TEST_ALLOW_WRITES npm run test:db` exits 1 with the opt-in message.
- `vitest.config.mts` removed the dynamic `exclude` of `tests/db` / `tests/auth`, and the DB suite include is now cumulative (also includes `tests/unit/**/*.test.ts`) so production-scanner regressions run in both modes and nothing is silently excluded when explicitly selected. A DB/auth test explicitly selected on the CLI without `DB_TEST_ALLOW_WRITES=1` is loaded (CLI patterns extend the include candidate set) and fails loudly via `requireDatabaseUrl()` rather than being silently filtered out.
- Shared auth tests are preserved untouched; no unsafe broad cleanup is performed (schema drop still validates the `step03_test` / `step03_db_test` / `step04` prefix/identity before any drop).

## Files changed
- `db/migrations.js` — replaced `firstToken` + `TOP_LEVEL_BLOCKED_KEYWORDS` exact-list match with `extractLeadingKeywords` + `isTransactionControlOrOverride` family-prefix matcher; `isDoBlock` now uses the tokenizer; `checkStatementSafe` matches non-transactional utility statements by leading keyword prefix. Exports unchanged (`assertTransactionSafe`, `splitTopLevelStatements`, `checkStatementSafe`, etc.).
- `tests/unit/db/sql-scanner.offline.test.ts` — +58 offline scanner regression/family/preserve cases.
- `tests/db/migrations.test.ts` — +6 isolated live production-runner atomicity/DO/history cases.
- `vitest.config.mts` — removed dynamic exclude; DB suite include cumulative; documented opt-in contract.
- `package.json` — `test` forces offline; `test:db` requires external opt-in via guard script.
- `scripts/require-db-test-env.mjs` — new guard that fails loudly without `DB_TEST_ALLOW_WRITES=1`.
- `docs/database.md` — documented the scanner families, quoted-identifier/SET LOCAL/RESET handling, trusted-reviewed-migrations boundary, and exact offline/live commands.

## Verification results
- `npm run lint`: PASS (exit 0).
- `npm run typecheck` (`next typegen && tsc --noEmit`): PASS (exit 0).
- `npm test` (offline): PASS — 7 files, 266 tests. Verified offline even with inherited `DB_TEST_ALLOW_WRITES=1`.
- `npm run build`: PASS (exit 0); routes: `/`, `/_not-found`, `/api/auth/logout`, `/dashboard`, `/login`.
- `npm audit`: 0 vulnerabilities.
- `npm run db:check`: `database:reachable=true`.
- Targeted opt-in migration tests (`DB_TEST_ALLOW_WRITES=1 npx vitest run tests/db/migrations.test.ts tests/unit/db/sql-scanner.offline.test.ts`): PASS — 2 files, 130 tests (112 scanner + 18 live migration). Real Neon, disposable `step03_test_*` schemas.
- Cleanup verification: `leftover_test_schemas:[]` (0 leftover `step03_*` / `step04*` schemas after the live run).
- Production ledger unchanged: `public.schema_migrations` versions `["0001_schema_migrations","0002_identity"]`; applied migration SQL files not edited.

## Blockers
None for this bounded correction. The full cumulative `npm run test:db` (auth + finance + db + unit) was not re-run end-to-end in this pass; only the targeted migration + scanner opt-in tests were run live (per "targeted opt-in migration tests"). Hermes may rerun the full live suite independently.

## Handoff
Bounded S3-01 correction complete and self-verified. Step03 status remains `review_blocked`; independent review and registry approval remain with Hermes. STOP — no next step started.