# Step11 — Mobile settlement and reconciliation UX

Status: Planned; requires explicit user approval.

## Prerequisites
Step10 approved.

## Bounded implementation
Payment/receipt bottom sheet: editable amount prefilled with remaining, account/date, explicit balance mode and preview. Show planned/paid/remaining/history. Guide balance-refresh reconciliation and reversals, warn until reviewed. No ambiguity about whether balance changes. No offline queuing.

## Expected paths (reconcile with actual code before prompt)
components/settlements/*; app/(private)/activity/*; app/(private)/accounts/*; tests/e2e/settlements.*

## Acceptance tests
Browser pay 40 of 80 then 40, receipt modes, invalid/overpay handling, repeat submit, corrections and balance refresh already-reflected flow. Verify persisted DB amounts and mobile keyboard usability; clean fixtures.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step11-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step11.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
