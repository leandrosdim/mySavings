# Database connection and migrations

## Connection modes

mySavings uses raw parameterized PostgreSQL through `pg` (no ORM/query builder).

- **Application pool** (`DATABASE_URL`): used by `lib/db.ts` at runtime via a `pg.Pool` sized for Node/Vercel serverless functions. Use the Neon **pooled** endpoint (`-pooler`) with transaction pooling for the app.
- **Migration connection** (`MIGRATION_DATABASE_URL`, optional): used by `db/migrations.js`. For Neon, point this at the **direct** (non-pooled) endpoint so session-level and transaction-level advisory locks are honored. If `MIGRATION_DATABASE_URL` is unset, the runner falls back to `DATABASE_URL`.

### Why two URLs

Neon's pooled endpoint fronts PgBouncer in transaction mode. Session-level advisory locks (`pg_advisory_lock`) do not survive across pooled transactions and must not be used there. The migration runner uses **transaction-level** `pg_advisory_xact_lock` held inside the same transaction that records the ledger row, which is safe under transaction pooling. A direct endpoint is still recommended for migrations as defense in depth and to avoid lock/checkout churn with the app pool.

## Verified TLS enforcement

Connection configuration is centralized in `db/db-config.cjs` (shared CJS so the app, runner, check script and test helpers all derive from one source — no drift). TLS verification is enforced **after parsing** the connection string, not just in the literal config object:

- `sslmode=disable` (pg parses to `ssl:false`) → rejected (no TLS).
- `sslmode=no-verify` or `uselibpqcompat=true&sslmode=require` (pg parses to `ssl:{rejectUnauthorized:false}`) → rejected (no cert/hostname verification).
- No `sslmode` and no explicit `ssl` config → rejected (pg defaults to no TLS).
- `sslmode=verify-full`, `require`, `prefer`, `verify-ca` (pg 8.x aliases that parse to `ssl:{}`) → accepted; `rejectUnauthorized` is pinned `true` on the resulting object so tls.connect keeps its safe default.

Tests verify the **actual `pg.Client.connectionParameters.ssl`** for each mode, not just the config literal. `ssl:{}` keeps tls.connect's default `rejectUnauthorized:true`; the shared builder also sets it explicitly. No TLS relaxation is applied to make tests pass.

Never disable TLS verification. Both pools use the shared `buildSafeConnectionConfig` which enforces this.

## lib/db.ts

Server-only module (`import "server-only"`) so it can never be bundled into client code.

- `getPool()` — lazily creates a single cached `Pool` from validated `DATABASE_URL`. An idle-pool error handler logs a constant message (no external details) when an idle client errors out.
- `query(text, params)` — convenience read helper over the pool.
- `withTransaction(work)` — checks out one client, `BEGIN`, runs `work(client)`, `COMMIT` on success, `ROLLBACK` on error. **Broken/uncertain connections are destroyed**: when `BEGIN`, `COMMIT`, or `ROLLBACK` itself fails, the client is released with `release(error)` (or `release(true)` fallback) so the pool does not reuse a poisoned connection; the primary error is preserved. Successful rollback returns the client to the pool normally. Never use `pool.query` for statements that must share a transaction; pass all statements through the `client` handed to `work`.
- `closePool()` — for tests / graceful shutdown.
- `DbConfigError` / `DatabaseConfigError` (alias) — safe error class surfaced when `DATABASE_URL` is missing/invalid. Error messages never include the URL value, credentials or tokenized query strings.
- `publicErrorReason(error)` — sanitizes external/pg errors to a safe `{code, reason}` pair; never surfaces raw `error.message`, `error.name`, SQL literals or host/user details. Used by CLI tools. App helpers may propagate internal errors for future boundary handling, but **never log** raw external messages.

## db/migrations.js

Forward-only SQL migration runner.

- Loads `db/migrations/*.sql` sorted by filename (numeric-aware).
- **Prevalidation** runs before any pending file executes: all applied ledger entries must have a matching file in the directory (missing applied → reject); all applied checksums must match the file content (mismatch → reject); a newly introduced file with a version earlier than the max applied version → reject (out-of-order forward-only). Filenames must match `NNNN_snake_case.sql` (digits, lowercase, underscore); duplicate numeric versions are rejected; the migrations directory path is validated against filesystem root.
- Bootstraps a `schema_migrations(version TEXT PK, checksum TEXT, applied_at TIMESTAMPTZ)` ledger if absent.
- Each run opens one client, `BEGIN`, `pg_advisory_xact_lock(<fixed key>)`, then for each file:
  - If already in the ledger with the same SHA-256 checksum → skip (idempotent).
  - If in the ledger with a different checksum → `ROLLBACK` and fail (checksum mismatch refusal).
  - Otherwise execute the migration SQL and insert the ledger row **in the same transaction**.
