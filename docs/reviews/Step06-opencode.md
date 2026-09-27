# Step06 — implementer self-report

Project: /home/leandrosdim777/projects/mySavings
Model: ollama-cloud/glm-5.2
Date: 2026-09-26

This is the implementer's self-report for Step06 (account balances and
adjustments backend). It is NOT independent approval. Hermes reviews
independently. No commits/pushes/deployment/production migrations/public
writes were performed.

## Prerequisite note

Step05's independent Hermes review (docs/reviews/Step05.md) had not been
written at launch time; the registry marked Step05 as "registered". The user
explicitly approved Step05 and authorized proceeding to Step06. Step05's
prerequisite was independently verified by running the real migration gate
(0003 applied, second run idempotent) and the full Step05 schema test suite
(41 tests PASS) before any Step06 work began. The registry was updated to
"verified" for Step05.

## Scope

Only Step06: owner-scoped account create/list/rename/archive, manually
replace current balance with as-of time + version guard + immutable
adjustment audit, and internal transfers (atomic, net-zero, deterministic
lock order, idempotent). Reconciliation-needed state query. No financial UI
(Step07), no full transaction categorization, no Step07+ implementation.

## Prerequisites verified

- Step04 independently verified (docs/reviews/Step04.md): private auth,
  server-session owner resolution via requireApiUser / resolveSessionDetailed.
- Step05 schema (0003_finance.sql) applied and idempotent: 0 applied, 3
  skipped on second run. 41 schema tests PASS.
- Existing migrations: 0001, 0002, 0003. Next unused: 0004. No new migration
  needed for Step06 — the Step05 schema already defines accounts,
  balance_adjustments, account_movements, internal_transfers, operation_log,
  and audit_log tables with all required columns and constraints.
