# Step16 — Installable privacy-safe PWA

## Prompt registration
Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Status: Registered prompt; NOT IMPLEMENTED. Requires explicit approval and satisfied prerequisites before execution.
Mode: Execute only the bounded approved scope below.
This entire file is a ready-to-run prompt, not merely a feature outline. Saving it does not authorize execution. `steps/Step16.md` is canonical; `prompts/Step16-opencode-glm52.md` is its identical execution copy. Keep both synchronized after any preflight amendment.

## Prerequisites / hard gate
Step15 approved; inspect actual routes/auth/caching first.
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
Add manifest with stable app id, standalone display, real 192/512/maskable icons, apple touch icon, mobile safe-area polish, install help for Android/iOS. Minimal versioned service worker caches ONLY explicit public assets and generic offline page; never financial/auth HTML, RSC, API, exports or writes. Online-required states with no payment retry queue. Update lifecycle and logout cache cleanup.

## Implementation sequence
1. Inspect deployed-intended route and auth/cache behavior. Implement manifest with stable id/start_url/scope, standalone display, colors, names, proper 192/512 PNG icons, separate maskable safe-area asset and apple-touch icon. Generate real assets, validate dimensions, no placeholder broken links.
2. Implement minimal versioned service worker with EXPLICIT allowlist of public static assets and generic offline shell. Never cache navigation HTML from authenticated pages, RSC/flight payloads, APIs, exports, auth endpoints, mutation responses or personal query strings. Avoid generic runtime stale-while-revalidate/catch-all strategies.
3. Navigation while offline returns generic offline information, not a snapshot of private finance. Disable financial submission when known offline but retain server correctness; never queue/replay background payments. Do not store financial form drafts, session tokens or balances in persistent caches/localStorage for offline use.
4. Show install guidance suited to Android Chrome and iOS Add to Home Screen, without claiming install is available in every browser. Respect dismissal, standalone detection, safe areas and virtual keyboard. No interruptive repeated prompts.
5. Versioned update lifecycle: tell user update is available, avoid forced reload during payment entry, remove only this app's obsolete named caches. Logout clears private in-memory/client state; authenticated back navigation and same-device A/B must not display prior user's data. Public assets can remain cached.
6. Production-build browser tests: manifest fetch/icons/MIME/scope, worker registration, cache inspection after authenticated use, offline reload, logout and A/B switch, write prevention, upgrade path. Enumerate allowed cache URLs and prove private responses absent. Separate actual device install evidence from desktop emulation; require handset acceptance before production sign-off if unavailable here.

## Expected deliverables
app/manifest.ts; public/icons/*; public/sw.js; app/offline/*; components/pwa/*; tests/pwa/*; docs/pwa.md
Adapt paths to actual established architecture without expanding scope; do not overwrite unrelated files. Use next unused migration number, never edit applied SQL. Document any justified deviation and verification impact.
For Step17 the audit-only write boundary overrides suggested application/test paths: reports and ignored evidence only; recommend code changes, do not make them.

## Step-specific acceptance
Production browser verifies manifest/icon dimensions/SW registration/cache contents and offline fallback without private data. Test auth switching/logout/offline mutation prevention/update. Real physical-device install remains explicitly pending if unavailable; do not claim handset testing from desktop emulation.
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
Write `docs/reviews/Step16-opencode.md` with scope, files, schema/API decisions, real commands/results, failures/blockers, synthetic fixture cleanup and remaining risks. This is the implementer's self-report, not Hermes approval. For completed Step01 preserve the historical self-report and write a separately named verification addendum instead of rewriting history.
Hermes independently inspects diff, reruns relevant checks/browser/DB probes and records `docs/reviews/Step16.md`. Do not mark the step complete yourself before this gate. Update roadmap statuses only from verified evidence. STOP after this step; do not run the next prompt. Return a concise handoff and wait for approval.

## Launch (operator reference; do not recursively launch yourself)
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step16-opencode-glm52.md)"
```
