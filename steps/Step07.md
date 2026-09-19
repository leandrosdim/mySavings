# Step07 — Mobile shell and account screens

Status: Planned; requires explicit user approval.

## Prerequisites
Step06 approved; confirm Greek UI assumption.

## Bounded implementation
Implement protected mobile navigation and account list/detail forms using real backend. Freshness labels, inline errors, decimal keyboard and accessible sheets. No fake financial KPI or placeholder navigation implying implemented features. Personal login identity visible enough to avoid accidental account confusion.

## Expected paths (reconcile with actual code before prompt)
app/(private)/layout.tsx; app/(private)/accounts/*; components/ui/*; tests/e2e/accounts.*

## Acceptance tests
Phone widths 320/390/430 and desktop; real create/refresh/rename flows, keyboard/focus/overflow checks. Direct unauthorized requests blocked. User A logout/B login reveals no A data. Clean test rows.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step07-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step07.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
