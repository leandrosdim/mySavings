# Step16 — Installable privacy-safe PWA

Status: Planned; requires explicit user approval.

## Prerequisites
Step15 approved; inspect actual routes/auth/caching first.

## Bounded implementation
Add manifest with stable app id, standalone display, real 192/512/maskable icons, apple touch icon, mobile safe-area polish, install help for Android/iOS. Minimal versioned service worker caches ONLY explicit public assets and generic offline page; never financial/auth HTML, RSC, API, exports or writes. Online-required states with no payment retry queue. Update lifecycle and logout cache cleanup.

## Expected paths (reconcile with actual code before prompt)
app/manifest.ts; public/icons/*; public/sw.js; app/offline/*; components/pwa/*; tests/pwa/*; docs/pwa.md

## Acceptance tests
Production browser verifies manifest/icon dimensions/SW registration/cache contents and offline fallback without private data. Test auth switching/logout/offline mutation prevention/update. Real physical-device install remains explicitly pending if unavailable; do not claim handset testing from desktop emulation.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step16-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step16.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
