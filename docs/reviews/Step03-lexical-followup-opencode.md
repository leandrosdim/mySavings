# Step03 — OpenCode implementer self-report (lexical + test-config follow-up)

Status: Bounded follow-up to `docs/reviews/Step03-atomicity-correction-opencode.md`, in response to the user's narrow continuation prompt `prompts/Step03-lexical-followup-opencode-glm52.md`. Independent Hermes original real Neon probe PASSES (`tablesSurvivedFailure=0`, `cleanup=0`) and is preserved untouched. This pass corrects the two remaining failed acceptance items only. NOT self-marked complete; independent review and registry approval remain with Hermes. No Step03/Step04 approval status or registry changes.

## Scope (bounded)
Only the two remaining failed acceptance items from the user's continuation prompt:
- No auth changes, new migrations, Step05 work, commits/pushes, global config changes, production migrations or real-user changes.
- Applied migration SQL (`db/migrations/0001_schema_migrations.sql`, `db/migrations/0002_identity.sql`) and the production `public.schema_migrations` ledger were not altered.
- `.env` not read into prompts/logs and not modified.
- No real DB errors, connection strings or credentials printed.
- The independently user-implemented Step04 work and all auth/user code are preserved untouched.

## Item 1: scanner E-string / doubled-quote / unterminated / GUC lexical-mode handling

### Root cause
`splitTopLevelStatements` treated a `'` inside any single-quoted string as a potential terminator without recognizing PostgreSQL `E'...'` escape strings, where a backslash escapes the next byte (`\'` does not terminate, `\\` is a literal backslash). A legitimate safe E-string such as `SELECT E'quote\'; COMMIT WORK;';` was therefore mis-tokenized: the `\'` was seen as a string terminator, so the `COMMIT WORK;';` tail was parsed as a real top-level statement and rejected — a false positive on safe SQL. Conversely, a hostile E-string could have hidden a real transaction-control statement behind an escaped quote.

Additionally: (a) the `DOUBLE_QUOTE` state did not handle doubled `""` escapes (a doubled double-quote is a literal `"` inside a quoted identifier, mirroring `''`), so an identifier containing `""` was mis-tokenized; (b) unterminated single/double/dollar quotes and unterminated (possibly nested) block comments were silently swallowed at end-of-input or in `stripLeadingComments`/`extractLeadingComments`, which could hide a trailing transaction-control statement; (c) GUC lexical-mode switches (`standard_conforming_strings`, `backslash_quote`, `client_encoding`, `escape_string_warning`) were not rejected — accepting `SET standard_conforming_strings = off` would invalidate the scanner's assumption that backslash is literal in plain `'...'` strings for all subsequent text in the same file.

### Correction
- Added a dedicated `E_STRING` lexer state. `E'...'` / `e'...'` (with optional whitespace between the `E` keyword and the opening quote) enters it. Inside, a backslash escapes the next byte (`\'` and `\\` do not terminate), and a doubled `''` is a literal single quote. A lone `'` terminates. This lets `SELECT E'quote\'; COMMIT WORK;';` parse correctly: `\'` is an escaped quote inside the E string, so the `COMMIT WORK;';` is string content, not a top-level statement.
- The `DOUBLE_QUOTE` state now treats `""` as a literal embedded double-quote (continues the identifier) instead of terminating. Mirrors `''` in single-quoted strings.
- Unterminated single/double/dollar-quote and unterminated (possibly nested) block-comment states are rejected at end-of-input in `splitTopLevelStatements` with `MIGRATION_UNSAFE_SQL`, and `stripLeadingComments`/`extractLeadingKeywords` throw on an unterminated leading block comment / quoted identifier rather than silently swallowing the tail. So `SELECT 'unterminated`, `/* unclosed`, `DO $$ BEGIN PERFORM 1;`, `SELECT "unterminated`, `SELECT E'quote\;` are all rejected.
- Added GUC lexical-mode switches to the override reject set: `standard_conforming_strings`, `backslash_quote`, `client_encoding`, `escape_string_warning` (and their quoted-identifier forms, and `SET LOCAL`/`SET SESSION`/`RESET` variants). Ordinary GUCs (`SET statement_timeout`, `SET work_mem`, `SET TimeZone`, `SET client_min_messages`) are still accepted.

