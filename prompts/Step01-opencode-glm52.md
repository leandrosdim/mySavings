# mySavings Step01 — reviewed implementation prompt for OpenCode GLM 5.2 Cloud

Work exclusively inside /home/leandrosdim777/projects/mySavings. Model requested: ollama-cloud/glm-5.2. Implement ONLY steps/Step01.md and stop. Do not proceed to Step02, build database/auth/business features, deploy, push or commit.

## Read first
AGENTS.md, docs/product.md, docs/financial-rules.md, docs/dependency-review.md, steps/Step01.md and steps/README.md. These files are protected planning state; preserve their financial rules. Existing root contains docs/steps/.gitignore and a newly initialized main git repo, no application yet. The folder has uppercase letters but npm package name must be `mysavings` and visible brand `mySavings`.

## Verified dependency baseline
On 2026-09-19 Hermes independently checked npm dist-tags: latest stable Next.js 16.3.5 (NOT 16.4 canary), React/react-dom 19.3.0. Next peer requirements accept React ^19 and Node >=20.9; local Node 22.21.1/npm 11.12.1. Official August security release patched 16.3.3; use 16.3.5. Pin next and eslint-config-next exactly 16.3.5; react and react-dom exactly 19.3.0. Use supported compatible stable TypeScript, Tailwind v4/postcss, ESLint and React/Node types. Keep dependencies minimal and lock npm. Set Node engine 22.x for initial target. No experimental flags, ORM, auth or PWA packages needed yet.

## Deliverables
1. A real runnable Next.js App Router app with strict TS, @/* aliases, Tailwind v4 configured correctly, ESLint flat config, Next config and next-env.d.ts. You may scaffold manually or under `.scaffold-next/` inside this project then merge app/config only. Never scaffold outside project or overwrite planning files/.git. Clean scaffolding after merge.
2. package scripts dev/start/build, lint (`eslint .`), typecheck (generate Next types when necessary and tsc --noEmit). Do not create a fake test script claiming tests passed: financial tests arrive in Step02. Build must not need any credentials, external fonts or DB.
3. Root layout with mySavings metadata, mobile viewport/theme color, system/local fonts (no external font fetch). Greek initial UI (document assumption), semantic accessible markup.
4. Minimal tasteful MOBILE-FIRST foundation screen at `/`: brand, compact foundation status, introduction focused on preserving savings, short clear description of partial payments and private user spaces as future features, a visible 'foundation / not yet configured' state. Do not show fabricated balances, a functioning sign-in, disabled misleading nav or fake payment controls. No claim that auth/PWA/data storage already exists. No financial data copied from the actual Excel. Emerald/neutral clean palette, generous touch/readable sizes, restrained typography, accessible contrast, no stock boilerplate/Vercel logos. Phone <=320px layout with no page overflow; desktop narrow polished layout. A simple not-found page/link is fine. No service worker or manifest yet: installation is Step16, but mobile design starts now.
5. `.env.example` with blank DATABASE_URL only if appropriate and explanation it is needed in Step03, no real `.env` or generated secret. Preserve .gitignore exclusions and allow .env.example; ignore generated artifacts/local logs/screenshots, Excel/private data. No secrets, no cat .env*, no printenv.
6. README with purpose, confirmed rules summary, exact local npm commands, Node requirement, roadmap link and honest current scope (Next foundation only, DB/auth/PWA/deployment pending). New credentials belong in private env when supplied; never instruct overwriting existing .env. State separate private users and future Neon/Vercel setup. Keep existing financial docs intact.
7. `docs/reviews/Step01-opencode.md` reporting files, decisions, exact commands/results and blockers. This is YOUR self-report; do not claim Hermes/browser verification you did not run. Do not mark future steps complete.

## Run these checks yourself
- npm run lint
- npm run typecheck
- npm run build
- npm audit (full dependencies). Inspect advisories if any; no npm audit fix --force/downgrades. Report unresolved issues honestly.
- npm ls next react react-dom eslint-config-next
- Verify git excludes .env/node_modules/.next and allows .env.example.

Hermes will independently start the app and browser-test phone/desktop after your process finishes. You do not need to start a detached server or use browser MCP in this foundation task. If you do use a server, stop it before final report. No tmp/external screenshot writes. Real end-user device install is not part of this gate.

## Hard stop / final report
Stop after Step01. Report files created/modified, versions, assumptions, command results and remaining blockers. Do not request unavailable secrets or continue automatically. Do not edit global OpenCode configuration.
