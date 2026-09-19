# Step01 — Stable Next.js foundation

Status: Authorized; implementation pending.

## Prerequisites
None; creation request authorizes this step only.

## Bounded implementation
Initialize minimal runnable Next.js 16.3.5, React 19.3.0, TypeScript strict, Tailwind and ESLint. Pin framework dependencies and create npm lockfile. Preserve existing planning docs. Package name mysavings (npm lowercase), folder/brand mySavings. Create tasteful Greek mobile-first foundation page, clearly unfinished, with no fake balances or working-feature claims. Add metadata/viewport and local/system fonts. No DB/auth/business logic/service worker yet.

## Expected paths (reconcile with actual code before prompt)
package.json; package-lock.json; app/layout.tsx; app/page.tsx; app/globals.css; next.config.ts; tsconfig.json; eslint.config.mjs; postcss.config.mjs; .env.example; README.md

## Acceptance tests
Run npm run lint, npm run typecheck, npm run build, npm audit. Browser-check phone and desktop, console, metadata and 404; no horizontal overflow. App builds without DB/secrets. Record installed versions and audit result.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step01-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step01.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