Preserved (still accepted): transaction keywords inside E/normal strings, comments, dollar-quoted bodies; `DO` block procedural `BEGIN`/`END`; quoted identifiers that look like keywords; safe ordinary GUCs; doubled-quote quoted identifiers; the legitimate safe E-string from the independent scanner check.

### Boundary (honest, unchanged)
The scanner is a conservative defense against accidental transaction escape in **trusted, reviewed** migration files under `db/migrations/*.sql` — the only files the runner executes. It is **not** a security sandbox for arbitrary, untrusted or procedurally hostile SQL. No hostile-SQL sandbox claim is made.

### Tests added (offline)
`tests/unit/db/sql-scanner.offline.test.ts` grew from 112 → 149 offline scanner tests (+37):
- E-string escape handling: legitimate `SELECT E'quote\'; COMMIT WORK;';` accepted (the exact case from `qa-output/step03-independent-scanner-check.cjs`); `E'a\\'; COMMIT WORK;` rejected (escaped backslash then real terminator, real COMMIT follows); `E'quote'; COMMIT WORK;` rejected; `E 'quote\'; COMMIT WORK;';` (whitespace before quote) accepted; lowercase `e'...'` accepted; doubled `''` inside E string accepted; plain (non-E) `'quote\'; COMMIT WORK;` rejected (backslash is literal under `standard_conforming_strings=on`).
- Doubled quoted identifiers: `"a""b"`, `"COMMIT""WORK"`, table name with `""` — all accepted.
- Unterminated lexical states: unterminated single/double/dollar/tagged-dollar quote, unterminated block comment, unterminated nested block comment, unterminated DO dollar body, unterminated string hiding COMMIT, unterminated E string, unterminated quoted identifier before paren, unterminated block comment with transaction keywords inside — all rejected.
- GUC lexical-mode switches: `SET standard_conforming_strings = off`, `SET backslash_quote = on`, `SET client_encoding = 'SQL_ASCII'`, `SET escape_string_warning = off`, `RESET standard_conforming_strings`, `RESET backslash_quote`, `SET "standard_conforming_strings" = off`, `SET "backslash_quote" = on`, `SET LOCAL standard_conforming_strings = off` — all rejected.
- `splitTopLevelStatements`: does not split on `;` inside E strings; treats backslash-escaped quote in E string as content; treats doubled `""` inside quoted identifier as content; rejects unterminated single/double/dollar quote and block comment at the splitter level.

### Tests added (isolated live, exercising the actual runner)
`tests/db/migrations.test.ts` grew from 18 → 22 live migration tests (+4), all against unique disposable `step03_test_*` schemas with create/drop inside explicit `BEGIN`/`COMMIT`/`ROLLBACK`; no failure probes in `public`:
- `rejects SET standard_conforming_strings lexical-mode switch with no surviving table` — writes `CREATE TABLE step03_guc_escape (id int); SET standard_conforming_strings = off; SELECT 1;` and proves the runner rejects it with no surviving `step03_guc_escape` table.
- `rejects unterminated block comment in migration with no surviving table` — writes `CREATE TABLE step03_unterm_escape (id int); /* unclosed COMMIT WORK;` and proves the runner rejects it (`/unterminated|MIGRATION_UNSAFE_SQL/`) with no surviving table.
- `accepts and applies a migration with a legitimate E-string hiding a COMMIT token` — writes `CREATE TABLE step03_estring_ok (id int, note text); INSERT INTO step03_estring_ok (id, note) VALUES (1, E'quote\'; COMMIT WORK;');` and proves the runner accepts it, the table is created, and the row is inserted (the E-string is real safe SQL).
- `accepts and applies a migration with doubled double-quote quoted identifiers` — writes `CREATE TABLE step03_doubled_ok (id int); CREATE TABLE "step03_""q""" (id int);` and proves the runner accepts it and the table `step03_"q"` is created.

