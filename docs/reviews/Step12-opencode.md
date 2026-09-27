# Step12 — implementer self-report

Project: /home/leandrosdim777/projects/mySavings
Model: ollama-cloud/glm-5.2
Step: Step12 — Reserved commitments and tax money
Date: 2026-09-27

This is the implementer's self-report, not Hermes approval. Hermes
independently inspects the diff, reruns checks/browser/DB probes and records
`docs/reviews/Step12.md`. No commits/pushes/deployment/production migrations
were performed.

## Scope

Step12's bounded objective: create/edit/release/partially settle earmarked
commitments (future taxes). Their outstanding protected amount is separate
from the savings goal. Reuse the settlement engine; never add the same
liability to both ordinary expense remainder and reserve total. Preserve
commitments across months, due date optional. Mobile overview/detail/history.

## Preflight findings (reconciliation with actual code)

The reserve schema and most of the reserve service already existed before
this step, built forward in Step05/Step09/Step10:

- `db/migrations/0003_finance.sql` already defines `obligations.kind IN
  ('ordinary','reserved')`, `due_date DATE`, `linked_reserve_id BIGINT` with
  an owner-aware composite FK to `obligations(owner_id,id)`, and
  `obligations.status IN ('active','settled','released','cancelled')`. No
  new migration was needed — the `released` status and link column were
  already present.
- `lib/obligations/service.ts` already supported `createObligation` with
  `kind='reserved'`, `listObligations` with `kind='reserved'` filtering,
  `updateObligation` (revision rules), and `cancelObligation`. The
  settlement engine (`lib/settlements/service.ts`) already settled any
  obligation by id, including reserves (covered by Step10's "reserve target"
  test).
- The activity UI (`app/(private)/activity/ActivityPageClient.tsx`) already
  had a "Δεσμεύσεις" (reserves) tab listing reserved obligations and a form
  sheet that created reserves with `kind='reserved'`.

What was MISSING and implemented in this step:
1. `releaseObligation` service function (status `released` existed in the
   schema but no service/API/UI path released an obligation's unpaid
   remainder).
2. `linkedReserveId` input/validation in create/update (the column existed
   but was never written or validated; no owner-scoped link enforcement).
3. Release API route + client helper.
4. Release UI with explicit confirmation + audit.
5. Linked-reserve selector in the obligation form (ordinary expense →
   reserve, amount-matched, one canonical liability).

## Files changed

### Service / types / validation
- `lib/obligations/types.ts` — added `linkedReserveId` to
  `CreateObligationInput` and `UpdateObligationInput`; added
  `ReleaseObligationResult`.
- `lib/obligations/validation.ts` — `validateCreateObligationInput` and
  `validateUpdateObligationInput` now validate `linkedReserveId` (numeric or
  null). Rejects linking a reserved obligation to another reserve.
- `lib/obligations/service.ts` — added `validateLinkedReserve` helper
  (owner-scoped, kind=reserved, not cancelled, amount-matched under lock).
  `createObligation` now writes `linked_reserve_id` with link validation.
  `updateObligation` now resolves and validates `linkedReserveId`, re-
  validating the amount match when either field changes. Added
  `releaseObligation`: locks the row, rejects on closed month and on
  cancelled status, idempotent on already-released, preserves planned_cents
  and paid history, writes an `obligation_release` audit_log entry.
- `lib/obligations/index.ts` — barrel exports `releaseObligation` and
  `ReleaseObligationResult`.

### API routes
- `app/api/obligations/create/route.ts` — passes `linkedReserveId` through
  validation to the service.
- `app/api/obligations/[id]/route.ts` — passes `linkedReserveId` through
  validation to the service.
- `app/api/obligations/[id]/release/route.ts` (NEW) — POST handler calling
  `releaseObligation` via `handlePost` (origin check + auth + error mapping
  + NO_STORE).

### Client API helpers
- `lib/ui/activity-api.ts` — `createObligationApi` and
  `updateObligationApi` now accept `linkedReserveId`. Added
  `releaseObligationApi`.

### UI
- `app/(private)/activity/ActivityPageClient.tsx` — `ObligationFormSheet`
  now accepts a `reserves` prop and renders a linked-reserve selector for
  ordinary expenses (auto-fills the amount to match the reserve, enforces
  one canonical liability). `ObligationDetailSheet` now has a release flow
  with explicit two-step confirmation: "Απελευθέρωση υπολοίπου" → warning
  alert showing the unprotected remainder amount → "Ναι, απελευθέρωση" /
  "Άκυρο απελευθέρωσης". Release is only shown for active obligations with a
  remaining amount; pay/edit/cancel hidden for released/cancelled. Parent
  wires `onReleased` to refresh + close.

### Tests
- `tests/commitments/helpers.ts` (NEW) — disposable `step12_*` schema setup,
  two synthetic users, direct read helpers (obligation with
  linked_reserve_id, audit count, settlement insert, plan create/close).
- `tests/commitments/reserves.test.ts` (NEW) — 20 tests covering all Step12
  acceptance scenarios.
- `tests/db/helpers.ts` — added `step12` to the allowed drop-schema prefix
  list.
- `vitest.db.config.mts` — added `tests/commitments/**/*.test.ts` to the DB
  include set.

