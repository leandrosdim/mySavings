# Step03 — Neon connection and migrations infrastructure

## Prompt registration
Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Status: Registered prompt; NOT IMPLEMENTED. Requires explicit approval and satisfied prerequisites before execution.
Mode: Execute only the bounded approved scope below.
This entire file is a ready-to-run prompt, not merely a feature outline. Saving it does not authorize execution. `steps/Step03.md` is canonical; `prompts/Step03-opencode-glm52.md` is its identical execution copy. Keep both synchronized after any preflight amendment.

## Prerequisites / hard gate
Step02 approved; user supplies new project Neon test connection privately. Do not reuse another project DB.
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
Create server-only pg pool, transaction helper, env validation and forward SQL migration runner with checksums, advisory lock and schema_migrations. Explicit same-client transactions. Placeholder env docs, no real connection in output. No business schema beyond migration metadata.

## Implementation sequence
1. Check only that required env keys exist; do not print values. Confirm the user-authorized target is a mySavings development/test Neon database/branch, not another app or production. If target permission cannot be established, stop before connecting or mutating. An existing .env alone is not authorization.
2. Install pg plus required types and an explicit server-only boundary. Implement bounded pool use suitable for Node/Vercel, connection timeouts, safe errors and checked client release. Do not disable TLS verification. Avoid eager DB network access during build.
3. Implement withTransaction on one checked-out client: BEGIN, callback queries on that client, COMMIT, ROLLBACK on error, release in finally. Do not use pool.query for statements that must share a transaction; test error/rollback/release paths.
4. Create db/migrations.js in a module format compatible with package.json, plus npm run db:migrate and npm run db:check. Load private env without logging it. Ordered SQL migrations, durable version/checksum ledger, migration advisory lock held on same session, atomic SQL+ledger recording, checksum mismatch refusal. Reject unsafe transactional migration patterns rather than falsely claiming rollback support.
5. Explain pooled app URL versus suitable direct/session-capable migration connection; optionally document MIGRATION_DATABASE_URL if required, blank in .env.example. Verify chosen Neon connection mode supports the migration lock; do not blindly hold session locks through transaction pooling.
6. Test migration infrastructure on an isolated approved disposable schema/branch, never by corrupting applied project migrations. Apply twice, assert no-op on second run; deliberate migration failure must leave neither schema changes nor success ledger; checksum mismatch must stop; two concurrent runners must serialize.
7. Commit-track genuine migration SQL despite any ignore pattern. Create no business or authentication schema yet. Do not present a mocked driver test as proof of real Neon integration. Report counts/boolean checks only and clean only test-owned artifacts.

## Expected deliverables
lib/db.ts; db/migrations.js; db/migrations/; scripts/db-check.mjs; docs/database.md; .env.example
Adapt paths to actual established architecture without expanding scope; do not overwrite unrelated files. Use next unused migration number, never edit applied SQL. Document any justified deviation and verification impact.
For Step17 the audit-only write boundary overrides suggested application/test paths: reports and ignored evidence only; recommend code changes, do not make them.

## Step-specific acceptance
Apply test migration transactionally twice, second no-op; verify checksum mismatch/error rollback with temporary tests. Test missing config safe error and connection boolean. DB unavailable = blocked, not approved.
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
Write `docs/reviews/Step03-opencode.md` with scope, files, schema/API decisions, real commands/results, failures/blockers, synthetic fixture cleanup and remaining risks. This is the implementer's self-report, not Hermes approval. For completed Step01 preserve the historical self-report and write a separately named verification addendum instead of rewriting history.
Hermes independently inspects diff, reruns relevant checks/browser/DB probes and records `docs/reviews/Step03.md`. Do not mark the step complete yourself before this gate. Update roadmap statuses only from verified evidence. STOP after this step; do not run the next prompt. Return a concise handoff and wait for approval.

## Launch (operator reference; do not recursively launch yourself)
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step03-opencode-glm52.md)"
```
