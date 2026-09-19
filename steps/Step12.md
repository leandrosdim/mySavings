# Step12 — Reserved commitments and tax money

Status: Planned; requires explicit user approval.

## Prerequisites
Step11 approved.

## Bounded implementation
Create/edit/release/partially settle earmarked commitments such as future taxes. Their outstanding protected amount is separate from savings goal. Reuse settlement engine; never add same liability to both ordinary expense remainder and reserve total. Preserve commitments across months, due date optional. Mobile overview/detail/history.

## Expected paths (reconcile with actual code before prompt)
lib/commitments/*; app/(private)/commitments/*; tests/commitments/*

## Acceptance tests
Creation changes spendable only; partial payment changes account and reserved remainder once; already-reflected variant; linked display not double counted; release audited; ownership; mobile CRUD/partial settlement and future due-date protection.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step12-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step12.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
