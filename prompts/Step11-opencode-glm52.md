# Step11 — Mobile settlement and reconciliation UX

## Prompt registration
Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Status: Registered prompt; NOT IMPLEMENTED. Requires explicit approval and satisfied prerequisites before execution.
Mode: Execute only the bounded approved scope below.
This entire file is a ready-to-run prompt, not merely a feature outline. Saving it does not authorize execution. `steps/Step11.md` is canonical; `prompts/Step11-opencode-glm52.md` is its identical execution copy. Keep both synchronized after any preflight amendment.

## Prerequisites / hard gate
Step10 approved.
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
Payment/receipt bottom sheet: editable amount prefilled with remaining, account/date, explicit balance mode and preview. Show planned/paid/remaining/history. Guide balance-refresh reconciliation and reversals, warn until reviewed. No ambiguity about whether balance changes. No offline queuing.

## Implementation sequence
1. Add payment/receipt actions to existing item detail/rows using Step10 services. Sheet prefills editable remaining amount and requests business date, owned account and explicit balance mode. Do not silently default the balance mode for a first use.
2. Use plain Greek labels explaining whether the bank balance will change or already includes the payment. Preview amount, remaining and balance effect before confirmation. Disable while submitting, but rely on server idempotency for correctness. Reuse operation key on retry of same intent; new intent gets a new key.
3. Show original/planned, settled and remaining plus immutable chronological history and derived unpaid/partial/paid state. Successful submit updates row, detail and any affected account/summary without full manual reload.
4. Guide users after manual balance refresh to review pending obligations already reflected. Keep a clear reconciliation warning until explicitly reviewed. Do not auto-create expenses from balance delta or auto-select matching items by date.
5. Add carefully confirmed correction/reversal flow following Step10 protocol. Post-refresh reversal exposes explicit balance effect and refuses unresolved conflict. Keep historical payment visible with reversal linkage.
6. Browser-test full gas 80 -> pay 40 -> pay 40, overpayment rejection, income both modes, network/retry/double tap, refreshed-balance already-reflected settlement and reversal. Verify persisted cents and account versions. Test keyboard, sheet focus/close, loading/error recovery and online-required behavior. No offline financial queue.

## Expected deliverables
components/settlements/*; app/(private)/activity/*; app/(private)/accounts/*; tests/e2e/settlements.*
Adapt paths to actual established architecture without expanding scope; do not overwrite unrelated files. Use next unused migration number, never edit applied SQL. Document any justified deviation and verification impact.
For Step17 the audit-only write boundary overrides suggested application/test paths: reports and ignored evidence only; recommend code changes, do not make them.

## Step-specific acceptance
Browser pay 40 of 80 then 40, receipt modes, invalid/overpay handling, repeat submit, corrections and balance refresh already-reflected flow. Verify persisted DB amounts and mobile keyboard usability; clean fixtures.
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
Write `docs/reviews/Step11-opencode.md` with scope, files, schema/API decisions, real commands/results, failures/blockers, synthetic fixture cleanup and remaining risks. This is the implementer's self-report, not Hermes approval. For completed Step01 preserve the historical self-report and write a separately named verification addendum instead of rewriting history.
Hermes independently inspects diff, reruns relevant checks/browser/DB probes and records `docs/reviews/Step11.md`. Do not mark the step complete yourself before this gate. Update roadmap statuses only from verified evidence. STOP after this step; do not run the next prompt. Return a concise handoff and wait for approval.

## Launch (operator reference; do not recursively launch yourself)
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step11-opencode-glm52.md)"
```
