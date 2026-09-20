# Step15 — Month closing, history and private exports

## Prompt registration
Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Status: Registered prompt; NOT IMPLEMENTED. Requires explicit approval and satisfied prerequisites before execution.
Mode: Execute only the bounded approved scope below.
This entire file is a ready-to-run prompt, not merely a feature outline. Saving it does not authorize execution. `steps/Step15.md` is canonical; `prompts/Step15-opencode-glm52.md` is its identical execution copy. Keep both synchronized after any preflight amendment.

## Prerequisites / hard gate
Step14 approved; agree explicit closed-month correction policy before execution.
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
Store immutable closing snapshots and expose historical plan/settlement comparisons without rewriting from live balances. Define actual payment totals vs unclassified adjustments. Secure owner-filtered CSV export with formula-injection neutralization and no-store headers. Add JSON backup if scoped; restore/import is not automatic.

## Implementation sequence
1. PRE-EXECUTION DECISION: agree and record closed-month correction policy. Recommended v1: immutable closing snapshots, later compensating corrections recorded in an open period with linkage; no silently rewriting snapshots. If user wants reopening, specify separately and stop rather than invent it.
2. Close month transactionally using consistent owner-scoped input snapshot, versions and lifecycle lock. Store target, balances/as-of freshness, I/E/R values, forecast outputs, settlement totals and provenance. Missing history must remain unknown; do not invent opening balance for a month that predates tracking.
3. Separate actual payments/receipts from manual bank adjustments and planned budgets. Paid totals come from business-dated settlements/reversals per agreed policy, not account balance differences. Later account refresh, reserve payment or target change cannot mutate closed data.
4. Build historical selector/detail/comparison using snapshots for closed months, live forecast only for open/current context. Enforce closed-period rules at server boundary against direct requests and backdated edits.
5. Add private owner-filtered CSV export, no-store headers, sane limits, UTF-8/Greek content and proper escaping. Neutralize formula-capable text cells including leading whitespace/control characters before =,+,-,@. Do not export secret auth/session columns. No public share links. JSON backup only if explicitly included in approved scope; automatic restore/import is excluded.
6. Test repeated/concurrent close, rollback, later updates not altering stored snapshot, closed-period direct write rejection/correction path, two-user export isolation, CSV malicious names/date edge cases and phone history/download. Never commit generated private exports.

## Expected deliverables
lib/history/*; app/(private)/history/*; app/api/exports/*; tests/history/*; docs/backup.md
Adapt paths to actual established architecture without expanding scope; do not overwrite unrelated files. Use next unused migration number, never edit applied SQL. Document any justified deviation and verification impact.
For Step17 the audit-only write boundary overrides suggested application/test paths: reports and ignored evidence only; recommend code changes, do not make them.

## Step-specific acceptance
Later balance/target changes cannot alter closed snapshots; payment/correction rules around closed month enforced. A/B export isolation and CSV cells beginning =,+,-,@ safe. Date boundaries and mobile history/export tested.
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
Write `docs/reviews/Step15-opencode.md` with scope, files, schema/API decisions, real commands/results, failures/blockers, synthetic fixture cleanup and remaining risks. This is the implementer's self-report, not Hermes approval. For completed Step01 preserve the historical self-report and write a separately named verification addendum instead of rewriting history.
Hermes independently inspects diff, reruns relevant checks/browser/DB probes and records `docs/reviews/Step15.md`. Do not mark the step complete yourself before this gate. Update roadmap statuses only from verified evidence. STOP after this step; do not run the next prompt. Return a concise handoff and wait for approval.

## Launch (operator reference; do not recursively launch yourself)
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step15-opencode-glm52.md)"
```