- Transaction conventions: withTransaction(async (client) => ...) in lib/db.ts.
- Money: lib/finance/money.ts with branded Cents, parseEur, cents(), bounds.
- Route handler pattern: app/api/*/route.ts with requireApiUser from
  lib/auth/api-guard.ts; origin validation via lib/auth/origin.ts.
- git status inspected; no unrelated changes overwritten.

## Files created

### Service layer (lib/accounts/)

- `lib/accounts/types.ts` — shared types (Account, OwnerId, AccountId,
  CreateAccountInput, RefreshBalanceInput, TransferInput, etc.) and error
  hierarchy (AccountServiceError → ValidationError, NotFoundError,
  ConflictError, ArchiveRestrictedError, IdempotencyConflictError). Each
  error carries a stable `code` for HTTP mapping.
- `lib/accounts/validation.ts` — pure input validation: account names
  (1-100 chars, trimmed), optional/required Cents, positive Cents, business
  dates (YYYY-MM-DD with calendar validation), idempotency keys, expected
  versions, optional reasons. No DB/React imports; safe for test reuse.
- `lib/accounts/service.ts` — server-only account service:
  - createAccount: validated name + optional initial balance (null = never-
    entered, 0 = explicit zero, both distinct). balance_as_of set to now()
    when a balance is provided.
  - listAccounts / listAllAccounts: owner-scoped, ordered by created_at.
  - getAccount: owner-scoped single fetch; NotFoundError on miss or
    cross-owner access.
  - renameAccount: owner-scoped, rejects archived accounts.
  - archiveAccount: locks row FOR UPDATE, restricts to zero-balance or
    never-set accounts (ArchiveRestrictedError on funded accounts so money
    cannot vanish). Idempotent on already-archived.
  - refreshBalance: validates input at service boundary, locks account FOR
    UPDATE, checks expectedVersion (ConflictError with currentVersion on
    mismatch), REPLACES current_balance_cents (not adds), increments
    version, writes immutable balance_adjustments row (old/new/delta/as-of),
    records operation_log for idempotency. Retry with same key+payload
    returns original result; changed payload → IdempotencyConflictError.
  - transferBetweenAccounts: validates input, locks both accounts in
    deterministic ascending ID order (prevents deadlocks), creates
    internal_transfers record, creates debit + credit account_movements
    atomically, updates both balances. Net-zero: individual balances change,
    total unchanged. Idempotent via operation_log. Rejects same-account,
    zero/negative amounts, archived accounts.
  - getReconciliationState: counts movements after the last balance_as_of
    to flag potentially already-reflected items (no automatic matching).
- `lib/accounts/routes.ts` — shared route-handler helpers: resolveOwner
  (via requireApiUser), checkOrigin (CSRF), mapServiceError (HTTP status
  mapping), handlePost/handleGet wrappers.
- `lib/accounts/index.ts` — barrel export.

### Route handlers (app/api/accounts/)

- `app/api/accounts/route.ts` — GET: list non-archived accounts.
- `app/api/accounts/[id]/route.ts` — GET: single account + reconciliation
  state.
- `app/api/accounts/create/route.ts` — POST: create account.
- `app/api/accounts/[id]/rename/route.ts` — PATCH: rename account.
- `app/api/accounts/[id]/archive/route.ts` — POST: archive account.
- `app/api/accounts/[id]/refresh/route.ts` — POST: refresh balance.
- `app/api/accounts/transfer/route.ts` — POST: internal transfer.

All mutating routes validate the request origin (CSRF protection) and
resolve the owner from the verified server session via requireApiUser.
No route accepts an ownerId from client input.

### Tests (tests/accounts/)

- `tests/accounts/helpers.ts` — disposable step06_* schema setup following
  the tests/auth/helpers.ts pattern: direct endpoint pool with startup
  search_path, two synthetic users (A and B), production pool injected via
  __setTestPool. Includes insertAccountDirect, readAccountDirect,
  countMovements, countAdjustments, testIdempotencyKey helpers.
- `tests/accounts/accounts.test.ts` — 21 tests: create with name/balance,
  never-entered vs explicit zero, list (active vs all), get single, rename,
  archive restrictions (zero OK, funded rejected, negative rejected,
  idempotent), cross-owner isolation (A cannot get/rename/archive B's).
- `tests/accounts/balance.test.ts` — 15 tests: replace not add, immutable
  audit row, never-entered vs zero, negative balance, version guard (stale
  rejected, currentVersion in conflict), rollback (failed refresh leaves
  balance unchanged, no adjustment written), concurrency (two concurrent
  refreshes: one wins, one conflicts), idempotency (retry returns original,
  changed payload rejected), archived account rejected, cross-user isolation.
- `tests/accounts/transfer.test.ts` — 15 tests: net-zero (individual change,
  pair total unchanged), two movement rows, negative balance from never-set,
  validation (same-account, zero, negative, bad date), rollback after first
  movement (non-existent destination → no partial state), idempotency (retry
  returns original, no duplicate movements), concurrency (two concurrent
  opposite-direction transfers serialize without deadlock), cross-user
  isolation (A cannot transfer from/to B's account, B cannot drain A's),
  archived account rejected.

## Files modified

- `steps/registry.json` — Step05 status: "registered" → "verified" (user
  approved Step05 and authorized proceeding to Step06).
- `tests/db/helpers.ts` — added "step06" prefix to the disposable-schema drop
  guard (one line, same pattern as existing step03/step04/step05 guards).
- `vitest.db.config.mts` — added "tests/accounts/**/*.test.ts" to the
  include set (one line).

## Schema/API decisions

### No new migration required

The Step05 schema (0003_finance.sql) already defines all tables needed for
Step06: accounts (with version, current_balance_cents nullable, balance_as_of),
balance_adjustments (immutable old/new/delta/as_of/idempotency_key),
account_movements (immutable direction/amount/source_type/source_id),
internal_transfers (from/to/amount/business_date/idempotency_key), and
operation_log (owner+key+payload_hash). No new columns or constraints were
needed.

### Owner resolution

Every service function takes an ownerId: string derived from the verified
server session. Route handlers use requireApiUser() from lib/auth/api-guard.ts
which calls resolveSessionDetailed() — the same trusted-boundary pattern as
Step04. No service function accepts arbitrary unvalidated owner input.

### Optimistic concurrency (version guard)

The accounts table has a `version` column (BIGINT NOT NULL DEFAULT 1).
refreshBalance requires the caller's expectedVersion to match the current
version. The UPDATE includes `AND version = $5` as a belt-and-suspenders
guard: if the row was modified between the FOR UPDATE lock and the UPDATE,
the UPDATE matches zero rows and throws ConflictError. The ConflictError
carries the current version so the client can reload and retry.

### Deterministic lock order for transfers

transferBetweenAccounts locks both accounts in ascending ID order (BigInt
comparison). Two concurrent transfers between the same pair — even in
opposite directions — lock in the same order, so they serialize rather than
deadlock. Tested with a concurrent opposite-direction transfer test.

### Idempotency

