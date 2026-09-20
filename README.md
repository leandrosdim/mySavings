# mySavings

Private, mobile-first personal finance PWA replacing a monthly Excel workbook.
Built with Next.js App Router + TypeScript. **Step01 and Step02 independently verified**:
a runnable Greek mobile-first foundation and a tested pure financial calculation core.
Database integration, authentication, persisted payments, PWA install and deployment
are not yet implemented (see `steps/README.md`). API contracts: `docs/finance-api.md`.

## Confirmed rules (summary)

- EUR exact cents; no floating-point financial arithmetic. Server-side validation.
- Raw parameterized PostgreSQL via `pg`; no ORM. Explicit transactions for writes.
- Every read/write is scoped to the verified server session owner. No shared views,
  impersonation or cross-user access. DB operators technically retain access;
  end-to-end encryption is not promised.
- Current bank balances are manually refreshed; replacing a balance is an audited
  adjustment, not an income/payment or change to historical snapshots.
- Planned expense amounts are preserved. Multiple partial payments stored;
  remaining = planned minus non-reversed settlements. Overpayments rejected in v1.
- Reserved funds are outstanding commitments (e.g. taxes), additional to protected
  savings. Protected once, carried forward until settled/released.
- Internal transfers are not income/expenses. Corrections/reversals retain history.
- Closed-month snapshots are immutable.

Full financial rules and acceptance scenarios: `docs/financial-rules.md`.

## Requirements

- Node.js 22.x (project engine). Local tested on Node 22.21.1, npm 11.12.1.
- Greek UI (`el`), English code/docs. No external font/asset fetch in Step01.

## Local commands

```bash
npm install        # install dependencies (creates package-lock.json)
npm run dev        # start dev server at http://localhost:3000
npm run build      # production build (no DB/secrets needed)
npm run start      # serve the production build
npm run lint       # eslint .
npm run typecheck   # next typegen && tsc --noEmit
npm test           # deterministic financial unit/regression tests
npm run test:watch # interactive Vitest watch mode
npm audit          # inspect advisories; do NOT run npm audit fix --force
```

If you already have a private `.env`, keep it; never overwrite an
existing `.env`. New credentials belong in your private `.env`, not in git.

## Roadmap

All 18 steps are written as ready-to-run prompts in `steps/Step01.md` through
`steps/Step18.md`, with identical execution copies in `prompts/` and a machine-readable
`steps/registry.json`. Start with the ordered register in `steps/README.md`.
Step01 and Step02 are independently verified; Step03–Step18 are registered, not implemented.
Each gate: user approval → Hermes current-code/prerequisite review → OpenCode
GLM 5.2 execution → independent verification → report and stop. Prompt preparation
does not authorize execution, deployment or a push. The original executed Step01
prompt is preserved in `prompts/archive/`; its current prompt is verification-only
by default.

## Scope notes (honest current state)

- Next.js foundation plus pure finance helpers and 129 passing tests. No connected database, auth, PWA service worker or deployment.
- Real Neon URL supplied privately in .env; not used in Step02. Confirm the database/branch and development/test scope before Step03. Production changes require separate approval.
- Users are separate and private; the auth method is chosen at Step04.
- No real workbook data is copied into source, fixtures or git.