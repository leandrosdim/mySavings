# mySavings — agent instructions

## Product
Private mobile-first personal finance PWA replacing a monthly Excel workbook. Next.js App Router + TypeScript, Vercel, Neon PostgreSQL. Read docs/product.md and docs/financial-rules.md.
Each user has fully private finances. No shared dashboard, impersonation or app-admin access to another user's finances. DB operators technically retain access; do not promise end-to-end encryption.

## Execution contract
- Hermes reviews exactly one steps/StepNN.md and prerequisites, then writes prompts/StepNN-opencode-glm52.md with detailed implementation/verification instructions.
- Run `opencode run --agent build --model ollama-cloud/glm-5.2` from this root. No model substitution without user approval.
- OpenCode implements only that step and stops. Hermes independently reviews files, reruns checks/browser/DB tests, records docs/reviews/StepNN.md, and reports.
- Wait for explicit user approval before the next step. Split oversized steps. Never mark untested work complete.
- No pushes, deployment, paid resources or production migrations without explicit approval. Do not change other projects or silently modify global configuration.

## Architecture and financial correctness
- Raw parameterized PostgreSQL through pg; no ORM/query builder. Forward migrations under db/migrations with db/migrations.js. Explicit BEGIN/COMMIT/ROLLBACK on one client for writes.
- Derive ownership from verified server session, never client input. Scope every read/write/export/nested relation. Owner-aware foreign keys and two-user negative tests.
- EUR exact cents, no floating-point financial arithmetic. Validate ranges/precision/dates server-side.
- Current bank balances are manually refreshed; replacing a balance is an audited adjustment, not an income/payment or change to historical snapshots.
- Preserve planned expense amounts. Store multiple partial payments; remaining = planned minus non-reversed settlements. Reject overpayments in v1. Never zero the original amount on payment.
- Settlements explicitly update the selected account OR are already reflected in its current balance. Same rule for income. Lock rows, deduplicate retries, and atomically write payment/account movement/audit.
- Reserved funds are outstanding commitments (e.g. taxes), additional to protected savings. Protect outstanding amounts once, even if displayed as linked expenses. Carry them forward until settled/released.
- Internal transfers are not income/expenses. Corrections/reversals retain history. Rollover must not duplicate commitments or accounts. Closing snapshots stay immutable.

## Privacy and PWA
- Never print/copy secrets or real workbook data into prompts, fixtures, public UI, docs, logs or git. Local private .env; .env.example contains only blanks/placeholders. No reading other projects' credentials.
- No real data import/live user provisioning without approval. Synthetic fixtures must be marked test-only and cleaned up.
- Online-only financial writes in v1. No background replay. Never service-worker-cache authenticated HTML/RSC/API responses or exports. Explicit public-static asset allowlist only.
- Private data must not survive logout in app caches; test same-device user switching. No fake offline balances.
- Mobile-first: touch controls >=44px, safe areas, keyboard-safe forms, readable euros, no page overflow at 320px. Accessible focus/labels/contrast/reduced motion.
- Greek UI is an initial assumption from workbook; confirm before full UI. English code/docs. Real phone-width and desktop browser QA.

## Quality gates
Run npm run lint, npm run typecheck, npm test (when introduced), npm run build and npm audit. No npm audit fix --force.
Financial code requires deterministic unit tests, DB rollback/idempotency/concurrency tests and two-user isolation tests. UI requires real browser and console checks, not just build/curl.
Use approved test DB credentials; missing DB is a blocker, not permission to invent results. Clean scoped fixtures and stop owned servers.
Preserve planning docs on scaffolding; maintain README, step index, financial rules and reviews. Never commit personal XLSX/populated exports.