- `COMMIT` once all pending migrations applied. Any error rolls back; no partial schema or ledger row survives a failed migration.
- A second run is a no-op: every file is already in the ledger with a matching checksum.
- Concurrent runners serialize through the advisory lock; the second waits, then sees the first's committed ledger and skips.

### SQL safety scanning

`assertTransactionSafe` performs a conservative scan that is **not** a general untrusted-SQL sandbox. It rejects top-level statements that could escape or override the migration transaction. The scanner tokenizes leading keywords of each top-level statement (after `splitTopLevelStatements` faithfully handles line comments, nestable block comments, single-quoted strings with `''` escapes, `E'...'` escape strings with backslash escapes, double-quoted identifiers with `""` escapes, and dollar-quoted strings), so optional clauses, comments or whitespace between keywords cannot evade the guard:

- **Transaction-control families** (any statement starting with one of these is rejected regardless of trailing clauses): `COMMIT` (covers `COMMIT`, `COMMIT WORK`, `COMMIT TRANSACTION`, `COMMIT AND CHAIN`, `COMMIT AND NO CHAIN`), `ROLLBACK` (covers `ROLLBACK`, `ROLLBACK WORK`, `ROLLBACK TRANSACTION`, `ROLLBACK AND CHAIN`, `ROLLBACK AND NO CHAIN`, `ROLLBACK TO SAVEPOINT ...`), `END` (covers `END`, `END WORK`, `END TRANSACTION`, `END AND CHAIN`), `ABORT`, `BEGIN`, `DISCARD` (covers `DISCARD ALL`/`TEMP`/`PLANS`/`SEQUENCES`), `UNLISTEN`. `START TRANSACTION` (also covers `START/**/TRANSACTION` and `START /* ... */ TRANSACTION`) and `PREPARE TRANSACTION` (two-phase commit) are rejected by keyword prefix.
- **Session/search_path/role overrides**: `SET SESSION ...`, `SET LOCAL ...`, `SET ROLE ...`, `SET search_path ...`, `SET TRANSACTION ...`, `SET SESSION AUTHORIZATION ...`, `SET SESSION CHARACTERISTICS ...`, `RESET search_path`, `RESET ROLE`, `RESET ALL`, `RESET SESSION AUTHORIZATION`, `RESET LOCAL ...`, and quoted setting identifiers (`SET "search_path" ...`, `SET LOCAL "role" ...`, `RESET "search_path"`). Ordinary GUCs that do not affect the transaction, role or `search_path` (e.g. `SET statement_timeout = 5000`) are still allowed.
- **GUC lexical-mode switches**: `SET`/`RESET` of `standard_conforming_strings`, `backslash_quote`, `client_encoding`, `escape_string_warning` (and their quoted-identifier forms) are rejected because changing them invalidates the scanner's lexical assumptions for subsequent text in the same file.
- **Non-transactional utility statements** (matched by leading keyword prefix, never confused with occurrences inside strings/comments): `VACUUM`, `CREATE DATABASE`, `CREATE INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY`, `ALTER SYSTEM`, `CLUSTER`, `CREATE TABLESPACE`, `DROP TABLESPACE`.

A `DO` block's procedural `BEGIN`/`END` is **not** treated as top-level transaction control. Keywords inside strings, comments or dollar-quoted bodies are ignored. E-string escape sequences (`\'`, `\\`) are parsed so a `\'` inside `E'...'` does not terminate the string and hide a following transaction-control statement; the `E`/`e` prefix is only recognized when it is immediately adjacent to its opening quote and is a standalone lexical prefix (the preceding character is not an identifier character — ASCII letter/digit/underscore, or any non-ASCII byte), so the trailing `e`/`E` of an identifier such as `name` or `CASE` is never misread as an E prefix before a following quote; in plain `'...'` strings (under the default `standard_conforming_strings=on` the scanner assumes) backslash is a literal character and does not escape the closing quote. Line comments are terminated by `\n` or `\r` (PostgreSQL treats CR as a line terminator). Unterminated single/double/dollar quotes and unterminated (possibly nested) block comments are rejected as malformed rather than swallowed, so a trailing transaction-control statement cannot hide behind an unterminated lexical state. Malformed/ambiguous leading forms (e.g. a bare `SET`/`RESET` with no target, or an unterminated quoted identifier) are rejected rather than allowed to bypass the guard.