The existing 18 migration integration tests are unchanged and still pass.

## Item 2: test:db config — explicit-file inclusion, missing opt-in refuses before DB, test:watch stays offline

### Root cause
- `vitest.config.mts` used a single dynamic include set keyed on `DB_TEST_ALLOW_WRITES`, and its comments claimed "CLI patterns extend the include candidate set" so that a DB/auth file explicitly selected on the CLI would be loaded and fail via `requireDatabaseUrl()`. That claim was false: vitest CLI positional arguments are **filters over the include set, not additional include patterns**. `env -u DB_TEST_ALLOW_WRITES npx vitest run tests/auth/login.test.ts` yielded "No test files found" (exit 1) because `tests/auth/**` was not in the offline include set — it never reached `requireDatabaseUrl()`. The previous report/docs repeated this false claim.
- `npm run test:watch` did not force `DB_TEST_ALLOW_WRITES` empty, so an inherited `DB_TEST_ALLOW_WRITES=1` would switch watch mode into a write-enabled DB run.

### Correction
- Split the single dynamic config into two static configs to avoid needless runtime branching:
  - `vitest.config.mts` — offline only (used by `npm test` and `npm run test:watch`); includes `tests/unit/**`, `tests/db/**/*.offline.test.ts`, `tests/finance/**`.
  - `vitest.db.config.mts` (new) — DB + auth + db + unit + finance (cumulative); used only by `npm run test:db`.
- `package.json`:
  - `test` keeps forcing `DB_TEST_ALLOW_WRITES=` empty.
  - `test:watch` now also forces `DB_TEST_ALLOW_WRITES=` empty, so an inherited `DB_TEST_ALLOW_WRITES=1` cannot switch watch mode into a DB run.
  - `test:db` now runs `node scripts/require-db-test-env.mjs && vitest run --config vitest.db.config.mts`. The guard refuses (exit 1) before vitest starts when `DB_TEST_ALLOW_WRITES=1` is absent.
- Supported explicit-file command: `DB_TEST_ALLOW_WRITES=1 npm run test:db -- tests/auth/login.test.ts`. Because `tests/auth/**` is in `vitest.db.config.mts`'s include set, the file is loaded and its module-level `requireDatabaseUrl()` runs. Without the opt-in, `env -u DB_TEST_ALLOW_WRITES npm run test:db -- tests/auth/login.test.ts` refuses before DB via `scripts/require-db-test-env.mjs` (verified, exit 1, opt-in message).
- Fixed the false comments in `vitest.config.mts` and `docs/database.md`: documented that CLI positional arguments are filters over the include set (not additional includes), that the offline config yields "No test files found" for DB/auth files, and that the supported explicit-file path is `test:db` with the dedicated DB config.
- `scripts/require-db-test-env.mjs` is unchanged; it already refuses without opt-in.

### Verification of the two exact failing commands from the prompt
- `env -u DB_TEST_ALLOW_WRITES npx vitest run tests/auth/login.test.ts` → "No test files found, exiting with code 1" (include: `tests/unit/**/*.test.ts, tests/db/**/*.offline.test.ts, tests/finance/**/*.test.ts`). This is now the expected, documented behavior for selecting a DB/auth file under the offline config; it is NOT the supported explicit-file path. The supported path (`test:db`) refuses without opt-in before DB.
- `env -u DB_TEST_ALLOW_WRITES npm run test:db -- tests/auth/login.test.ts` → refuses before DB: "Refusing to run test:db without explicit opt-in …" exit 1.
- `DB_TEST_ALLOW_WRITES=1 npx vitest list --config vitest.db.config.mts tests/auth/login.test.ts` → lists all 17 tests of the file (file is loaded under the DB config).
- `DB_TEST_ALLOW_WRITES=1 npm test` → 7 files, 303 tests, offline (no DB).
- `DB_TEST_ALLOW_WRITES=1 npm run test:watch` → 7 files, 303 tests, offline (no DB), then waits for file changes (watch stays offline despite inherited opt-in).

