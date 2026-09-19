# Step13 — Savings-first overview and forecast

Status: Planned; requires explicit user approval.

## Prerequisites
Step12 approved.

## Bounded implementation
Wire tested forecast core to live owner queries. Highlight protected month-end target, projected/cash-backed free-to-spend and shortfall. Explain pending income dependence and stale/incomplete balances. Drill into forecast inputs, do not invent actual expenses from balance adjustments. Reserved commitments protected before due date.

## Expected paths (reconcile with actual code before prompt)
lib/dashboard.ts; app/(private)/page.tsx; components/overview/*; tests/dashboard/*

## Acceptance tests
Compare synthetic known fixture to pure formulas; verify output after partial payments, reserves and refresh. A/B isolation, honest empty state, negative values and phone/desktop real browser pass.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step13-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step13.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
