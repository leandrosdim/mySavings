# Step01 — Stable Next.js foundation

## Prompt registration
Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Status: Completed; independent verification recorded in docs/reviews/Step01.md. Verification-only if rerun unless repair is explicitly authorized.
Mode: Execute only the bounded approved scope below.
This entire file is a ready-to-run prompt, not merely a feature outline. Saving it does not authorize execution. `steps/Step01.md` is canonical; `prompts/Step01-opencode-glm52.md` is its identical execution copy. Keep both synchronized after any preflight amendment.

## Prerequisites / hard gate
None; creation request authorizes this step only.
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
Initialize minimal runnable Next.js 16.3.5, React 19.3.0, TypeScript strict, Tailwind and ESLint. Pin framework dependencies and create npm lockfile. Preserve existing planning docs. Package name mysavings (npm lowercase), folder/brand mySavings. Create tasteful Greek mobile-first foundation page, clearly unfinished, with no fake balances or working-feature claims. Add metadata/viewport and local/system fonts. No DB/auth/business logic/service worker yet.

## Implementation sequence
1. This step is ALREADY COMPLETE. Read docs/reviews/Step01.md. Do not rerun scaffolding, reset git, overwrite private env, or discard later work. Default action on rerun is verification only; repair a regression only with explicit authorization.
2. Confirm package name mysavings, visible brand mySavings, Next App Router, strict TypeScript, Tailwind v4, lockfile, system/local fonts and scripts. Verified baseline: Next/eslint-config-next 16.3.5, React/react-dom 19.3.0, Node 22.x, @types/node 22.20.4. Do not upgrade packages merely because this historical step is rerun.
3. If explicitly authorized to repair foundation, preserve the app's honest unconfigured state, Greek layout/metadata, 404 navigation, mobile safe areas and zoom. No fake balances, login functionality, DB, manifest or service worker at this step.
4. Verify .env and generated files are ignored while .env.example is allowed. Never print actual env values. Keep financial rules, roadmap, prompts and existing commits unchanged except approved documentation corrections.
5. Confirm phone 320/390/430px and desktop 1440px show no horizontal page overflow. Check real production browser, title/lang/viewport, home HTTP 200, missing route 404 and actual return-home click.
6. Record ESLint 9 compatibility/deprecation as a maintenance risk. npm audit passing does not prove complete security. No npm test exists before Step02; explicitly report not applicable instead of claiming tests passed.

## Expected deliverables
package.json; package-lock.json; app/layout.tsx; app/page.tsx; app/globals.css; next.config.ts; tsconfig.json; eslint.config.mjs; postcss.config.mjs; .env.example; README.md
Adapt paths to actual established architecture without expanding scope; do not overwrite unrelated files. Use next unused migration number, never edit applied SQL. Document any justified deviation and verification impact.
For Step17 the audit-only write boundary overrides suggested application/test paths: reports and ignored evidence only; recommend code changes, do not make them.

## Step-specific acceptance
Run npm run lint, npm run typecheck, npm run build, npm audit. Browser-check phone and desktop, console, metadata and 404; no horizontal overflow. App builds without DB/secrets. Record installed versions and audit result.
Execute the specific scenarios above in addition to the common gate. Tests must exercise real production helper/route paths, not duplicate the business logic in a separate test-only implementation. Mocked tests supplement but do not replace required DB/browser integration.

## Verification commands and evidence
Run from the project root:
```bash
npm run lint
npm run typecheck
npm run build
npm audit
git diff --check
git status --short --untracked-files=all
git diff --stat
```
No npm test exists in the completed foundation; report N/A, not PASS.

For DB scope: use only approved disposable dev/test data, run the real migration gate where applicable (`npm run db:migrate` after Step03 introduces it), prove second run idempotence, constraints, rollback, concurrency and A/B isolation for changed paths. Do not mutate production to test failures. Report only redacted counts/booleans.
For UI scope: run actual app, verify health before browser; test 320/390/430px and desktop, relevant real interactions, persistence, console and horizontal overflow. Capture synthetic-only screenshots under ignored qa-output/. Build/HTTP alone is not browser approval. Physical-device checks must be labeled separately from emulation.
Clean only test-owned fixtures, close owned QA browser sessions and stop owned servers; verify cleanup. Do not kill unrelated processes.

## Report, independent review and STOP
Write `docs/reviews/Step01-opencode.md` with scope, files, schema/API decisions, real commands/results, failures/blockers, synthetic fixture cleanup and remaining risks. This is the implementer's self-report, not Hermes approval. For completed Step01 preserve the historical self-report and write a separately named verification addendum instead of rewriting history.
Hermes independently inspects diff, reruns relevant checks/browser/DB probes and records `docs/reviews/Step01.md`. Do not mark the step complete yourself before this gate. Update roadmap statuses only from verified evidence. STOP after this step; do not run the next prompt. Return a concise handoff and wait for approval.

## Launch (operator reference; do not recursively launch yourself)
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step01-opencode-glm52.md)"
```