## Files changed
- `db/migrations.js` — added `E_STRING` state and `STATE_NAMES`; `splitTopLevelStatements` now parses `E'...'`/`e'...'` escape strings (backslash escapes, optional whitespace before opening quote), handles `""` doubled-quote escapes inside `DOUBLE_QUOTE`, and rejects unterminated single/double/dollar/E quote and unterminated (nested) block-comment states at end-of-input; `stripLeadingComments` and `extractLeadingKeywords` throw on unterminated leading block comment / quoted identifier; `isTransactionControlOrOverride` rejects GUC lexical-mode switches (`standard_conforming_strings`, `backslash_quote`, `client_encoding`, `escape_string_warning`, quoted forms). Exports unchanged.
- `tests/unit/db/sql-scanner.offline.test.ts` — +37 offline scanner tests (E-string escape handling, doubled quoted identifiers, unterminated lexical states, GUC lexical-mode switches; `splitTopLevelStatements` E-string/doubled-quote/unterminated cases).
- `tests/db/migrations.test.ts` — +4 isolated live runner tests (GUC lexical switch rejection, unterminated block comment rejection, legitimate E-string acceptance, doubled-quote identifier acceptance).
- `vitest.config.mts` — made offline-only (static include set); fixed false comments about CLI patterns extending the include set; documented dedicated DB config and supported explicit-file command.
- `vitest.db.config.mts` — new dedicated DB suite config (cumulative: unit + db + auth + finance); used only by `test:db`.
- `package.json` — `test:watch` forces `DB_TEST_ALLOW_WRITES=` empty; `test:db` uses `--config vitest.db.config.mts`.
- `docs/database.md` — documented E-string/doubled-quote/unterminated/GUC-lexical handling; documented `test:watch` offline; documented dedicated DB config, explicit-file command, and that CLI positional args are filters over the include set (not additional includes).

## Verification results (exact real results; pipefail used for piped commands)
- `node qa-output/step03-independent-scanner-check.cjs`: PASS — 19/19 cases, `failures=0`, exit 0. The previously-failed legitimate E-string `SELECT E'quote\'; COMMIT WORK;';` is now accepted; all 14 unsafe cases still rejected; all other safe cases still accepted.
- `npm run lint`: PASS (exit 0).
- `npm run typecheck` (`next typegen && tsc --noEmit`): PASS (exit 0).
- `npm test` (offline): PASS — 7 files, 303 tests. Verified offline even with inherited `DB_TEST_ALLOW_WRITES=1`.
- `npm run build`: PASS (exit 0); routes: `/`, `/_not-found`, `/api/auth/logout`, `/dashboard`, `/login`.
- `npm audit`: 0 vulnerabilities.
- `npm run db:check`: `database:reachable=true`.
- Targeted opt-in migration + scanner live tests (`DB_TEST_ALLOW_WRITES=1 npm run test:db -- tests/db/migrations.test.ts tests/unit/db/sql-scanner.offline.test.ts`): PASS — 2 files, 171 tests (149 scanner + 22 live migration). Real Neon, disposable `step03_test_*` schemas.
- Cleanup verification: `leftover_test_schemas:[]` (0 leftover `step03_*` / `step04*` schemas after the live run).
- Production ledger unchanged: `public.schema_migrations` versions `["0001_schema_migrations","0002_identity"]`; applied migration SQL files not edited.
- `test:watch` offline despite inherited opt-in: `DB_TEST_ALLOW_WRITES=1 npm run test:watch` → 7 files, 303 tests, offline (no DB), then waits for file changes.
- Missing opt-in refuses before DB (explicit file): `env -u DB_TEST_ALLOW_WRITES npm run test:db -- tests/auth/login.test.ts` → exit 1, opt-in message, before vitest starts.
- Explicit-file loads under DB config with opt-in: `DB_TEST_ALLOW_WRITES=1 npx vitest list --config vitest.db.config.mts tests/auth/login.test.ts` → lists all 17 tests of the file (exit 0).

## Blockers
None for this bounded follow-up. The full cumulative `npm run test:db` (auth + finance + db + unit) was not re-run end-to-end in this pass; only the targeted migration + scanner opt-in tests were run live. Hermes may rerun the full live suite independently.

