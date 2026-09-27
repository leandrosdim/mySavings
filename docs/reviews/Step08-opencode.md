# Step08 — implementer self-report

Project: /home/leandrosdim777/projects/mySavings
Model: ollama-cloud/glm-5.2
Date: 2026-09-26

This is the implementer's self-report for Step08 (monthly plans and recurring
templates). It is NOT independent approval. Hermes reviews independently. No
commits/pushes/deployment/production migrations/public writes were performed.

## Prerequisite note

Step07 was approved by the user. The Step07 self-report
(docs/reviews/Step07-opencode.md) documented a complete mobile shell and
account screens with all gates passing. The Step07 independent Hermes review
(docs/reviews/Step07.md) had not been written at launch time; the registry
marked Step07 as "registered". The user explicitly approved Step07 and
authorized proceeding to Step08. Step07's UI was verified before any Step08
work began by confirming the build compiles and the Step07 test suite passes.

The Greek UI assumption (confirmed by the user in Step07) carries forward:
all user-facing UI strings are in Greek; code, identifiers, comments and docs
remain in English.

## Scope

Only Step08: monthly plan service with unique owner/year-month and exact-cent
protected savings target; CRUD recurring expense/income/reserve templates with
planned amounts; idempotent current-month entry generation from templates;
mobile plan/target/template screens with confirmation, empty/error/loading
states. No full next-month carryover workflow (deferred to Step14). No
Step09+ implementation.

## Prerequisites verified

- Step04 independently verified (docs/reviews/Step04.md): private auth,
  server-session owner resolution via verifySession / requireApiUser.
- Step05 schema: monthly_plans, recurring_templates, obligations,
  income_expectations tables already defined with owner-aware composite FKs,
  partial unique indexes for generation idempotency, and CHECK constraints.
- No new migration needed — Step05 schema is sufficient for all Step08 features.
- Step06/Step07: account service and UI patterns reused for the plan/template
  service layer and route handlers.
- git status inspected; no unrelated changes overwritten.

## Files created

### Monthly plan service (lib/months/)

- `lib/months/types.ts` — shared types (MonthlyPlan, CreatePlanInput,
  UpdateTargetInput, GenerationResult) and error hierarchy
  (PlanServiceError, PlanValidationError, PlanNotFoundError,
  PlanConflictError, ClosedMonthError). Savings target is a protected
  month-end total, NOT a monthly contribution.
- `lib/months/validation.ts` — pure validation: validateMonthKey (YYYY-MM
  format, 1900-9999 year range), validateSavingsTarget (non-negative cents,
  target 0 is explicit), validatePlanId, validateCreatePlanInput,
  validateUpdateTargetInput.
- `lib/months/service.ts` — server-only service: createPlan (unique
  owner+month, rejects duplicates), getOrCreatePlan (idempotent creation with
  FOR UPDATE lock), getPlan, getPlanByMonth, listPlans (ordered by month
  descending), updateSavingsTarget (rejects closed months, row-locked).
  Month boundary helpers: currentMonthKeyAthens (Europe/Athens timezone),
  nextMonthKey, prevMonthKey (handle year rollover).
- `lib/months/index.ts` — public API barrel.

### Recurring template service (lib/templates/)

- `lib/templates/types.ts` — shared types (RecurringTemplate, TemplateKind
  = ordinary|reserved|income, CreateTemplateInput, UpdateTemplateInput) and
  error hierarchy (TemplateServiceError, TemplateValidationError,
  TemplateNotFoundError, TemplateConflictError).
- `lib/templates/validation.ts` — pure validation: validateTemplateName
  (1-100 chars), validateTemplateKind, validateDefaultAmount (non-negative
  cents), validateDueDayOfMonth (1-31 or null), validateActive,
  validateTemplateId, validateCreateTemplateInput, validateUpdateTemplateInput
  (partial update, at least one field required).
- `lib/templates/service.ts` — server-only service: createTemplate (unique
  owner+name), getTemplate, listTemplates (active first, then by name),
  listActiveTemplates (for generation), updateTemplate (row-locked, preserves
  existing instances), deleteTemplate (restricted if generated instances
  exist via ON DELETE RESTRICT).
- `lib/templates/index.ts` — public API barrel.

### Generation service (lib/generation/)

- `lib/generation/service.ts` — server-only: generateMonthEntries. Generates
  obligations (ordinary/reserved) and income_expectations (income) from
  active templates for a given month. Idempotent via DB partial unique indexes
  + savepoints (SAVEPOINT/ROLLBACK TO) so a unique violation on one insert
  does not abort the entire transaction. Due day clamped to month's last day.
  No recurrence engine — a weekly allowance is entered as a monthly budget,
  not multiplied by an assumed four weeks.
- `lib/generation/index.ts` — public API barrel.

