# Step04 — Private authentication and identity

Status: Planned; requires explicit user approval.

## Prerequisites
Step03 approved; choose maintained stable auth library/provider after checking current docs/advisories; confirm sign-in method before prompt.

## Bounded implementation
Implement two private user identities and secure sessions, login/logout, protected route guard and private provisioning/invite approach. No public registration. Raw SQL identity schema, secure cookies, CSRF/origin controls, session expiry/revocation and distributed rate limiting where relevant. No custom cryptography or invented identity provider. No shared/admin financial access.

## Expected paths (reconcile with actual code before prompt)
db/migrations/001_identity.sql; lib/auth/*; app/login/*; app/api/auth/*; scripts/provision-user.*; docs/auth.md

## Acceptance tests
Test login failure/success/logout/revocation, unauthenticated direct requests, no user enumeration. Temporary users A/B only, no committed passwords. Browser-login/logout and verify cookies; document provisioning/recovery.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step04-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step04.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