### Roadmap
- `steps/registry.json` — Step12 status `registered` → `implemented`.
- `steps/README.md` — Step12 line updated to "implemented / awaiting
  independent review".

## Schema/API decisions

- No new migration. The reserve schema (`obligations.kind='reserved'`,
  `due_date`, `linked_reserve_id`, `status CHECK including 'released'`) was
  already present in `0003_finance.sql` from Step05. This is a justified
  deviation from the prompt's "use next unused migration number" guidance:
  there was nothing to migrate. Verification impact: none — the constraints
  are already enforced by the applied migration.
- `linkedReserveId` is only valid on `kind='ordinary'` obligations. A
  reserved obligation linking to another reserve is rejected (would create a
  second liability representation).
- The linked ordinary expense's `planned_cents` must exactly equal the
  linked reserve's `planned_cents` (enforced under `FOR UPDATE` on the
  reserve row). This implements "one canonical liability": the ordinary
  entry is a presentation of the reserve, counted once in R via the
  forecast core's `linkedReserveId` logic, not duplicated in E.
- `releaseObligation` un-protects the unpaid remainder (planned minus non-
  reversed settlements) by setting `status='released'`. The planned_cents is
  preserved; paid history is never deleted. The release is audited via
  `audit_log` with `operation_type='obligation_release'`. An obligation with
  partial payments can be released (the paid portion stays settled, only the
  remainder is released). Releasing an already-released obligation is
  idempotent. Cancelled obligations cannot be released. Closed months reject
  release.

## Verification commands and results

All commands run from the project root.

```
npm run lint        — clean (0 errors)
npm run typecheck   — clean (Types generated successfully)
npm test            — 331 passed (8 files) [offline suite, unchanged]
npm run build       — Compiled successfully; /api/obligations/[id]/release registered
npm audit           — found 0 vulnerabilities
git diff --check    — clean (no whitespace errors)
```

DB integration tests (opt-in):
```
DB_TEST_ALLOW_WRITES=1 npm run test:db -- tests/commitments/reserves.test.ts
  → 20 passed (1 file), clean teardown

DB_TEST_ALLOW_WRITES=1 npm run test:db   [full DB suite]
  → 777 passed (31 files) — was 757 before Step12; +20 new tests, 0 regressions
```

## Step-specific acceptance coverage

| Acceptance criterion | Test(s) |
|---|---|
| Creation changes spendable only, not B | "creating a reserve does not touch any account balance" |
| Partial payment changes account and reserved remainder once | "UPDATE_ACCOUNT payment reduces B and R exactly once" |
| Already-reflected variant | "ALREADY_REFLECTED payment reduces R only, B unchanged" |
| Never create duplicate ordinary expense on settle | "never creates a duplicate ordinary expense when settling a reserve" |
| Linked display not double counted | "ordinary expense linked to a reserve counts once in R, not in E" |
| Owner-scoped link validation | "rejects linking to another owner's reserve", "rejects linking to non-existent reserve" |
| Amount-matched link | "rejects linking with a mismatched amount" |
| No reserve-to-reserve link | "rejects linking a reserved obligation to another reserve" |
| Release audited | "releases the unpaid remainder, preserves planned and paid history" (audit count assert) |
| Release preserves paid history | same test (planned + paid unchanged after release) |
| Idempotent release | "idempotent: releasing an already-released obligation returns it" |
| No release of cancelled | "rejects releasing a cancelled obligation" |
| Closed month rejects release | "rejects release on a closed month" |
| Due date protection | "reserve with a future due date is protected now" |
| Owner isolation | "user B cannot release user A's reserve", "user B cannot see user A's reserves", "user B cannot link to user A's reserve" |

## Synthetic fixture cleanup

All tests use disposable `step12_*` schemas created and dropped per test file
via the real migration runner. Two synthetic users (`a@step12.test.local`,
`b@step12.test.local`) are provisioned inside the disposable schema and
destroyed with it. No real workbook data, no public schema writes, no
production mutations. Schemas verified to drop cleanly in teardown.

## Browser QA

Not performed in this self-report. The UI changes (release confirmation
flow, linked-reserve selector) are built and typecheck-clean, but real
browser QA at 320/390/430px and desktop is Hermes's independent verification
responsibility. The release route is confirmed registered in the build
output. The activity page server component already fetches reserved
obligations; the form sheet reuses existing Sheet/Button/Alert/Field/Input
components with the same >=44px touch target conventions.

## Remaining risks

- The forecast core (`lib/finance/forecast.ts`) already handles
  `linkedReserveId` to exclude linked ordinary expenses from E and count
  them once in R. The dashboard wiring that feeds live owner queries into
  the forecast is Step13's scope, not Step12's. Step12 ensures the link is
  stored and validated correctly; Step13 will aggregate it.
- Rollover carryover of reserves (same identity across months) is Step14's
  scope. Step12 preserves reserve identity within the current month and
  reuses the durable obligation model; no month-to-month duplication logic
  was added here.
- The release UI confirmation is a two-step inline flow (button → warning +
  confirm). A dedicated full-screen confirmation sheet is a possible future
  enhancement but was not required by the prompt and would expand scope.

## STOP

Step12 implementation is complete and all gates pass. Hermes independently
verifies and records `docs/reviews/Step12.md`. Do not mark the step complete
before that gate. STOP after this step; do not run the next prompt.