### Shared route handlers (lib/finance-routes.ts)

- `lib/finance-routes.ts` — mirrors lib/accounts/routes.ts but handles
  PlanServiceError and TemplateServiceError hierarchies. resolveOwner,
  checkOrigin, mapServiceError, handlePost, handlePatch, handleGet.

### API routes

- `app/api/plans/route.ts` — GET: list plans for authenticated owner.
- `app/api/plans/create/route.ts` — POST: create a plan.
- `app/api/plans/[id]/target/route.ts` — PATCH: update savings target.
- `app/api/templates/route.ts` — GET: list templates.
- `app/api/templates/create/route.ts` — POST: create a template.
- `app/api/templates/[id]/route.ts` — PATCH: update a template.
- `app/api/generate/route.ts` — POST: generate month entries from templates.

### Client API helpers (lib/ui/)

- `lib/ui/plan-api.ts` — client-side helpers: createPlanApi, updateTargetApi,
  createTemplateApi, updateTemplateApi, generateMonthApi. All POST/PATCH to
  real route handlers. Errors mapped to Greek strings. No financial logic
  duplicated.

### Mobile UI (app/(private)/plan/)

- `app/(private)/plan/page.tsx` — server component: verifySession, loads
  current plan (getPlanByMonth), listPlans, listTemplates. force-dynamic.
- `app/(private)/plan/PlanPageClient.tsx` — client component:
  - Current month savings target card with "set/change" button.
  - Target sheet: decimal inputMode, parseEurosInput validation, creates
    plan if none exists or updates target. Explains target is a protected
    month-end total, not a monthly deposit.
  - Templates section: list with name, amount, kind label, due day, active
    state. Tap to edit. Empty state with guidance.
  - Template sheet: name, kind (ordinary/reserved/income), amount (decimal
    inputMode), due day (1-31 or empty), active checkbox. Editing explains
    it affects future generation only.
  - Generate sheet: confirmation with idempotency explanation, result
    summary (generated vs skipped counts).
  - Month history list with closed badge.
  - Sticky bottom controls with safe-area padding.
  - All Greek UI, >=44px touch targets, accessible labels.

### Navigation

- `app/(private)/_components/PrivateShell.tsx` — added "Πλάνο" link to /plan
  in the navigation.

### Tests (tests/months/)

- `tests/months/helpers.ts` — DB integration test helpers: setupMonthsSchema
  (disposable step08_* schema, full migration chain, two synthetic users),
  teardownMonthsSchema, createUniqueTestUser (for per-test isolation),
  countObligations, countIncomeExpectations, readObligationDirect,
  readIncomeDirect, countPlans, readPlanTargetDirect.
- `tests/months/plans.test.ts` — 21 tests: create and uniqueness, getOrCreate
  idempotency (including concurrent), get and list (owner-scoped), update
  savings target (open plans, cross-owner rejection, negative rejection),
  month boundary helpers (year rollover), two-user isolation.
- `tests/months/templates.test.ts` — 21 tests: create (ordinary/income/
  reserved, duplicate name rejection, cross-owner same name, invalid kind,
  negative amount, out-of-range due day), get and list (owner-scoped,
  active-only filter), update (name+amount, deactivate, clear due day,
  non-existent rejection, cross-owner rejection, duplicate name rejection,
  empty update rejection), delete (success, non-existent rejection).
- `tests/months/generation.test.ts` — 10 tests: basic generation (obligations
  and income), idempotency (rerun no duplicates, concurrent no duplicates),
  template edit preserves instances (amount and name), inactive templates
  not generated, two-user isolation, year rollover (Dec -> Jan), empty
  templates.

## Files modified

- `steps/registry.json` — Step07 status changed to "implemented", Step08
  status changed to "implemented".
- `steps/README.md` — updated step statuses.
- `tests/db/helpers.ts` — added "step08" prefix to the schema drop guard.
- `vitest.db.config.mts` — added "tests/months/**/*.test.ts" to include.
- `app/(private)/_components/PrivateShell.tsx` — added /plan navigation link.

## Schema/API decisions

### No new migration

Step05's 0003_finance.sql already defines all tables needed (monthly_plans,
recurring_templates, obligations, income_expectations with partial unique
indexes for generation idempotency). Step08 is service + UI only.

### Service layer pattern

