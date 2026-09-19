# Step08 — Monthly plans and recurring templates

Status: Planned; requires explicit user approval.

## Prerequisites
Step07 approved.

## Bounded implementation
Create current monthly plan with protected savings target and exact date/month uniqueness. CRUD recurring expense/income templates with planned amounts. Templates are definitions, not extra liabilities. Generate current-month entries idempotently; editing template does not rewrite prior instances. Full rollover later.

## Expected paths (reconcile with actual code before prompt)
lib/months/*; lib/templates/*; app/(private)/plan/*; tests/months/*

## Acceptance tests
Test month uniqueness, savings target vs monthly contribution semantics, template updates preserve history, rerun generation no duplicate. Mobile target/template forms with two-user isolation.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step08-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step08.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