operation_log stores (owner_id, operation_key, payload_hash, operation_type)
with UNIQUE (owner_id, operation_key). A retry with the same key and matching
payload hash returns the original result (reconstructed from the stored
adjustment/transfer row). A retry with the same key but a different payload
hash is rejected with IdempotencyConflictError. The payload hash is a SHA-256
of the canonical JSON of the operation's parameters.

### Archive restriction (v1)

Archive is restricted to zero-balance or never-set (null) accounts. A funded
account (positive or negative balance) cannot be archived — this prevents
money from silently vanishing from the total. The user must transfer or
withdraw funds first. This is the documented v1 policy; the prompt allows a
different policy with explicit user approval.

### Never-entered vs explicit zero

current_balance_cents is NULL when the user has never entered a balance
(setup-incomplete). An explicit zero is stored as 0 with balance_as_of set
to now(). The service and tests distinguish these two states.

### Reconciliation state

getReconciliationState counts account_movements recorded after the last
balance_adjustment's as_of timestamp. If movements exist after the last
refresh, they may already be reflected in the bank balance the user entered,
so a reconciliation-needed flag is returned. No automatic matching is
performed — the user reviews the explicit state in Step07/11.

## Quality gates

| Gate | Result |
|------|--------|
| `npm run lint` | Pass (0 errors, 0 warnings) |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | Pass |
| `npm test` (offline) | Pass: 7 files, 309 tests |
| `DB_TEST_ALLOW_WRITES=1 npm run test:db` (full DB suite) | Pass: 20 files, 557 tests |
| `npm run build` | Pass (Next.js 16.3.5, Turbopack; 7 new account routes compiled) |
| `npm audit` | 0 vulnerabilities |
| `git diff --check` | Clean |
| Migration idempotence (`npm run db:migrate` second run) | 0 applied, 3 skipped |

New account test count: 51 tests across 3 files.
Full DB suite went from 506 to 557 tests (+51).
Offline suite unchanged at 309 tests.

## Step-specific acceptance evidence

| Scenario | Test | Result |
|----------|------|--------|
| Same-client rollback | balance.test.ts: rollback test | PASS — failed refresh leaves balance unchanged, no adjustment written |
| Balance replacement not addition | balance.test.ts: replace not add | PASS — 100000 → 50000 (not 150000) |
| Concurrency conflict | balance.test.ts: two concurrent refreshes | PASS — one wins, one gets ConflictError |
| Archive restrictions | accounts.test.ts: archive restrictions | PASS — zero OK, funded/negative rejected |
| Net-zero transfer | transfer.test.ts: net-zero | PASS — individual change, pair total unchanged |
| A/B read/write/ID isolation | accounts/balance/transfer test suites | PASS — 8 cross-user isolation tests all pass |
| Retry dedupe | balance + transfer idempotency tests | PASS — same key+payload returns original, no duplicate rows |
| No credentials in logs | (verified: no .env/credentials in code or test output) | PASS |

## Boundaries kept

- No commits/pushes/deployment/production migrations/public writes.
- No global configuration edits.
- No edits to independent review files or existing review files.
- No new features beyond the Step06 account backend scope.
- No real data import; all fixtures are synthetic @step06.test.local emails
  in disposable step06_* schemas, cleaned up in teardown.
- No UI changes (Step06 is backend-only; Step07 handles the mobile shell).
- No new migration (Step05 schema was sufficient).
- Tests exercise the real production service layer (lib/accounts/service.ts)
  through the real DB, not a separate test-only implementation.

## Remaining risks / deferred items

1. Route handlers are not integration-tested via real HTTP requests in this
   step (the service layer is tested directly through the real DB). Step07's
   browser QA will exercise the route handlers end-to-end.
2. The `getReconciliationState` query counts movements after the last
   adjustment's as_of; it does not distinguish UPDATE_ACCOUNT from
   ALREADY_REFLECTED movements. Step10/Step11 will refine this when
   settlement modes are implemented.
3. Negative balances after transfer are allowed (per documented balance
   policy); the schema does not enforce a minimum balance. A per-account
   overdraft limit is a future product decision.
4. The docs/schema.md file has a pre-existing duplication issue (header
   repeats 22 times, 3852 lines) introduced by Step05; not touched in Step06.
5. No audit_log entries are written by the account service in this step.
   Step10/Step12 will add audit logging for sensitive operations per the
   schema's audit_log table design.

## STOP

Step06 account balances and adjustments backend implemented and
self-verified. Awaiting independent Hermes review. No next step started.