# Step05 — Owner-scoped financial schema

## Prompt registration
Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Status: Registered prompt; NOT IMPLEMENTED. Requires explicit approval and satisfied prerequisites before execution.
Mode: Execute only the bounded approved scope below.
This entire file is a ready-to-run prompt, not merely a feature outline. Saving it does not authorize execution. `steps/Step05.md` is canonical; `prompts/Step05-opencode-glm52.md` is its identical execution copy. Keep both synchronized after any preflight amendment.

## Prerequisites / hard gate
Step04 approved; inspect auth user ID type and transaction conventions first.
Hermes must verify the previous independent gate and current scope before launch. Future implementation is not assumed complete merely because its prompt exists. Unresolved auth choice, credentials, UI language, closing policy or production permissions are blockers only at their named steps, not a reason to invent decisions now.

## Mandatory operating constraints
- Only this approved step, in /home/leandrosdim777/projects/mySavings, using ollama-cloud/glm-5.2. No model substitution. No future-step implementation.
- Read AGENTS.md, docs/product.md, docs/financial-rules.md, steps/README.md, package.json and the preceding independent review. Inspect git status/diff first; preserve unrelated user work and existing private env. Do not reset or clean the repository.
- Prewritten paths are intended locations, not proof they already exist. Reconcile with actual code, existing migrations and selected auth. Reuse implemented helpers. If prerequisites/decisions are absent, STOP with a specific blocker rather than guessing, mocking successful integration or advancing.
- Raw parameterized PostgreSQL via pg, no ORM/query builder; explicit BEGIN/COMMIT/ROLLBACK on one checked-out client for writes; owner derived from server session, all related IDs owner-scoped. Financial cents exact and bounded.
- Preserve original plans; partial settlements do not zero them. Balance updates distinguish UPDATE_ACCOUNT/ALREADY_REFLECTED. Reserves are unpaid protected commitments additional to savings and counted once; continuous balances and carryover IDs must not duplicate.
- Never print .env, credentials, tokenized URLs, real workbook contents or personal financial data. Synthetic fixtures only, scoped cleanup. Do not access another project's credentials. Existing .env does not prove permission to access production.
- No commits, pushes, paid resources, production migration, deployment or real-user provisioning unless separately authorized in the current request. No global configuration edits. No fabricated tool results or passing test claims.
- Online-only financial writes; never persist private authenticated responses or payment queues in PWA caches. Accessible mobile-first UI, readable euros and >=44px controls when UI is in scope.

## Bounded objective
Add owner-scoped continuous accounts, monthly plans, recurring templates, obligations (ordinary/reserved), expected income, immutable settlements, account movements, adjustments, idempotency and audit structures. Model many partial settlements. Preserve obligation identity for carryover. Owner-aware composite FKs and unique recurring/month keys. No CRUD UI yet.

## Implementation sequence
1. Inspect Step04 identity IDs and Step03 migration ledger. Write docs/schema.md with entities, relationships, invariants and indexes before adding the next unused forward migration. Do not assume a migration filename is still free.
2. Define continuous owner accounts (current cents, optional never-set balance, balance-as-of, version, archive status), monthly plans (month/date key, savings target, lifecycle), and recurring templates. Uniqueness: owner+month and owner+template+generated month.
3. Model ordinary/reserved obligations with durable identity, planned cents, original month, due date, lifecycle and carryover membership/reference. A reserve is not copied into a second expense liability. Expected income has planned amount and separate receipt history. Templates are not themselves liabilities.
4. Define immutable settlements/receipts, reversals, account movements, balance adjustments, operation idempotency (owner+key+payload identity), audit and closing-snapshot support. Settlement targets must be unambiguous. Record operation type, business date, recorded-at time, mode and account linkage as applicable.
5. Enforce positive payment cents, nonnegative plans/targets, valid modes/states, required refs and uniqueness in SQL. Money BIGINT/exact types must be safely converted at the JS boundary; never blindly coerce an unbounded BIGINT into Number. Overpayment across multiple rows needs Step10 transaction logic, not a false CHECK claim.
6. Every cross-entity relation uses owner-aware composite foreign keys or equivalently proven DB constraints. Test owner A cannot attach B's account/obligation/template even with direct SQL. Be careful not to SET NULL a nonnullable owner column through composite FK actions. Paid history must not disappear through cascading deletes.
7. Add indexes for owner/month/status/date queries, inspect actual query shapes and keep schema modest. No CRUD API/UI or live-data import. Run real migration twice and constraint/rollback/unique-key tests with scoped fixture cleanup.

## Expected deliverables
db/migrations/002_finance.sql; docs/schema.md; tests/db/schema.*
Adapt paths to actual established architecture without expanding scope; do not overwrite unrelated files. Use next unused migration number, never edit applied SQL. Document any justified deviation and verification impact.
For Step17 the audit-only write boundary overrides suggested application/test paths: reports and ignored evidence only; recommend code changes, do not make them.

## Step-specific acceptance
Run migration twice; test invalid cents/ranges and cross-owner relationships rejected, rollback, unique generation keys. Show only aggregate DB verification. No real data imports.
Execute the specific scenarios above in addition to the common gate. Tests must exercise real production helper/route paths, not duplicate the business logic in a separate test-only implementation. Mocked tests supplement but do not replace required DB/browser integration.

## Verification commands and evidence
Run from the project root:
```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit
git diff --check
git status --short --untracked-files=all
git diff --stat
```
If this step needs new targeted test commands, add/document them and run them; do not replace a missing suite with a successful no-op.

For DB scope: use only approved disposable dev/test data, run the real migration gate where applicable (`npm run db:migrate` after Step03 introduces it), prove second run idempotence, constraints, rollback, concurrency and A/B isolation for changed paths. Do not mutate production to test failures. Report only redacted counts/booleans.
For UI scope: run actual app, verify health before browser; test 320/390/430px and desktop, relevant real interactions, persistence, console and horizontal overflow. Capture synthetic-only screenshots under ignored qa-output/. Build/HTTP alone is not browser approval. Physical-device checks must be labeled separately from emulation.
Clean only test-owned fixtures, close owned QA browser sessions and stop owned servers; verify cleanup. Do not kill unrelated processes.

## Report, independent review and STOP
Write `docs/reviews/Step05-opencode.md` with scope, files, schema/API decisions, real commands/results, failures/blockers, synthetic fixture cleanup and remaining risks. This is the implementer's self-report, not Hermes approval. For completed Step01 preserve the historical self-report and write a separately named verification addendum instead of rewriting history.
Hermes independently inspects diff, reruns relevant checks/browser/DB probes and records `docs/reviews/Step05.md`. Do not mark the step complete yourself before this gate. Update roadmap statuses only from verified evidence. STOP after this step; do not run the next prompt. Return a concise handoff and wait for approval.

## Launch (operator reference; do not recursively launch yourself)
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step05-opencode-glm52.md)"
```
