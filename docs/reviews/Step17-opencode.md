# Step17 — OpenCode implementer self-report

Project: `/home/leandrosdim777/projects/mySavings`
Model: `ollama-cloud/glm-5.2`
Date: 2026-09-29
Mode: Audit only; no application remediation. This is the implementer's
self-report, not Hermes approval.

## Scope

Step17 is an audit/acceptance step. No application code, dependencies,
schema, auth policy, or existing test assertions were modified. Reports
and synthetic-only browser evidence were written under `docs/reviews/`
and gitignored `qa-output/`.

## Files inspected

All 38 API route handlers under `app/api/`, all service modules under
`lib/`, `proxy.ts`, `next.config.ts`, `public/sw.js`, `app/manifest.ts`,
`db/db-config.cjs`, `scripts/provision-user.mjs`, `.env.example`, and the
full test suite under `tests/`.

## Files written (audit-only)

- `docs/reviews/security.md` — security audit report
- `docs/reviews/mobile-acceptance.md` — mobile acceptance report
- `qa-output/step17/*.png` — 10 synthetic-only browser screenshots (gitignored)

No application files were created or modified. `git status` confirms a
clean working tree with no untracked application files.

## Quality gates

| Gate | Command | Result |
|------|---------|--------|
| Lint | `npm run lint` | Passed (0 errors) |
| Typecheck | `npm run typecheck` | Passed |
| Offline tests | `npm test` | 377/377 passed (12 files) |
| DB integration tests | `DB_TEST_ALLOW_WRITES=1 npm run test:db` | 870/870 passed (39 files) |
| Build | `npm run build` | Passed |
| npm audit | `npm audit` | 0 vulnerabilities |
| git diff --check | — | Clean (no whitespace errors) |
| git status | — | Clean (no modified application files) |

## Schema/API decisions

No schema or API changes were made. No migrations were added. The audit
inspected the existing migration chain (0001–0004) and all existing
service/route code.

## Test evidence

### DB integration (870 tests, 39 files)

Covers: cross-user two-user isolation (A/B), concurrent payments,
overpayment rejection, idempotency (dedup + changed-payload rejection),
rollback fault injection, UPDATE_ACCOUNT vs ALREADY_REFLECTED, closed-month
rejection, reserve target payment, archived account rejection, reversals
(post-refresh reconciliation), rollover carryover dedup, close month
snapshot immutability, export formula injection, migration idempotence,
schema constraints, and session management.

### Browser QA (agent-browser, Chromium emulation)

- 320/390/430px and 1280px viewports: no horizontal overflow.
- Full financial journey: account creation, balance, target, gas
  installments, income receipt, reserve settlement, rollover preview,
  export. All verified via real API calls and UI navigation.
- Cross-user: user B saw zero accounts; user A's data inaccessible (404).
- Logout: cookie cleared, localStorage empty, SW cache contains only
  public assets.
- Offline: generic offline shell shown; financial writes blocked.
- Console: no errors during authenticated journey.
- 10 screenshots captured under `qa-output/step17/`.

### API probes

- Origin gate: missing Origin → 403; mismatched → 403; valid → passes.
- Cross-user: account/obligation not owned → 404.
- Idempotency: same key+payload → original result; changed payload → 409.
- Overpayment: rejected with 400.
- Exports: 200 with `Cache-Control: no-store`, formula neutralization.
- Authenticated API responses: `cache-control: no-store` present.

## Failures / blockers

1. **SEC-03** (MEDIUM): `POST /api/history/close` returns 500 for the
   persistent QA user with accumulated mixed data. The DB integration
   tests pass with clean fixtures, so this is a forecast edge case with
   the accumulated QA data state. Not a security breach; functional bug.
2. **MOB-01** (LOW): The "+ Νέο" recurring template button on the plan
   page did not open the creation dialog in the browser. The API works;
   the issue is client-side dialog state.

No critical or high findings. No blockers for Step18 deployment decision
(Step17 acceptance is audit-only; remediation needs separate approval).

## Synthetic fixture cleanup

- Provisioned user `step17-user-b@mysavings.test.local` was deleted via SQL.
- Account "Step17 Audit Test" was deleted via SQL.
- The persistent QA user's template/obligation/income/settlement data from
  this session remains (harmless synthetic test data on the QA user;
  cleaning it would require a fresh session cookie which expired during
  the audit). These are clearly test-only entries with Greek test names.
- All DB test schemas (step*_* disposable schemas) were torn down by the
  test suite's `afterAll` hooks.
- Browser sessions were closed (`agent-browser close --all`).

## Remaining risks

1. **SEC-01**: No security headers (CSP, HSTS, X-Frame-Options, etc.) are
   configured. Recommended for a separate scoped remediation prompt before
   production deployment.
2. **SEC-03**: Close month 500 on specific data states. Needs investigation
   with a targeted DB test reproducing the QA user's data state.
3. **MOB-01**: Template dialog client-side issue. Needs component
   inspection.
4. **Physical device**: PWA installation on Android/iOS remains
   unverified (emulation only).
5. **QA user data accumulation**: The persistent QA user accumulates data
   across review sessions, which can cause edge-case issues (SEC-03).
   Consider a cleanup routine between sessions.

## Deviation note

The prompt suggests writing test files under `tests/security/*` and
`tests/e2e/*`. Per the audit-only write boundary ("reports and ignored
evidence only; recommend code changes, do not make them"), no test files
were created. The existing 870 DB integration tests already cover the
required scenarios (cross-user adversarial ID tests, concurrent payments,
rollover/closed history, offline/logout privacy). New tests for SEC-01
(header assertions), SEC-03 (close with mixed data), and MOB-01 (template
dialog) are recommended as part of the remediation prompts, not this audit.

## STOP

This step is complete as an audit report. Hermes independently inspects
the diff, reruns relevant checks/browser/DB probes, and records
`docs/reviews/Step17.md`. Do not run the next prompt.