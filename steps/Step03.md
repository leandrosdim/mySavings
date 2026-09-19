# Step03 — Neon connection and migrations infrastructure

Status: Planned; requires explicit user approval.

## Prerequisites
Step02 approved; user supplies new project Neon test connection privately. Do not reuse another project DB.

## Bounded implementation
Create server-only pg pool, transaction helper, env validation and forward SQL migration runner with checksums, advisory lock and schema_migrations. Explicit same-client transactions. Placeholder env docs, no real connection in output. No business schema beyond migration metadata.

## Expected paths (reconcile with actual code before prompt)
lib/db.ts; db/migrations.js; db/migrations/; scripts/db-check.mjs; docs/database.md; .env.example

## Acceptance tests
Apply test migration transactionally twice, second no-op; verify checksum mismatch/error rollback with temporary tests. Test missing config safe error and connection boolean. DB unavailable = blocked, not approved.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step03-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step03.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
