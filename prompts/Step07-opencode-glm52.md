# Step07 — Mobile shell and account screens

## Prompt registration
Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Status: Registered prompt; NOT IMPLEMENTED. Requires explicit approval and satisfied prerequisites before execution.
Mode: Execute only the bounded approved scope below.
This entire file is a ready-to-run prompt, not merely a feature outline. Saving it does not authorize execution. `steps/Step07.md` is canonical; `prompts/Step07-opencode-glm52.md` is its identical execution copy. Keep both synchronized after any preflight amendment.

## Prerequisites / hard gate
Step06 approved; confirm Greek UI assumption.
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
Implement protected mobile navigation and account list/detail forms using real backend. Freshness labels, inline errors, decimal keyboard and accessible sheets. No fake financial KPI or placeholder navigation implying implemented features. Personal login identity visible enough to avoid accidental account confusion.

## Implementation sequence
1. Confirm Greek UI assumption. Review authenticated routes from Step04 and account entrypoints from Step06. Build responsive protected shell without introducing duplicate URLs: route groups do not change URL paths, so app/page.tsx and app/(private)/page.tsx cannot both own /.
2. Choose explicit working routes for account screens, login and future overview. At this gate expose only implemented navigation destinations; do not add clickable fake dashboard/activity tabs.
3. Account list shows name, current balance or not-entered state, freshness timestamp and reconciliation warning. Forms create/rename/update/archive using existing trusted backend. Provide transfer UI only against the implemented Step06 transfer operation, with clear source/destination and no misleading income labels.
4. Balance refresh form says it replaces bank balance and does not settle expenses. Preview effect, preserve edits on errors, handle stale-version conflict with a reload/review path. Use exact-cent parser, decimal inputmode, date-only behavior and proper server error mapping.
5. Implement reusable accessible dialog/sheet/input/button primitives sparingly. >=44px touch targets, focus trap/restore, Escape/close, visible labels and errors, keyboard-safe sticky controls, safe-area padding, reduced motion. No horizontal page overflow at 320px.
6. After mutations refresh both lists AND derived summaries using appropriate revalidation/router refresh; do not leave server-rendered figures stale. Clearly identify signed-in user and functional logout.
7. Browser-test A create/rename/refresh/archive, invalid inputs, stale form, keyboard navigation, logout then B on same device and back navigation. Check 320/390/430/1440px, console and actual persistence. Remove only marked fixtures.

## Expected deliverables
app/(private)/layout.tsx; app/(private)/accounts/*; components/ui/*; tests/e2e/accounts.*
Adapt paths to actual established architecture without expanding scope; do not overwrite unrelated files. Use next unused migration number, never edit applied SQL. Document any justified deviation and verification impact.
For Step17 the audit-only write boundary overrides suggested application/test paths: reports and ignored evidence only; recommend code changes, do not make them.

## Step-specific acceptance
Phone widths 320/390/430 and desktop; real create/refresh/rename flows, keyboard/focus/overflow checks. Direct unauthorized requests blocked. User A logout/B login reveals no A data. Clean test rows.
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
Write `docs/reviews/Step07-opencode.md` with scope, files, schema/API decisions, real commands/results, failures/blockers, synthetic fixture cleanup and remaining risks. This is the implementer's self-report, not Hermes approval. For completed Step01 preserve the historical self-report and write a separately named verification addendum instead of rewriting history.
Hermes independently inspects diff, reruns relevant checks/browser/DB probes and records `docs/reviews/Step07.md`. Do not mark the step complete yourself before this gate. Update roadmap statuses only from verified evidence. STOP after this step; do not run the next prompt. Return a concise handoff and wait for approval.

## Launch (operator reference; do not recursively launch yourself)
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step07-opencode-glm52.md)"
```
