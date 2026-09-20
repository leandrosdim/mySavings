# Step06 — Account balances and adjustments backend

## Prompt registration
Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Status: Registered prompt; NOT IMPLEMENTED. Requires explicit approval and satisfied prerequisites before execution.
Mode: Execute only the bounded approved scope below.
This entire file is a ready-to-run prompt, not merely a feature outline. Saving it does not authorize execution. `steps/Step06.md` is canonical; `prompts/Step06-opencode-glm52.md` is its identical execution copy. Keep both synchronized after any preflight amendment.

## Prerequisites / hard gate
Step05 approved.
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
Owner-scoped account create/list/rename/archive plus manually replace current balance with as-of time, version guard and immutable adjustment. Distinguish absent opening balance from zero. Internal transfers atomic and net-zero; archive rules must not silently remove funded accounts. No full transaction categorization.

## Implementation sequence
1. Implement account service and ONE consistent server-entry pattern (server actions or route handlers chosen from actual repo conventions). Resolve authenticated owner inside the trusted boundary; never expose a service accepting arbitrary unvalidated owner input from clients.
2. Create/list/rename accounts with validated names and continuous balances. Distinguish never-entered balance from zero. Limit archive to reconciled zero-balance accounts for v1 unless user explicitly approves another policy; do not make money vanish from B by archiving a funded account.
3. Balance refresh replaces current cents, writes immutable old/new/delta/as-of audit and increments version on one transaction. Require expected version, reject stale updates safely and return a useful conflict. Refresh is not income, expense or automatic obligation settlement.
4. Record a reconciliation-needed state/message for outstanding items that may already be reflected; no automatic matching. Permit users to review the explicit state in Step07/11 rather than guessing from timestamps.
5. Internal transfer locks both owned accounts in deterministic order, validates amount and source/destination inequality, and creates equal/opposite movements atomically. Negative account balances follow documented balance policy; transfers do not create income/expense. Protect retried writes with operation keys where financial side effects exist.
6. Add positive and negative tests through real production services/entrypoints: cross-user IDs, malformed amounts, stale refresh, concurrent transfer/refresh, rollback after first movement, retry dedupe, archive restrictions and total balance invariance. No financial UI in this step.

## Expected deliverables
lib/accounts/*; app/api/accounts/* or server actions; tests/accounts/*
Adapt paths to actual established architecture without expanding scope; do not overwrite unrelated files. Use next unused migration number, never edit applied SQL. Document any justified deviation and verification impact.
For Step17 the audit-only write boundary overrides suggested application/test paths: reports and ignored evidence only; recommend code changes, do not make them.

## Step-specific acceptance
Test same-client rollback, balance replacement not addition, concurrency conflict, archive restrictions, net-zero transfer and A/B read/write/ID isolation. No credentials in logs.
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
Write `docs/reviews/Step06-opencode.md` with scope, files, schema/API decisions, real commands/results, failures/blockers, synthetic fixture cleanup and remaining risks. This is the implementer's self-report, not Hermes approval. For completed Step01 preserve the historical self-report and write a separately named verification addendum instead of rewriting history.
Hermes independently inspects diff, reruns relevant checks/browser/DB probes and records `docs/reviews/Step06.md`. Do not mark the step complete yourself before this gate. Update roadmap statuses only from verified evidence. STOP after this step; do not run the next prompt. Return a concise handoff and wait for approval.

## Launch (operator reference; do not recursively launch yourself)
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step06-opencode-glm52.md)"
```
