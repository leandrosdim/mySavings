# Step18 — Vercel deployment and production smoke

Status: Planned; requires explicit user approval.

## Prerequisites
Step17 approved AND explicit user permission/resources for Vercel/Neon production.

## Bounded implementation
Review stable patch/advisory status again. Configure separate Neon test/production, least privilege, SSL, Vercel Node/runtime/env domains and auth callbacks. Apply reviewed migrations with backup/rollback plan, provision users privately, deploy only when approved. Document restore/recovery and ongoing dependency updates. No logging credentials or importing original Excel automatically.

## Expected paths (reconcile with actual code before prompt)
docs/deployment.md; docs/operations.md; .env.example; Vercel project settings (only authorized)

## Acceptance tests
Verify real deployment URL/HTTPS, login A/B, private data isolation, safe partial-payment test and cleanup, manifest/install/update behavior, no private caching, migration version/backup capability. Report physical-device checks separately. No GitHub push without current explicit permission.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step18-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step18.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