This is a defense against accidental transaction escape in **trusted, reviewed** migration files under `db/migrations/*.sql` — the only files the runner executes. It is **not** a security sandbox for arbitrary, untrusted or procedurally hostile SQL. The migration directory is a reviewed, trusted boundary; the scanner rejects the known-dangerous top-level patterns but does not attempt to be a complete SQL parser. Never point the runner at untrusted SQL files.

### npm scripts
- `npm run db:migrate` — `node db/migrations.js`
- `npm run db:check` — `node scripts/db-check.mjs` (reachable boolean only)

## scripts/db-check.mjs

Ephemeral one-connection `SELECT 1`. Prints `database:reachable=true|false` and sets exit code. On error, prints a sanitized `[code]` only (via `publicErrorReason`); never the URL, host, user or raw `error.message`.

## File naming

Use the next unused zero-padded number, e.g. `0002_*.sql`. Never edit an applied migration's SQL; its checksum would mismatch the ledger. New changes get a new forward file.

## Test suites

Default `npm test` runs the **offline** unit/finance suite: no `.env` loading, no network, no DB connection. DB integration tests require explicit external opt-in:

- `npm test` — offline unit + finance tests. Forces `DB_TEST_ALLOW_WRITES` empty in the script so an inherited value can never silently switch the ordinary run into a write-enabled DB run. Works with missing/invalid DB env. Exact command: `npm test` (or `DB_TEST_ALLOW_WRITES= npm test` to be explicit).
- `npm run test:watch` — offline watch mode. Also forces `DB_TEST_ALLOW_WRITES` empty so an inherited value cannot switch it into a DB run.
- `DB_TEST_ALLOW_WRITES=1 npm run test:db` — DB integration suite, using the dedicated `vitest.db.config.mts`. `test:db` does **not** set `DB_TEST_ALLOW_WRITES` itself; it must be supplied externally. Invoking `npm run test:db` without the opt-in fails loudly via `scripts/require-db-test-env.mjs` (exit 1) before vitest starts, instead of silently falling back to the offline suite. The DB suite is cumulative: it also runs the offline unit/scanner tests so production-scanner regressions are exercised in both modes.

The DB suite uses uniquely-owned disposable schemas (`step03_test_*`, `step03_db_test_*`, `step04*`) with create/drop inside explicit `BEGIN`/`COMMIT`/`ROLLBACK`. Schema names are validated as single lowercase identifiers (no comma-separated `search_path`, no `public` fallback). The schema prefix/identity is validated before any drop; broad cleanup is never performed. Integration tests call the same production `runMigrations` / `lib/db` code paths.

### Explicit-file selection

`npm test` and `npm run test:watch` use `vitest.config.mts`, whose include set excludes `tests/auth/**` and `tests/db/**` (except `*.offline.test.ts`). Vitest CLI positional arguments are **filters over the include set, not additional include patterns**, so selecting a DB/auth file under the offline config (e.g. `npx vitest run tests/auth/login.test.ts`) yields "No test files found" rather than loading the file — it never reaches `requireDatabaseUrl()`.

The supported explicit-file command for DB/auth/db files is the dedicated DB config via `test:db`:

```
DB_TEST_ALLOW_WRITES=1 npm run test:db -- tests/auth/login.test.ts
```

Because the DB/auth/db files live in `vitest.db.config.mts`'s include set, the file is loaded and its module-level `requireDatabaseUrl()` runs. Without the opt-in, `npm run test:db -- <file>` refuses before DB via `scripts/require-db-test-env.mjs`.

The runtime migration runner accepts only a single validated existing schema for disposable-schema tests; no comma-separated `search_path` or `public` fallback.

## Error logging boundary

CLI tools (`db-check`, `migrations`) log only sanitized public error codes/config reasons via `publicErrorReason`. They never log raw `error.message`, `error.name`, `String(error)`, SQL literals, DB host/user, or custom exception details. App helpers (`lib/db.ts`) may propagate internal errors to the request boundary for future handling, but the boundary itself must not log raw external secrets. This boundary is documented honestly: the sanitization is conservative and only surfaces known-safe codes; unknown errors get a generic `DB_ERROR` reason.

## Scope at Step03

Only migration metadata (`schema_migrations`) is created. No business or authentication schema — those arrive at later steps with owner-scoped foreign keys and two-user isolation tests.