# Step09 — Expense plans and income expectations

Status: Planned; requires explicit user approval.

## Prerequisites
Step08 approved.

## Bounded implementation
CRUD ordinary monthly expenses (fixed/variable weekly budgets) and income expectations. Preserve planned value and show remaining from settlement sums; no settlement mutation in this step. Edit/archive restrictions preserve settled history. Owner and month filtering, empty states, date validation.

## Expected paths (reconcile with actual code before prompt)
lib/obligations/*; lib/income/*; app/(private)/activity/*; tests/plans/*

## Acceptance tests
CRUD valid/invalid amounts/months, no cross-owner ID access, verify gas plan remains 80 until payments. Phone forms/filter switching, no settlement-history loss.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step09-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step09.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