## Handoff
Bounded lexical + test-config follow-up complete and self-verified. Step03 status remains `review_blocked`; independent review and registry approval remain with Hermes. STOP — no next step started, no independent approval/registry edits.

---

# Step03 — OpenCode implementer self-report (lexical-boundary follow-up)

Status: Bounded follow-up to the report above, in response to the user's narrow continuation prompt `prompts/Step03-prefix-followup-opencode-glm52.md`. Hermes found that the new E-string lexer falsely treated `E`/`e` followed by whitespace then a quote as an E-string, and recognized the trailing `e` inside identifiers (e.g. `name`, `CASE`) as an E prefix. This created a new transaction escape. This pass corrects that single lexical bug and adds regressions; all unrelated work and current fixes are preserved. NOT self-marked complete; independent review and registry approval remain with Hermes. No Step03/Step04 approval status or registry changes.

## Scope (bounded)
Only the single lexical-boundary bug from the continuation prompt:
- No auth changes, new migrations, Step05 work, commits/pushes, global config changes, production migrations or real-user changes.
- Applied migration SQL (`db/migrations/0001_schema_migrations.sql`, `db/migrations/0002_identity.sql`) and the production `public.schema_migrations` ledger were not altered.
- `.env` not read into prompts/logs and not modified; no real DB errors/connection strings/credentials printed.
- Hermes independent reports (`docs/reviews/Step03.md`, `docs/reviews/Step03-corrections-opencode.md`, `docs/reviews/Step03-atomicity-correction-opencode.md`) and `steps/registry.json` were NOT edited.
- The previous self-report sections above are preserved as-is for history; the corrections below supersede the incorrect E-prefix claims in the "Item 1" section above.

## Item: E-prefix lexical boundary (typed-name escape)

### Root cause
The E-prefix branch added in the prior follow-up had two defects:
1. A whitespace branch recognized `E`/`e` followed by any run of whitespace then `'` as an E-string. PostgreSQL's lexer does NOT allow whitespace between the `E` prefix and its opening quote — the `E` must be immediately adjacent to `'`. The whitespace branch was incorrect and created the escape below.
2. The contiguous `E'`/`e'` branch did not check the preceding character. The trailing `e` of an identifier such as `name` or `CASE` followed by whitespace then a quote was misread as an E prefix, because the whitespace branch (defect 1) consumed the identifier's trailing `e` as the E keyword.

Combined, the exact valid PostgreSQL sequence Hermes reported (literal single backslash) was mis-tokenized as a single SELECT:
```sql
SELECT name '\'; COMMIT WORK; -- '
SELECT 1;
```
Trace of the bug: scanning reaches the trailing `e` of `name`; `next` is a space, so the whitespace E-prefix branch triggers; it skips the space, finds `'`, and enters `E_STRING`. Inside `E_STRING`, `\'` is an escaped quote (does not terminate), so `COMMIT WORK; -- '` is consumed as string content until the final `'`. The whole sequence merges into one SELECT, and the real `COMMIT WORK` escapes the guard.

Under PostgreSQL's actual lexer (with `standard_conforming_strings=on`, the scanner's stated assumption), `name` is a single identifier, `'...` is a plain single-quoted string, the backslash is a literal character, the second `'` terminates the string, and the following `COMMIT WORK; -- '` is a real top-level `COMMIT WORK` that must be rejected.

### Correction
- Removed the whitespace E-prefix branch entirely. PostgreSQL's `E` prefix MUST be immediately adjacent to its opening quote; no intervening whitespace is allowed. `E '...'` is now correctly tokenized as a plain identifier `E` followed by a plain single-quoted string.
- The contiguous `E'`/`e'` branch now requires a proper lexical boundary: the character immediately before the `E`/`e` must NOT be an identifier character. An identifier character is conservatively defined as an ASCII letter (`A-Z`, `a-z`), digit (`0-9`), underscore (`_`), or any non-ASCII byte (`>= 0x80`, which conservatively covers Unicode identifier letters that PostgreSQL allows). This prevents the trailing `e`/`E` of `name`, `CASE`, or any Unicode identifier from being recognized as an E prefix. A genuine E prefix (preceded by whitespace, an operator, `(`, `,`, etc.) is still recognized.
- Conservative Unicode handling: any non-ASCII byte before `E`/`e` is treated as an identifier character, so the scanner refuses to recognize an E prefix after a non-ASCII identifier letter. This is deliberately conservative — it may refuse a few pathological genuine E prefixes after a non-ASCII operator-like byte, but it never falsely recognizes a trailing identifier letter as an E prefix. Trusted migration files do not rely on E prefixes immediately after non-ASCII bytes.

