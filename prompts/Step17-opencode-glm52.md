# Step17 — Security, isolation and mobile acceptance

## Prompt registration
Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Status: Registered prompt; NOT IMPLEMENTED. Requires explicit approval and satisfied prerequisites before execution.
Mode: Audit only; no application remediation without separate approval.
This entire file is a ready-to-run prompt, not merely a feature outline. Saving it does not authorize execution. `steps/Step17.md` is canonical; `prompts/Step17-opencode-glm52.md` is its identical execution copy. Keep both synchronized after any preflight amendment.

## Prerequisites / hard gate
Step16 approved; split into substeps if findings large.
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
Audit all server entrypoints for ownership, nested relations, auth, CSRF, validation, concurrency/idempotency and sensitive errors. Review private cache headers/SW allowlist, CSP/security headers, cookies, dependencies and rate limits. Run entire mobile financial journey with two synthetic users. No new product modules.

## Implementation sequence
1. This is AUDIT/ACCEPTANCE ONLY before separately approved remediation. Inspect existing code/tests and run safe checks; write reports and test evidence under docs/reviews/security/ and ignored qa-output only. Do not change application behavior, dependencies, auth policy, schema or existing test assertions to make checks pass.
2. Inventory all entrypoints and authenticated data boundaries. Review owner resolution, nested IDs/composite refs, private provisioning, session JSON, cookies/revocation, origin/CSRF, redirects, serverless abuse controls and input validation. Source findings need exact path/line evidence.
3. Review raw SQL/transaction scopes, lock order, retry keys, concurrent payments/refresh/rollover, post-refresh reversals, immutable closing snapshots, export injection and private cache policy including service worker. Never run load/destructive tests on production or touch another user's real rows.
4. Run existing test commands and safe exploratory browser/API probes against isolated approved fixtures. Full journey: A setup, balance refresh, target, recurring item, gas installments, income receipt, reserve partial settlement, rollover, close/history/export, logout then B. Capture synthetic-only evidence and verify cleanup.
5. Phone 320/390/430 and desktop QA: focus, keyboard, labels, contrast, touch sizes, empty/error states, stale summaries, offline/update flow. Recheck every earlier blocked test; mark unexecuted physical-device checks explicitly pending.
6. Run npm audit and inspect current authoritative advisories. Distinguish runtime exposure, dev-tool deprecation, confirmed vulnerability and unsupported assumptions. Do not silently npm audit fix or upgrade.
7. Write prioritized findings with severity, reproduction, affected paths, user impact, recommended narrow fix and regression test. Separate confirmed/open, already fixed, accepted risk and coverage gap. Produce security and mobile acceptance summaries. Critical/high unresolved issues or missing essential isolation tests block Step18.
8. STOP after audit report. Hermes verifies findings independently. If fixes needed, prepare separate scoped remediation prompts for user approval; rerun the full relevant acceptance gate only after fixes. Do not claim deploy-ready from audit report existence alone.

## Expected deliverables
tests/security/*; tests/e2e/*; next.config.ts; docs/reviews/security.md; docs/reviews/mobile-acceptance.md
Adapt paths to actual established architecture without expanding scope; do not overwrite unrelated files. Use next unused migration number, never edit applied SQL. Document any justified deviation and verification impact.
For Step17 the audit-only write boundary overrides suggested application/test paths: reports and ignored evidence only; recommend code changes, do not make them.

## Step-specific acceptance
All quality gates; cross-user adversarial ID tests; concurrent payments/refreshed balances; rollover/closed history; offline/logout privacy; keyboard/a11y/320px checks. Re-QA all previous blockers. Critical/high findings block deployment; distinguish evidence from assumptions.
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
Write `docs/reviews/Step17-opencode.md` with scope, files, schema/API decisions, real commands/results, failures/blockers, synthetic fixture cleanup and remaining risks. This is the implementer's self-report, not Hermes approval. For completed Step01 preserve the historical self-report and write a separately named verification addendum instead of rewriting history.
Hermes independently inspects diff, reruns relevant checks/browser/DB probes and records `docs/reviews/Step17.md`. Do not mark the step complete yourself before this gate. Update roadmap statuses only from verified evidence. STOP after this step; do not run the next prompt. Return a concise handoff and wait for approval.

## Launch (operator reference; do not recursively launch yourself)
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step17-opencode-glm52.md)"
```
