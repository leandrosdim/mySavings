# Step18 — Vercel deployment and production smoke

## Prompt registration
Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Status: Registered prompt; NOT IMPLEMENTED. Requires explicit approval and satisfied prerequisites before execution.
Mode: Execute only the bounded approved scope below.
This entire file is a ready-to-run prompt, not merely a feature outline. Saving it does not authorize execution. `steps/Step18.md` is canonical; `prompts/Step18-opencode-glm52.md` is its identical execution copy. Keep both synchronized after any preflight amendment.

## Prerequisites / hard gate
Step17 approved AND explicit user permission/resources for Vercel/Neon production.
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
Review stable patch/advisory status again. Configure separate Neon test/production, least privilege, SSL, Vercel Node/runtime/env domains and auth callbacks. Apply reviewed migrations with backup/rollback plan, provision users privately, deploy only when approved. Document restore/recovery and ongoing dependency updates. No logging credentials or importing original Excel automatically.

## Implementation sequence
1. HARD GATE: require explicit current authorization for Vercel project creation/deployment, named production Neon target, domain, credentials supplied privately, migrations and private user provisioning. Confirm Step17 report plus any separately approved remediations have passed independent re-QA. Registration of this prompt is not deployment permission.
2. Review live supported Next/React/Node patches and official advisories; any code/dependency upgrade gets a scoped review and regression gate before deployment. Preserve production/test separation and do not send test traffic to production accidentally.
3. Document deployment topology, Node runtime, pool/direct migration settings, env names, auth callback/origin URLs, secret rotation, least privilege, TLS and private cache headers. Set secrets through approved provider mechanisms without printing them; no secrets in client env vars, repo or command-line history.
4. Establish recoverable backup/restore and migration rollback/forward-fix procedure before schema changes. Use approved production connection only at explicit migration gate, inspect migration checksums and apply once, verify ledger. Avoid destructive rollback as a default. Confirm available Neon retention/restore features rather than assuming a paid plan.
5. Deploy preview first when supported, use isolated preview DB/auth configuration, verify HTTPS and headers. Promote/deploy production only after approved checks. A git push is a separate permission, never implied by deployment; do not connect/push remote repo without current authorization.
6. Provision real users only through approved private procedure; never log passwords. Production smoke uses authorized marked disposable fixtures where possible, no real bank/payment integrations. Verify login/logout, A/B isolation, account update, partial payment amount correctness, reserve once-only behavior, manifest/worker/private caching and scoped cleanup.
7. Record verifiable deployment URL, build/deployment ID, migration status, smoke results, remaining physical-device tests and operator recovery steps without credentials. Report actual HTTP/runtime evidence, not a CLI self-report alone. Never claim full readiness with critical findings or missing essential checks.
8. STOP and deliver deployment/operations documentation. No scheduling maintenance jobs, recurring cost or automatic future upgrades without separate approval.

## Expected deliverables
docs/deployment.md; docs/operations.md; .env.example; Vercel project settings (only authorized)
Adapt paths to actual established architecture without expanding scope; do not overwrite unrelated files. Use next unused migration number, never edit applied SQL. Document any justified deviation and verification impact.
For Step17 the audit-only write boundary overrides suggested application/test paths: reports and ignored evidence only; recommend code changes, do not make them.

## Step-specific acceptance
Verify real deployment URL/HTTPS, login A/B, private data isolation, safe partial-payment test and cleanup, manifest/install/update behavior, no private caching, migration version/backup capability. Report physical-device checks separately. No GitHub push without current explicit permission.
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
Write `docs/reviews/Step18-opencode.md` with scope, files, schema/API decisions, real commands/results, failures/blockers, synthetic fixture cleanup and remaining risks. This is the implementer's self-report, not Hermes approval. For completed Step01 preserve the historical self-report and write a separately named verification addendum instead of rewriting history.
Hermes independently inspects diff, reruns relevant checks/browser/DB probes and records `docs/reviews/Step18.md`. Do not mark the step complete yourself before this gate. Update roadmap statuses only from verified evidence. STOP after this step; do not run the next prompt. Return a concise handoff and wait for approval.

## Launch (operator reference; do not recursively launch yourself)
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step18-opencode-glm52.md)"
```