### ASCII CR line-comment terminator (related)
While fixing the E-prefix bug, Hermes noted that a CR-only line comment (`-- comment\rCOMMIT WORK;`) could swallow a following top-level statement: the `LINE_COMMENT` state only exited on `\n`, and `stripLeadingComments`/`extractLeadingKeywords` only scanned for `\n`. PostgreSQL treats CR (`\r`) as a line-comment terminator, so:
- `LINE_COMMENT` now exits on `\r` as well as `\n` (a `\r\n` pair exits on `\r`, then `\n` is consumed as whitespace in NORMAL — harmless).
- `stripLeadingComments` and `extractLeadingKeywords` now scan for the next `\n` OR `\r` when skipping a leading line comment.

This prevents a CR-only line comment from hiding a trailing top-level statement.

### Boundary (honest, unchanged)
The scanner is a conservative defense against accidental transaction escape in **trusted, reviewed** migration files under `db/migrations/*.sql` — the only files the runner executes. It is **not** a security sandbox for arbitrary, untrusted or procedurally hostile SQL. No hostile-SQL sandbox claim is made.

## Files changed
- `db/migrations.js` — removed the whitespace E-prefix branch; the contiguous `E'`/`e'` branch now requires the preceding character to not be an identifier character (ASCII letter/digit/underscore, or any non-ASCII byte `>= 0x80`); `LINE_COMMENT` now exits on `\r` as well as `\n`; `stripLeadingComments` and `extractLeadingKeywords` now treat both `\n` and `\r` as line-comment terminators. Exports unchanged.
- `tests/unit/db/sql-scanner.offline.test.ts` — removed the incorrect `E 'quote\'; COMMIT WORK;';` accept test (whitespace before quote is NOT an E string); added 6 new offline regression cases (typed-name escape with real COMMIT WORK, CASE-keyword escape, `E '...'` with whitespace rejected, genuine E terminated then real COMMIT rejected, typed-name + genuine E escape accepted, CRLF and CR-only line-comment followed by COMMIT rejected).
- `tests/db/migrations.test.ts` — +2 isolated live runner tests in a new `S3-01 lexical-boundary` describe block: (a) `rejects the typed-name escape (name + whitespace + quote) with no surviving table or ledger` — writes `CREATE TABLE escaped(id integer);\nSELECT name '\'; COMMIT WORK; -- '\nSELECT 1;\nSELECT 1/0;` (literal single backslash) and proves the runner rejects it with no surviving `escaped` table and no `schema_migrations` ledger row; (b) `accepts and applies a migration with a genuine E escape string hiding a COMMIT token` — proves a genuine adjacent `E'...\'...';` is still accepted and applied.
- `qa-output/step03-independent-scanner-check.cjs` — +6 unsafe cases (typed-name escape, CASE-keyword escape, `E '...'` with whitespace, genuine E terminated then real COMMIT, CR-only line comment + COMMIT) and +1 safe case (typed-name literal followed by genuine E escape string); now 25 cases total (was 19).

