# Step02 — Financial calculation core and tests

## Prompt registration
Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Status: Completed and independently verified; see docs/reviews/Step02.md. Default rerun is verification-only; do not rewrite the completed core or advance to Step03 without explicit approval.
Mode: Execute only the bounded approved scope below.
This entire file is a ready-to-run prompt, not merely a feature outline. Saving it does not authorize execution. `steps/Step02.md` is canonical; `prompts/Step02-opencode-glm52.md` is its identical execution copy. Keep both synchronized after any preflight amendment.

## Prerequisites / hard gate
Step01 approved.
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
Implement pure exact-cent money parsing/formatting, partial settlement remainder/status and forecast functions from docs/financial-rules.md. Types distinguish ordinary expenses and reserved commitments so obligations are counted once. Return setup-incomplete and shortfall explicitly. No DB/UI mutations.

## Implementation sequence
1. Add a maintained compatible unit test runner (prefer Vitest after verifying compatibility), npm test as a deterministic non-watch command, and a separate watch script. No production dependency on the test runner.
2. Define branded/validated integer-cent amounts, checked addition/subtraction and bounds. Parse decimal strings without floating-point multiplication: support comma or dot decimal separator, trim whitespace, reject ambiguous grouping, exponent notation, excess precision and nonfinite/unsafe numbers. Negative balances are valid; payment amounts must be strictly positive. Document rules for inputs such as 1.234 instead of guessing whether they mean thousands.
3. Implement pure planned/paid/remaining/status functions. Keep original plan immutable, distinguish reversed settlements, reject overpayment and sums outside bounds. Avoid any database/session imports in this core.
4. Implement forecast inputs for balances, pending income, ordinary unpaid expenses, reserved commitments and savings target. Ordinary and reserved obligations must be distinguishable; duplicate IDs or linked presentations must never silently count twice. Missing required values return setup-incomplete, distinct from explicit zero.
5. Use formulas B+I-E-R-S projected and B-E-R-S cash-backed. Return signed result plus explicit shortfall and pending-income caveat; do not clamp away negative results. Savings target is protected total, not a monthly contribution. Due dates do not release outstanding reserved money.
6. Write failing tests before implementation and record red/green evidence. Cases: gas 8000 cents -> 4000 payment -> another 4000, unchanged original plan; ordinary payment B and E fall equally; already-reflected payment changes E only; receipt effects; reserve creation/settlement; linked reserve deduplication; transfer net-zero; overflow, missing inputs and negatives.
7. Add synthetic exact-cent examples, exported API documentation and timezone/date-only conventions. Do not implement UI forms, API writes, DB schema or auth.

## Expected deliverables
lib/finance/money.ts; lib/finance/forecast.ts; lib/finance/settlements.ts; tests/finance/*; package.json
Adapt paths to actual established architecture without expanding scope; do not overwrite unrelated files. Use next unused migration number, never edit applied SQL. Document any justified deviation and verification impact.
For Step17 the audit-only write boundary overrides suggested application/test paths: reports and ignored evidence only; recommend code changes, do not make them.

## Step-specific acceptance
Tests for 80/40/40 gas, cent precision, invalid input, overpayment, received/pending income, commitments protected once, negative balances, missing input, internal transfer invariance. First show failing tests then implementation and green suite.
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
Write `docs/reviews/Step02-opencode.md` with scope, files, schema/API decisions, real commands/results, failures/blockers, synthetic fixture cleanup and remaining risks. This is the implementer's self-report, not Hermes approval. For completed Step01 preserve the historical self-report and write a separately named verification addendum instead of rewriting history.
Hermes independently inspects diff, reruns relevant checks/browser/DB probes and records `docs/reviews/Step02.md`. Do not mark the step complete yourself before this gate. Update roadmap statuses only from verified evidence. STOP after this step; do not run the next prompt. Return a concise handoff and wait for approval.

## Launch (operator reference; do not recursively launch yourself)
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step02-opencode-glm52.md)"
```
