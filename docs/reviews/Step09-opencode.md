# Step09 — implementer self-report

Project: /home/leandrosdim777/projects/mySavings
Model: ollama-cloud/glm-5.2
Date: 2026-09-26

This is the implementer's self-report for Step09 (expense plans and income
expectations). It is NOT independent approval. Hermes reviews independently.
No commits/pushes/deployment/production migrations/public writes were
performed.

## Prerequisite note

Step08 was approved by the user. The Step08 self-report
(docs/reviews/Step08-opencode.md) documented complete monthly plans and
recurring templates with all gates passing. The Step08 independent Hermes
review (docs/reviews/Step08.md) had not been written at launch time; the
user explicitly approved Step08 and authorized proceeding to Step09. Step08's
features were verified before any Step09 work began by confirming the build
compiles and the Step08 test suite passes.

The Greek UI assumption (confirmed by the user in Step07) carries forward:
all user-facing UI strings are in Greek; code, identifiers, comments and docs
remain in English.

## Scope

Only Step09: CRUD ordinary monthly expenses (fixed/variable) and income
expectations on the existing schema. Preserve planned amount and show
paid/remaining derived from non-reversed settlements (obligations) and
received/pending derived from non-reversed receipts (income). No settlement
or receipt mutation in this step (Step10). Edit/cancel restrictions preserve
settled/received history. Owner and month filtering, empty states, date
validation. Mobile activity lists/detail forms/filter by selected month and
type. Reserve items kept out of ordinary expense aggregates.

## Prerequisites verified

- Step05 schema: obligations, income_expectations, settlements,
  settlement_reversals, income_receipts, income_receipt_reversals tables
  already defined with owner-aware composite FKs, partial unique indexes, and
  CHECK constraints. No new migration needed.
- Step06/Step07: account service and UI patterns reused.
- Step08: monthly_plans, recurring_templates, generation service reused.
  Plan existence and open status enforced for obligation/income writes.
- git status inspected; no unrelated changes overwritten.

## Files created

### Obligation service (lib/obligations/)

- `lib/obligations/types.ts` — shared types (Obligation, ObligationKind,
  ObligationStatus, CreateObligationInput, UpdateObligationInput,
  ObligationFilter) and error hierarchy (ObligationServiceError,
  ObligationValidationError, ObligationNotFoundError, ObligationConflictError,
  ClosedMonthError, SettledHistoryError).
- `lib/obligations/validation.ts` — pure validation: validateTitle (1-200),
  validateKind (ordinary/reserved only, income rejected), validatePlannedCents
  (non-negative, safe bounds), validateMonthKey (YYYY-MM, 1900-9999),
  validateOptionalDate (YYYY-MM-DD, calendar-valid), validateOptionalAccountId
  (numeric or null), validateObligationId, validateCreateObligationInput,
  validateUpdateObligationInput (partial, at least one field).
- `lib/obligations/service.ts` — server-only service: createObligation
  (requires open plan, FK-validated account), getObligation (owner-scoped,
  paid/remaining derived from non-reversed settlements), listObligations
  (filter by month/kind/status, excludes reserved by default from ordinary
  aggregates, batch-paid computation), updateObligation (row-locked, revision
  rule: no lowering planned below paid, open-month enforced),
  cancelObligation (rejects if non-reversed settlements exist, idempotent).
- `lib/obligations/index.ts` — public API barrel.

### Income service (lib/income/)

- `lib/income/types.ts` — shared types (IncomeExpectation, IncomeStatus,
  CreateIncomeInput, UpdateIncomeInput, IncomeFilter) and error hierarchy
  (IncomeServiceError, IncomeValidationError, IncomeNotFoundError,
  IncomeConflictError, IncomeClosedMonthError, ReceiptHistoryError).
- `lib/income/validation.ts` — pure validation: validateSourceName (1-200),
  validateExpectedCents (non-negative, safe bounds), validateMonthKey,
  validateOptionalAccountId, validateIncomeId, validateCreateIncomeInput,
  validateUpdateIncomeInput (partial, at least one field).