## Tests added (offline)
`tests/unit/db/sql-scanner.offline.test.ts` grew from 303 → 309 offline scanner tests across the whole offline suite (+6 in this file):
- `rejects typed name literal: trailing e of identifier must not be E prefix (real COMMIT WORK follows)` — the exact Hermes escape sequence `SELECT name '\'; COMMIT WORK; -- '\nSELECT 1;`.
- `rejects CASE keyword: trailing E must not be E prefix (real COMMIT WORK follows)` — `SELECT CASE WHEN true THEN '\'; COMMIT WORK; -- '\nEND;`.
- `rejects E with whitespace before quote is a plain identifier + plain string (real COMMIT follows)` — `SELECT E 'quote\'; COMMIT WORK;`.
- `rejects genuine E escape string terminated then real COMMIT WORK (rejected)` — `SELECT E'quote'; COMMIT WORK;`.
- `accepts typed name literal followed by genuine E escape string hiding COMMIT (safe)` — `SELECT name 'safe', E'quote\'; COMMIT WORK;';`.
- `rejects COMMIT after CRLF line comment` and `rejects COMMIT after CR-only line comment`.

## Tests added (isolated live, exercising the actual runner)
`tests/db/migrations.test.ts` grew from 22 → 24 live migration tests (+2), all against unique disposable `step03_test_*` schemas with create/drop inside explicit `BEGIN`/`COMMIT`/`ROLLBACK`; no failure probes in `public`:
- `rejects the typed-name escape (name + whitespace + quote) with no surviving table or ledger` — writes the exact Hermes sequence preceded by `CREATE TABLE escaped(id integer);` and followed by a final `SELECT 1/0`, and proves the runner rejects it with no surviving `escaped` table and no `schema_migrations` ledger row (the whole run rolled back).
- `accepts and applies a migration with a genuine E escape string hiding a COMMIT token` — proves a genuine adjacent `E'quote\'; COMMIT WORK;';` is still accepted, the table is created, and the row is inserted (the E-string is real safe SQL).

The existing 22 migration integration tests are unchanged and still pass.

## Verification results (exact real results; pipefail used for piped commands)
- `node qa-output/step03-independent-scanner-check.cjs`: PASS — 25/25 cases, `failures=0`, exit 0. The previously-accepted typed-name escape `SELECT name '\'; COMMIT WORK; -- '\nSELECT 1;` is now REJECTED; the CASE-keyword escape, `E '...'` with whitespace, genuine-E-terminated-then-real-COMMIT, and CR-only-line-comment + COMMIT are all rejected; the genuine E escape string and the typed-name literal followed by a genuine E escape string are still accepted; all 14 original unsafe cases still rejected; all other original safe cases still accepted.
- `npm run lint`: PASS (exit 0).
- `npm run typecheck` (`next typegen && tsc --noEmit`): PASS (exit 0).
- `npm test` (offline): PASS — 7 files, 309 tests (was 303; +6 new offline regressions).
- `npm run build`: PASS (exit 0); routes: `/`, `/_not-found`, `/api/auth/logout`, `/dashboard`, `/login`.
- `npm audit`: 0 vulnerabilities.
- `npm run db:check`: `database:reachable=true`.
- Targeted opt-in migration + scanner live tests (`DB_TEST_ALLOW_WRITES=1 npm run test:db -- tests/db/migrations.test.ts tests/unit/db/sql-scanner.offline.test.ts`): PASS — 2 files, 179 tests (was 171; +6 offline + 2 live). Real dedicated Neon DB, disposable `step03_test_*` schemas.
- Cleanup verification: `leftover_test_schemas:[]` (0 leftover `step03_*` / `step04*` schemas after the live run).
- Production ledger unchanged: `public.schema_migrations` versions `["0001_schema_migrations","0002_identity"]`; applied migration SQL files not edited.

## Blockers
None for this bounded follow-up. The full cumulative `npm run test:db` (auth + finance + db + unit) was not re-run end-to-end in this pass; only the targeted migration + scanner opt-in tests were run live. Hermes may rerun the full live suite independently.

## Handoff
Bounded lexical-boundary follow-up complete and self-verified. The typed-name E-prefix escape and the CR-only line-comment swallow are fixed; regressions cover the exact Hermes sequence plus CASE-keyword, whitespace-E, genuine-E-terminated-then-real-COMMIT, safe genuine E strings, and CR/CRLF line comments. Step03 status remains `review_blocked`; independent review and registry approval remain with Hermes. STOP — no next step started, no independent approval/registry edits.