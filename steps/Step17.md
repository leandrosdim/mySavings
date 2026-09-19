# Step17 — Security, isolation and mobile acceptance

Status: Planned; requires explicit user approval.

## Prerequisites
Step16 approved; split into substeps if findings large.

## Bounded implementation
Audit all server entrypoints for ownership, nested relations, auth, CSRF, validation, concurrency/idempotency and sensitive errors. Review private cache headers/SW allowlist, CSP/security headers, cookies, dependencies and rate limits. Run entire mobile financial journey with two synthetic users. No new product modules.

## Expected paths (reconcile with actual code before prompt)
tests/security/*; tests/e2e/*; next.config.ts; docs/reviews/security.md; docs/reviews/mobile-acceptance.md

## Acceptance tests
All quality gates; cross-user adversarial ID tests; concurrent payments/refreshed balances; rollover/closed history; offline/logout privacy; keyboard/a11y/320px checks. Re-QA all previous blockers. Critical/high findings block deployment; distinguish evidence from assumptions.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step17-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step17.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
