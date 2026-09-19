# Step02 — Financial calculation core and tests

Status: Planned; requires explicit user approval.

## Prerequisites
Step01 approved.

## Bounded implementation
Implement pure exact-cent money parsing/formatting, partial settlement remainder/status and forecast functions from docs/financial-rules.md. Types distinguish ordinary expenses and reserved commitments so obligations are counted once. Return setup-incomplete and shortfall explicitly. No DB/UI mutations.

## Expected paths (reconcile with actual code before prompt)
lib/finance/money.ts; lib/finance/forecast.ts; lib/finance/settlements.ts; tests/finance/*; package.json

## Acceptance tests
Tests for 80/40/40 gas, cent precision, invalid input, overpayment, received/pending income, commitments protected once, negative balances, missing input, internal transfer invariance. First show failing tests then implementation and green suite.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step02-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step02.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
