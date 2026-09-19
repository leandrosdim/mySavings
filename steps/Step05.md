# Step05 — Owner-scoped financial schema

Status: Planned; requires explicit user approval.

## Prerequisites
Step04 approved; inspect auth user ID type and transaction conventions first.

## Bounded implementation
Add owner-scoped continuous accounts, monthly plans, recurring templates, obligations (ordinary/reserved), expected income, immutable settlements, account movements, adjustments, idempotency and audit structures. Model many partial settlements. Preserve obligation identity for carryover. Owner-aware composite FKs and unique recurring/month keys. No CRUD UI yet.

## Expected paths (reconcile with actual code before prompt)
db/migrations/002_finance.sql; docs/schema.md; tests/db/schema.*

## Acceptance tests
Run migration twice; test invalid cents/ranges and cross-owner relationships rejected, rollback, unique generation keys. Show only aggregate DB verification. No real data imports.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step05-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step05.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