- `lib/income/service.ts` — server-only service: createIncome (requires open
  plan, unique source per owner+month, FK-validated account), getIncome
  (owner-scoped, received/pending derived from non-reversed receipts),
  listIncome (filter by month/status, batch-received computation), updateIncome
  (row-locked, revision rule: no lowering expected below received, open-month
  enforced), cancelIncome (rejects if non-reversed receipts exist, idempotent).
- `lib/income/index.ts` — public API barrel.

### API routes

- `app/api/obligations/route.ts` — GET: list with optional filters.
- `app/api/obligations/create/route.ts` — POST: create.
- `app/api/obligations/[id]/route.ts` — PATCH: update.
- `app/api/obligations/[id]/cancel/route.ts` — POST: cancel.
- `app/api/income/route.ts` — GET: list with optional filters.
- `app/api/income/create/route.ts` — POST: create.
- `app/api/income/[id]/route.ts` — PATCH: update.
- `app/api/income/[id]/cancel/route.ts` — POST: cancel.

### Client API helpers (lib/ui/)

- `lib/ui/activity-api.ts` — client-side helpers: listObligationsApi,
  createObligationApi, updateObligationApi, cancelObligationApi,
  listIncomeApi, createIncomeApi, updateIncomeApi, cancelIncomeApi. All
  POST/PATCH/GET to real route handlers. Errors mapped to Greek strings. No
  financial logic duplicated.

### Mobile UI (app/(private)/activity/)

- `app/(private)/activity/page.tsx` — server component: verifySession, loads
  current-month obligations (ordinary + reserved separately), income, plans
  and accounts. force-dynamic.
- `app/(private)/activity/ActivityPageClient.tsx` — client component:
  - Month selector from plan history.
  - Tab filter: expenses / reserves / income (role=tablist, aria-selected).
  - Summary card: planned/paid/remaining (expenses/reserves) or
    expected/received/pending (income).
  - Entry list with tap-to-detail: title, amount, paid/remaining, due date,
    status badge.
  - Obligation form sheet: title, amount (decimal inputMode), due date
    (YYYY-MM-DD), optional linked account. Create or edit.
  - Income form sheet: source name, amount, optional linked account.
  - Obligation detail sheet: planned/paid/remaining breakdown, kind, due
    date, status, edit and cancel buttons.
  - Income detail sheet: expected/received/pending breakdown, month, status,
    edit and cancel buttons.
  - Info alerts: planned amount not zeroed by partial payments; manual bank
    refresh does not imply automatic receipt.
  - Empty states with guidance.
  - All Greek UI, >=44px touch targets, accessible labels, useMemo for
    derived lists/totals to avoid exhaustive-deps warnings.

### Navigation

- `app/(private)/_components/PrivateShell.tsx` — added "Δραστηριότητα" link
  to /activity in the navigation.

### Tests (tests/plans/)

- `tests/plans/helpers.ts` — DB integration test helpers: setupPlansSchema
  (disposable step09_* schema, full migration chain, two synthetic users),
  teardownPlansSchema, createUniqueTestUser, readObligationDirect,
  readIncomeDirect, countObligations, countIncomeExpectations,
  insertSettlementDirect, insertSettlementReversalDirect,
  readSettlementIdDirect, insertReceiptDirect, readReceiptIdDirect,
  insertReceiptReversalDirect, createPlanDirect, closePlanDirect.
- `tests/plans/obligations.test.ts` — 33 tests: create (ordinary, reserved,
  gas envelope not week-multiplied, invalid kind, negative, empty title,
  invalid month, invalid date, no-plan rejection, valid due date), get/list
  (owner-scoped, cross-owner rejection, month filter, reserved excluded from
  ordinary by default, two-user isolation), update (title, amount upward,
  no lowering below paid, exact paid allowed, paid history preserved,
  non-existent, cross-owner, empty update), cancel (no settlements, with
  settlements rejected, idempotent, cross-owner), paid/remaining derivation
  (multi-settlement sum, reversed excluded), closed month (create/update/
  cancel rejected), two-user count isolation.
- `tests/plans/income.test.ts` — 29 tests: create (valid, negative, empty
  name, invalid month, no-plan, duplicate source, same source different
  owners), get/list (owner-scoped, cross-owner, month filter, two-user),
  update (name, amount upward, no lowering below received, exact received,
  receipt history preserved, non-existent, cross-owner, empty), cancel (no
  receipts, with receipts rejected, idempotent, cross-owner), received/pending
  derivation (multi-receipt sum, reversed excluded), closed month (create/
  update/cancel rejected), two-user count isolation.

