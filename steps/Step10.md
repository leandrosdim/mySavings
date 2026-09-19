# Step10 — Partial payments and receipts engine

Status: Planned; requires explicit user approval.

## Prerequisites
Step09 approved. Review financial rules carefully before prompt.

## Bounded implementation
Implement transaction-safe partial expense payment and income receipt with UPDATE_ACCOUNT versus ALREADY_REFLECTED mode. Validate same owner/account, lock rows in deterministic order, reject overpayment, idempotency key plus payload hash, immutable audit/movements. Reversal design includes later manual refresh: never blindly change a refreshed balance. Backend only to keep gate bounded.

## Expected paths (reconcile with actual code before prompt)
lib/settlements/*; app/api/settlements/* or server actions; tests/settlements/*; docs/settlements.md

## Acceptance tests
Gas 80 paid 40+40, more than remaining rejected; concurrent payments and retries never double-debit. Rollback fault injection, receipt symmetry, ownership, stale refresh/version checks, reversal after refresh reconciliation. Core forecast invariance verified.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step10-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step10.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
