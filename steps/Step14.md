# Step14 — Month rollover preview and apply

Status: Planned; requires explicit user approval.

## Prerequisites
Step13 approved.

## Bounded implementation
Build guided next-month preview: recurring entries, remaining obligations, persistent reserves and proposed prior savings target. Carry unpaid same identity, not copied liability. Apply all choices atomically with idempotency/unique keys. Accounts not duplicated; template changes not retroactive. Explicit transaction ordering with concurrent settlement.

## Expected paths (reconcile with actual code before prompt)
lib/rollover/*; app/(private)/months/new/*; tests/rollover/*

## Acceptance tests
Double-submit and concurrent apply generate once. Partial obligation remainder/reserve carries once, paid history stays previous month. Rollback leaves no half-month. Browser preview/cancel/confirm with all amounts checked.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step14-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step14.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