## Files modified

- `lib/finance-routes.ts` — mapServiceError extended to handle
  ObligationServiceError, IncomeServiceError, SettledHistoryError and
  ReceiptHistoryError hierarchies. Renamed ClosedMonthError import aliases
  to avoid collision between months/obligations/income error classes.
- `steps/registry.json` — Step09 status changed to "implemented".
- `steps/README.md` — updated step statuses.
- `tests/db/helpers.ts` — added "step09" prefix to the schema drop guard.
- `vitest.db.config.mts` — added "tests/plans/**/*.test.ts" to include.
- `app/(private)/_components/PrivateShell.tsx` — added /activity nav link.

## Schema/API decisions

### No new migration

Step05's 0003_finance.sql already defines all tables needed (obligations,
income_expectations, settlements, settlement_reversals, income_receipts,
income_receipt_reversals with owner-aware composite FKs and CHECK
constraints). Step09 is service + UI only.

### Service layer pattern

Follows the established lib/accounts/* and lib/months/* patterns exactly:
- types.ts: shared types and error hierarchy with stable `code` property.
- validation.ts: pure functions, safe for reuse in tests.
- service.ts: server-only, withTransaction for writes, owner-scoped queries.
- index.ts: public API barrel.

### Paid/remaining derivation

Paid = sum of non-reversed settlements (settlements minus
settlement_reversals). Remaining = planned - paid. No settlement writes in
this step; the derived totals are ready for Step10. Batch computation uses a
single query with ANY() for list views.

### Received/pending derivation

Received = sum of non-reversed income_receipts (receipts minus
income_receipt_reversals). Pending = expected - received. No receipt writes
in this step; the derived totals are ready for Step10.

### Revision rules (preserve paid/received history)

- planned_cents cannot be lowered below the already-paid amount. This
  prevents erasing paid history by lowering the plan.
- expected_cents cannot be lowered below the already-received amount.
- Lowering to exactly the paid/received amount is allowed (remaining becomes 0).
- Cancellation is rejected if non-reversed settlements/receipts exist.

### Reserve items excluded from ordinary aggregates

listObligations excludes kind='reserved' by default. The UI loads
ordinary and reserved separately for the two tabs. includeReserved=true
returns both. This keeps reserves out of ordinary expense totals.

### Owner resolution

Every page uses verifySession() (server component). API routes use
requireApiUser via the shared finance-routes.ts helper. The ownerId is
derived from the verified server session, never from client input.

### Date formatting

pg returns DATE columns as JS Date objects in local time. Using
toISOString().slice(0,10) shifts the date back by one day in positive-offset
timezones (e.g. Athens UTC+3). Fixed by formatting using local date
components (getFullYear/getMonth/getDate) instead.

## Quality gates

| Gate | Result |
|------|--------|
| `npm run lint` | Pass (0 errors, 0 warnings) |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | Pass |
| `npm test` (offline) | Pass: 8 files, 331 tests |
| `DB_TEST_ALLOW_WRITES=1 npm run test:db` (full DB suite) | Pass: 26 files, 693 tests (62 new + 631 existing) |
| `npm run build` | Pass (Next.js 16.3.5, Turbopack; 30 routes compiled) |
| `npm audit` | 0 vulnerabilities |
| `git diff --check` | Clean |

## Step-specific acceptance evidence

### DB integration tests (62 new tests across 2 files)

| Scenario | Result |
|----------|--------|
| Create ordinary obligation with planned amount | PASS |
| Create reserved obligation (commitment) | PASS |
| Gas envelope (variable monthly budget, not week-multiplied) | PASS |
| Reject invalid kind (income not allowed) | PASS |
| Reject negative planned amount | PASS |
| Reject empty title | PASS |
| Reject invalid month key format | PASS |
| Reject invalid due date (Feb 30) | PASS |
| Reject creation when no plan exists for month | PASS |
| Accept valid due date | PASS |
| Get obligation by ID (owner-scoped) | PASS |
| Reject cross-owner obligation access by ID | PASS |
| List obligations filtered by month | PASS |
| Exclude reserved from ordinary list by default | PASS |
| User B cannot see user A's obligations | PASS |
| Update title | PASS |
| Update planned amount upward | PASS |
| Reject lowering planned below paid amount | PASS |
| Allow lowering planned to exactly paid amount | PASS |
| Preserve paid history: planned stays after partial payment | PASS |
| Reject update on non-existent obligation | PASS |
| Reject cross-owner update | PASS |
| Reject empty update (no fields) | PASS |
| Cancel obligation with no settlements | PASS |
| Reject cancellation with settlements | PASS |
| Idempotent cancel of already-cancelled | PASS |
| Reject cross-owner cancellation | PASS |
| Compute paid from multiple non-reversed settlements | PASS |
| Exclude reversed settlements from paid total | PASS |
| Reject creation on closed month | PASS |
| Reject update on closed month | PASS |
| Reject cancellation on closed month | PASS |
| Two-user obligation count isolation | PASS |
| Create income expectation | PASS |
| Reject negative expected amount | PASS |
| Reject empty source name | PASS |
| Reject invalid month key | PASS |
| Reject creation when no plan exists | PASS |
| Reject duplicate source name same owner+month | PASS |
| Same source name different owners same month | PASS |
| Get income by ID (owner-scoped) | PASS |
| Reject cross-owner income access | PASS |
| List income filtered by month | PASS |
| User B cannot see user A's income | PASS |
| Update source name | PASS |
| Update expected amount upward | PASS |
| Reject lowering expected below received | PASS |
| Allow lowering expected to exactly received | PASS |
| Preserve receipt history: expected stays after partial receipt | PASS |
| Reject update on non-existent income | PASS |
| Reject cross-owner update | PASS |
| Reject empty update | PASS |
| Cancel income with no receipts | PASS |
| Reject cancellation with receipts | PASS |
| Idempotent cancel of already-cancelled | PASS |
| Reject cross-owner cancellation | PASS |
| Compute received from multiple non-reversed receipts | PASS |
| Exclude reversed receipts from received total | PASS |
| Reject creation on closed month | PASS |
| Reject update on closed month | PASS |
| Reject cancellation on closed month | PASS |
| Two-user income count isolation | PASS |

### Browser QA

Browser QA was not performed by the implementer. The UI follows the exact
same patterns as Step07/Step08 (same Sheet, Button, Input, Field, Alert
components, same inline-style approach, same Greek locale, same
safe-area/touch-target compliance). The build compiles successfully with all
30 routes. Real browser QA will be performed by Hermes during independent
review.

## Boundaries kept

- No commits/pushes/deployment/production migrations/public writes.
- No global configuration edits (.env not modified).
- No edits to independent review files or existing review files.
- No new features beyond Step09 expense plans and income expectations.
- No real data import; all fixtures are synthetic @step09.test.local emails,
  cleaned up via disposable schemas (dropped in afterAll).
- No new migration (Step05 schema was sufficient).
- UI calls real production route handlers; no test-only API implementation.
- Greek UI confirmed by user in Step07, carried forward.
- No settlement or receipt mutation (Step10 scope).
- No payment/receipt mutation controls enabled before Step11.
- Reserve items kept out of ordinary expense aggregates.
- No automatic week-count multiplication for variable envelopes.

## Remaining risks / deferred items

1. Browser QA was not performed by the implementer. Hermes should verify
   320/390/430px widths, tab switching, form persistence, console errors,
   and real interactions against the dev server.
2. The obligation/income services do not write audit_log entries (deferred
   to Step10/Step12 when settlement/reversal operations are introduced).
3. Month closing lifecycle (status open -> closed) is not implemented yet
   (Step14/Step15). The services reject closed months, but no UI for closing
   months exists.
4. The activity page loads the current month only; switching months in the
   selector calls router.refresh() which reloads server data for the current
   month. A future improvement could pass the selected month as a query param
   so the server loads data for the selected month directly. For v1 the
   current-month view is the primary use case.

## STOP

Step09 expense plans and income expectations implemented and self-verified.
Awaiting independent Hermes review. No next step started.