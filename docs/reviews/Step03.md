# Step03 — independent Hermes review

## Current decision after approved correction
**Step03 independently VERIFIED for the bounded database infrastructure scope.** S3-01 and the test-command safety issue below are resolved by the GLM 5.2 correction and lexical follow-ups. Step04 remains review-blocked; this is not auth or production-readiness approval.

### Independent final evidence
Hermes reran commands directly in an `&&` chain (no pipeline hiding failures):
- `node qa-output/step03-independent-scanner-check.cjs`: 25 cases, 0 failures. Initial Hermes cases were extended by OpenCode with the later independently discovered prefix/CR regressions.
- `node qa-output/step03-review-probe.cjs`: migrationReportedFailure=true, tablesSurvivedFailure=0, atomicityPassed=true, ownFixtureSchemasRemaining=0. This is the unchanged real-runner COMMIT WORK reproduction that previously left two tables.
- `npm run lint`, `npm run typecheck`: passed.
- `DB_TEST_ALLOW_WRITES=1 npm test`: 309 offline tests across 7 files; inherited permission does not change ordinary test selection.
- `DB_TEST_ALLOW_WRITES=1 npm run test:db -- tests/db/migrations.test.ts tests/db/db.test.ts`: 33 live tests (24 migration, 9 DB), all passed. Includes rollback, checksum/history refusal, concurrent runner serialization, real escape regressions, legitimate E-string/quoted-identifier/DO acceptance and repeat-run idempotence.
- `npm run build`: passed against preserved shared auth code.
- `npm audit`: 0 vulnerabilities.
- `git diff --check`: passed.
- Missing opt-in: `env -u DB_TEST_ALLOW_WRITES npm run test:db -- tests/db/migrations.test.ts` exits 1 before Vitest/DB work.
- Final independent aggregate: remainingStep03FixtureSchemas=0. No new application migration or public ledger edit was performed by Hermes during this correction.

### Changes and review iterations
OpenCode GLM 5.2 replaced exact two-word matching with transaction-control family matching, added malformed lexical-state rejection and E-string handling, blocked lexical-mode-changing GUCs and expanded regression tests. Hermes rejected two incomplete intermediate versions: one rejected legitimate E strings and inaccurately claimed CLI filters extend Vitest include patterns; the next wrongly treated trailing e in `name`/`CASE` and whitespace-separated E as an escape-string prefix, allowing an actual COMMIT to be swallowed. Final prefix recognition requires adjacency and an identifier boundary, and CR terminates line comments. The newly discovered typed-name escape is rejected by a real isolated runner test, not just a scanner assertion.

Dedicated `vitest.db.config.mts` provides cumulative live-test inclusion. Ordinary `test` and `test:watch` clear inherited permission; `test:db` requires external opt-in through `scripts/require-db-test-env.mjs`. Supported explicit-file command uses `npm run test:db -- <file>`; ordinary offline CLI filtering does not magically include excluded DB tests. Documentation corrected accordingly.

Scope remains trusted, reviewed migrations—not an arbitrary SQL sandbox. The pg SSL-mode forward-compatibility warning remains informational and should be revisited on a driver upgrade. No UI/auth behavior was changed; the Step04 security findings are still open. The auth test suite was not rerun in this final targeted DB pass and is not approved by these results. No push/commit/deployment/real-user changes.

Implementation evidence: `docs/reviews/Step03-atomicity-correction-opencode.md`; prompts: `Step03-atomicity-fix`, `Step03-lexical-followup`, `Step03-prefix-followup` under `prompts/` (all `opencode-glm52.md`).

## Historical pre-correction decision and findings
**The following original findings are preserved as history; the blocker is now resolved as documented above.**
The user confirmed Step04 was legitimately implemented in parallel and authorized review of both steps. All Step04 files and applied identity migration are preserved. This report concerns Step03 infrastructure, not Step04 approval.

## Implemented and verified
OpenCode GLM 5.2 Cloud created the pg/server-only pool, checked same-client transaction helper, migration metadata/runner, configuration checks, documentation and test suites. A correction pass addressed initial transaction cleanup, history validation, safe errors and offline/live-test separation.
Independent prior shared-baseline gate: lint, typecheck, build, audit and diff checks passed; audit reported 0 vulnerabilities. Default offline suite: 208 tests passed, independently rerun again during this review. Live shared suite: 191 tests passed, including identity tests introduced by the user's parallel Step04; this is NOT 191 isolated Step03 tests. Migration integration file has 12 passing cases and DB helper file 9. Real connectivity reported reachable=true. Two migration reruns each returned 0 applied, 2 skipped: Step04's identity ledger was already present, not applied by those reruns.

## S3-01 — High: accepted transaction variants escape migration atomicity
Location: db/migrations.js:342–369, firstToken/checkStatementSafe.
The scanner captures up to two words then compares exact strings. Thus COMMIT is rejected, but COMMIT WORK and COMMIT AND CHAIN are not equal to COMMIT and are accepted. END WORK is accepted too. Comment-separated START/**/TRANSACTION and SET LOCAL search_path also pass the intended guard.

Independent offline probe of exported assertTransactionSafe:
- COMMIT WORK; -> rejected=false
- COMMIT AND CHAIN; -> rejected=false
- END WORK; -> rejected=false
- START/**/TRANSACTION; -> rejected=false
- SET LOCAL search_path = public; -> rejected=false

Independent real Neon reproduction uses the production runMigrations function and a unique disposable schema with one synthetic file:
```sql
CREATE TABLE escaped (id integer);
COMMIT WORK;
SELECT 1/0;
```
Actual result:
```json
{"migrationReportedFailure":true,"tablesSurvivedFailure":2,"atomicityPassed":false}
{"ownFixtureSchemasRemaining":0}
```
Both escaped and schema_migrations persisted despite the runner returning failure. The early COMMIT also releases the transaction advisory lock. This defeats atomic SQL+ledger guarantees and can undermine runner serialization. All test-created objects were subsequently removed in explicit transactions and exact-schema cleanup verified.
Reproducer retained locally at ignored qa-output/step03-review-probe.cjs. Never run failure probes against public/applied project history.

Required correction: normalize/tokenize top-level SQL faithfully and reject transaction-control statement families regardless of optional clauses/comments; cover WORK, TRANSACTION, AND CHAIN/NO CHAIN and session overrides. Preserve legitimate quoted strings/comments/procedural blocks. Add the actual failing regression to both scanner and isolated production-runner tests. A custom scanner is not a sandbox for hostile SQL; document that boundary.

## Other observations
- The default offline and DB suites are different sets, not cumulative counts. test:db enables writes in its package script; invoking that command itself opts in. It does not require a separately supplied environment flag, despite the stricter original correction request. Tighten/document this before approval; externally inherited DB_TEST_ALLOW_WRITES=1 also changes what ordinary npm test selects.
- TLS alias warning remains for require/prefer/verify-ca; pg currently aliases these to verify-full but announces changed semantics in a future major. Prefer explicitly normalized verify-full without modifying private .env. A synthetic verify-ca+uselibpqcompat configuration was rejected during this review; no contrary TLS-bypass claim is made.
- No real .env values were printed, and no application implementation files were changed by this review.
- Source/test changes from the parallel Step04 mean schema metadata-only assertions are no longer valid for the shared public schema. Identity tables belong to Step04 and were not removed.

## Next action
Correct S3-01 through a bounded GLM 5.2 pass and rerun isolated failure/serialization/history checks plus shared quality gates. Keep Step03 status review-blocked until the real atomicity probe passes. Do not move to Step05 on the basis of green existing tests.
