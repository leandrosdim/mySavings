# Step15 — Month closing, history and private exports

Status: Planned; requires explicit user approval.

## Prerequisites
Step14 approved; agree explicit closed-month correction policy before prompt.

## Bounded implementation
Store immutable closing snapshots and expose historical plan/settlement comparisons without rewriting from live balances. Define actual payment totals vs unclassified adjustments. Secure owner-filtered CSV export with formula-injection neutralization and no-store headers. Add JSON backup if scoped; restore/import is not automatic.

## Expected paths (reconcile with actual code before prompt)
lib/history/*; app/(private)/history/*; app/api/exports/*; tests/history/*; docs/backup.md

## Acceptance tests
Later balance/target changes cannot alter closed snapshots; payment/correction rules around closed month enforced. A/B export isolation and CSV cells beginning =,+,-,@ safe. Date boundaries and mobile history/export tested.

## Execution rules
Read AGENTS.md, docs/product.md, docs/financial-rules.md and the prior review. Hermes must inspect current code/schema, resolve prerequisites and create a detailed prompts/Step15-opencode-glm52.md immediately before execution. Use only ollama-cloud/glm-5.2 through OpenCode. Do not execute future steps. No ORM, no exposed secrets, no pushes/deployment unless separately approved, no real data fixtures. All money is exact cents; all data is server-session-owner scoped; all writes explicit transactions.

## Independent gate
Hermes inspects changed files and reruns npm run lint, npm run typecheck, npm test (once introduced), npm run build and npm audit. For UI, real phone/desktop browser and console checks; for DB, actual test DB transaction/isolation checks. Missing credentials or device access must be recorded as blocked/unverified. Save docs/reviews/Step15.md with files, decisions, commands/results, risks and next-step readiness. STOP for user approval.