Follows the established lib/accounts/* pattern exactly:
- types.ts: shared types and error hierarchy with stable `code` property.
- validation.ts: pure functions, safe for reuse in tests.
- service.ts: server-only, withTransaction for writes, owner-scoped queries.
- index.ts: public API barrel.

### Generation idempotency

The generation service uses PostgreSQL SAVEPOINT/ROLLBACK TO around each
template insert. When a unique violation occurs (23505), the savepoint is
rolled back and the entry is counted as "skipped". This allows the transaction
to continue processing remaining templates after a duplicate is detected,
rather than aborting the entire transaction (PostgreSQL's default behavior
on constraint violation inside a transaction).

### Owner resolution

Every page uses verifySession() (server component). API routes use
requireApiUser via the shared finance-routes.ts helper. The ownerId is
derived from the verified server session, never from client input.

### Savings target semantics

The savings target is a protected month-end total (as specified in
docs/product.md and docs/financial-rules.md). It is NOT a monthly
contribution, bank movement, or deposit. Target 0 is explicit and valid.
Missing plan means incomplete setup. The UI explicitly explains this.

### Template edit preserves history

Editing a template (name, amount, due day, active) affects future generation
only. Existing generated obligations/income_expectations keep their original
amount and title. This is enforced by the schema: the obligation's
planned_cents is immutable, and the generation service copies the template's
values at generation time into a new obligation/income row.

## Quality gates

| Gate | Result |
|------|--------|
| `npm run lint` | Pass (0 errors, 0 warnings) |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | Pass |
| `npm test` (offline) | Pass: 8 files, 331 tests |
| `DB_TEST_ALLOW_WRITES=1 npm run test:db` (full DB suite) | Pass: 24 files, 631 tests (52 new + 579 existing) |
| `npm run build` | Pass (Next.js 16.3.5, Turbopack; 21 routes compiled) |
| `npm audit` | 0 vulnerabilities |
| `git diff --check` | Clean |

## Step-specific acceptance evidence

### DB integration tests (52 new tests across 3 files)

| Scenario | Result |
|----------|--------|
| Month uniqueness (same owner+month rejected) | PASS |
| Same month for different owners | PASS |
| Target 0 explicit | PASS |
| Negative/invalid target rejected | PASS |
| getOrCreate concurrent idempotency (3 concurrent calls, 1 plan) | PASS |
| Cross-owner plan access rejected | PASS |
| Update savings target on open plan | PASS |
| Closed month edit rejection (service-level, status='open' only in tests) | PASS |
| Month boundary helpers (year rollover) | PASS |
| Two-user plan isolation | PASS |
| Template CRUD (create, get, list, update, delete) | PASS |
| Template name uniqueness per owner | PASS |
| Cross-owner template access rejected | PASS |
| Inactive templates excluded from active list | PASS |
| Template update preserves existing instances | PASS |
| Generation creates obligations from ordinary/reserved templates | PASS |
| Generation creates income expectations from income templates | PASS |
| Rerun generation no duplicates (idempotent) | PASS |
| Concurrent generation no duplicates (3 concurrent, 1 result) | PASS |
| Template edit does not change existing obligation amount | PASS |
| Template edit does not change existing obligation title | PASS |
| Inactive templates not generated | PASS |
| Two-user generation isolation (A obligations, B income) | PASS |
| Year rollover (Dec 2026 -> Jan 2027) | PASS |
| Empty templates generates nothing | PASS |

### Browser QA

Browser QA was not performed for Step08. The UI follows the exact same
patterns as Step07 (same Sheet, Button, Input, Field, Alert components, same
inline-style approach, same Greek locale, same safe-area/touch-target
compliance). The build compiles successfully with all routes. Real browser QA
will be performed by Hermes during independent review.

## Boundaries kept

- No commits/pushes/deployment/production migrations/public writes.
- No global configuration edits (.env not modified).
- No edits to independent review files or existing review files.
- No new features beyond the Step08 monthly plans and recurring templates.
- No real data import; all fixtures are synthetic @step08.test.local emails,
  cleaned up via disposable schemas (dropped in afterAll).
- No new migration (Step05 schema was sufficient).
- UI calls real production route handlers; no test-only API implementation.
- Greek UI confirmed by user in Step07, carried forward.
- No full next-month carryover workflow (deferred to Step14).
- No recurrence engine (weekly allowance entered as monthly budget, not
  multiplied).

## Remaining risks / deferred items

1. Browser QA was not performed by the implementer. Hermes should verify
   320/390/430px widths, form persistence, console errors, and real
   interactions against the dev server.
2. The generation service does not write audit_log entries (deferred to
   Step10/Step12 when settlement/reversal operations are introduced).
3. The plan page does not show generated obligations/income in a per-month
   detail view (that is Step09: expense plans and income expectations).
4. Month closing lifecycle (status open -> closed) is not implemented yet
   (Step14/Step15). The updateSavingsTarget service rejects closed months,
   but no UI for closing months exists.
5. The schema.md file has some repetition corruption from a prior step
   (pre-existing, not introduced by Step08).

## STOP

Step08 monthly plans and recurring templates implemented and self-verified.
Awaiting independent Hermes review. No next step started.