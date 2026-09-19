# Step06 — Account balances and adjustments backend

Status: Planned; requires explicit user approval.

## Prerequisites
Step05 approved.

## Bounded implementation
Owner-scoped account create/list/rename/archive plus manually replace current balance with as-of time, version guard and immutable adjustment. Distinguish absent opening balance from zero. Internal transfers atomic and net-zero; archive rules must not silently remove funded accounts. No full transaction categorization.

## Expected paths (reconcile with actual code before prompt)
lib/accounts/*; app/api/accounts/* or server actions; tests/accounts/*

## Acceptance tests
Test same-client rollback, balance replacement not addition, concurrency conflict, archive restrictions, net-zero transfer and A/B read/write/ID isolation. No credentials in logs.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step06-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step06.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
