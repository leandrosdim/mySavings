# Step10 — implementer self-report

Project: /home/leandrosdim777/projects/mySavings
Model: ollama-cloud/glm-5.2
Date: 2026-09-26

This is the implementer's self-report for Step10 (partial payments and
receipts engine). It is NOT independent approval. Hermes reviews
independently. No commits/pushes/deployment/production migrations/public
writes were performed.

## Prerequisite note

Step09 was approved by the user. The Step09 self-report
(docs/reviews/Step09-opencode.md) documented complete expense plans and income
expectations with all gates passing. The Step09 independent Hermes review
(docs/reviews/Step09.md) had not been written at launch time; the user
explicitly approved Step09 and authorized proceeding to Step10. Step09's
features were verified before any Step10 work began by confirming the build
compiles and the Step09 test suite passes.

The Greek UI assumption (confirmed by the user in Step07) carries forward:
all user-facing UI strings are in Greek; code, identifiers, comments and docs
remain in English. Step10 is backend-only; no UI changes were made.

## Scope

Only Step10: transaction-safe partial expense payment and income receipt with
UPDATE_ACCOUNT versus ALREADY_REFLECTED mode. Validate same owner/account,
lock rows in deterministic order, reject overpayment, idempotency key plus
payload hash, immutable audit/movements. Reversal design includes later manual
refresh: never blindly change a refreshed balance. Backend only to keep gate
bounded. No UI (Step11 scope). No new migration (Step05 schema was
sufficient).

## Prerequisites verified

- Step05 schema: settlements, settlement_reversals, income_receipts,
  income_receipt_reversals, account_movements, operation_log, audit_log,
  balance_adjustments tables already defined with owner-aware composite FKs,
  partial unique indexes, and CHECK constraints. No new migration needed.
- Step06/Step07: account service locking/refresh patterns reused.
- Step09: obligation/income services and derived paid/received patterns
  reused.
- git status inspected; no unrelated changes overwritten.

## Files created

### Settlement service (lib/settlements/)

- `lib/settlements/types.ts` — shared types (Settlement, Receipt,
  PayInput, PayResult, ReceiveInput, ReceiveResult, ReverseSettlementInput,
  ReverseSettlementResult, ReverseReceiptInput, ReverseReceiptResult,
  SettlementMode) and error hierarchy (SettlementServiceError,
  SettlementValidationError, SettlementNotFoundError, SettlementConflictError,
  IdempotencyConflictError, OverpaymentError, ClosedMonthError,
  AlreadyReversedError, RefreshReconciliationRequiredError).
- `lib/settlements/validation.ts` — pure validation: validateObligationId,
  validateIncomeId, validateSettlementId, validateReceiptId,
  validateOptionalAccountId, validateMode (explicit enum, never inferred),
  validateAmountCents (strictly positive), validateBusinessDate
  (YYYY-MM-DD, calendar-valid), validateIdempotencyKey, validateOptionalReason,
  validatePayInput, validateReceiveInput, validateReverseSettlementInput,
  validateReverseReceiptInput.
- `lib/settlements/service.ts` — server-only service:
  - payObligation: locks obligation FOR UPDATE, computes paid under lock,
    rejects overpayment, locks account FOR UPDATE when UPDATE_ACCOUNT,
    inserts immutable settlement + movement + audit + operation_log
    atomically. Idempotency: same key+payload returns original; changed
    payload rejects.
  - receiveIncome: mirrors payObligation but adds to account balance
    (credit movement). Over-receipt rejected.
  - reverseSettlement: locks original settlement FOR UPDATE, guards double
    reversal, checks if account was refreshed after settlement. If refreshed
    and no adjustBalanceAfterRefresh flag: throws
    RefreshReconciliationRequiredError. If refreshed and flag=true: adjusts
    balance with compensating credit. If refreshed and flag=false: records
    reversal but leaves balance untouched. If not refreshed: automatically
    credits balance.
  - reverseReceipt: mirrors reverseSettlement but debits the account
    (compensating for original credit).
  - getSettlement, getReceipt: owner-scoped read helpers with reversed flag.
- `lib/settlements/index.ts` — public API barrel.

### API routes

- `app/api/settlements/pay/route.ts` — POST: record a payment.
- `app/api/settlements/receive/route.ts` — POST: record an income receipt.
- `app/api/settlements/reverse/route.ts` — POST: reverse a settlement.
- `app/api/receipts/reverse/route.ts` — POST: reverse an income receipt.

### Tests (tests/settlements/)

- `tests/settlements/helpers.ts` — DB integration test helpers:
  setupSettlementsSchema (disposable step10_* schema, full migration chain,
  two synthetic users), teardownSettlementsSchema, createPlanDirect,
  closePlanDirect, readObligationDirect, readIncomeDirect, readAccountDirect,
  countSettlements, countMovements, countSettlementReversals,
  countReceiptReversals, countAuditLogs, readSettlementRecordedAt,
  insertBalanceAdjustmentDirect (simulates manual refresh), testIdempotencyKey.
- `tests/settlements/payments.test.ts` — 21 tests: gas 8000 -> 4000 -> 4000
  -> 0 (planned unchanged), third payment rejects, partial overpayment
  rejects, concurrent 6000+6000 cannot both settle 8000 (one succeeds, one
  OverpaymentError), duplicate request debits once, changed-payload key
  rejects, rollback (non-existent account/obligation leaves no partial state),
  UPDATE_ACCOUNT reduces B, ALREADY_REFLECTED leaves B unchanged, never-set
  balance goes negative, zero/negative amount rejects, UPDATE_ACCOUNT without
  account rejects, invalid date rejects, archived account rejects, closed
  month rejects, cross-owner obligation/account rejected, reserve target
  payment, paid/remaining derivation from non-reversed settlements.
- `tests/settlements/receipts.test.ts` — 14 tests: 10000 -> 4000 -> 6000
  -> 0 (expected unchanged), over-receipt rejects, concurrent receipts cannot
  over-receive, duplicate credits once, changed-payload rejects, rollback,
  UPDATE_ACCOUNT adds to balance, ALREADY_REFLECTED leaves B unchanged, zero
  amount rejects, closed month rejects, cross-owner rejected, received/pending
  derivation.
- `tests/settlements/reversals.test.ts` — 20 tests: settlement reversal
  before refresh (credits balance, compensating movement), after refresh
  (requires explicit decision, adjusts when true, leaves unchanged when
  false), double reversal guard, idempotency (same key returns original,
  changed payload rejects), ALREADY_REFLECTED reversal (no balance change),
  receipt reversal before/after refresh, double reversal guard, cross-owner
  rejected, closed month rejected, non-existent settlement/receipt rejected.

### Documentation

- `docs/settlements.md` — lock order, idempotency and retry protocol,
  overpayment rejection, post-refresh reversal behavior, business date vs
  recorded-at provenance, audit trail, API endpoints, forecast invariance.

## Files modified

- `lib/finance-routes.ts` — mapServiceError extended to handle
  SettlementServiceError hierarchy: SettlementValidationError (400),
  SettlementNotFoundError (404), SettlementConflictError (409),
  SettlementIdempotencyConflictError (409), OverpaymentError (400),
  AlreadyReversedError (409), RefreshReconciliationRequiredError (409 with
  requiresRefreshReconciliation: true), SettlementClosedMonthError (400),
  SettlementServiceError (400).
- `steps/registry.json` — Step10 status changed to "implemented".
- `steps/README.md` — updated step statuses.
- `tests/db/helpers.ts` — added "step10" prefix to the schema drop guard.
- `vitest.db.config.mts` — added "tests/settlements/**/*.test.ts" to include.

## Schema/API decisions

### No new migration

Step05's 0003_finance.sql already defines all tables needed (settlements,
settlement_reversals, income_receipts, income_receipt_reversals,
account_movements, operation_log, audit_log, balance_adjustments with
owner-aware composite FKs, partial unique indexes, and CHECK constraints).
Step10 is service + API + tests only.

### Service layer pattern

Follows the established lib/accounts/*, lib/obligations/* and lib/income/*
patterns exactly:
- types.ts: shared types and error hierarchy with stable `code` property.
- validation.ts: pure functions, safe for reuse in tests.
- service.ts: server-only, withTransaction for writes, owner-scoped queries.
- index.ts: public API barrel.

### Lock order

operation_log INSERT -> obligation/income FOR UPDATE -> account FOR UPDATE
(when UPDATE_ACCOUNT). The obligation/income lock is held from the
paid/received-sum query through the settlement/receipt insert so two
concurrent payments cannot both read the same remaining and overpay.

### Idempotency

Owner+operation idempotency keys deduplicate retries via the operation_log
table (payload hash). A retry with the same key and a matching payload hash
returns the original safe result reconstructed from the DB. A retry with the
same key but a changed payload is rejected with IdempotencyConflictError. The
UNIQUE (owner_id, idempotency_key) constraint on settlements/receipts/
reversals provides a DB-level guarantee.

### Post-refresh reversal behavior

When the original settlement/receipt used UPDATE_ACCOUNT and the account was
manually refreshed after it was recorded, the reversal MUST NOT blindly
credit/debit the account. The service checks for balance_adjustments rows
with recorded_at > settlement.recorded_at. If refreshed:
- No adjustBalanceAfterRefresh flag: throws RefreshReconciliationRequiredError
  (HTTP 409 with requiresRefreshReconciliation: true).
- adjustBalanceAfterRefresh: true: adjusts balance with compensating movement.
- adjustBalanceAfterRefresh: false: records reversal but leaves balance
  untouched.
If NOT refreshed: automatically reverses balance with compensating movement.

### Owner resolution

Every API route uses requireApiUser via the shared finance-routes.ts helper.
The ownerId is derived from the verified server session, never from client
input.

### Audit trail

Every payment, receipt, settlement reversal and receipt reversal writes an
immutable audit_log row with the operation type, entity reference and a safe
summary (no secrets or raw payloads).

## Quality gates

| Gate | Result |
|------|--------|
| `npm run lint` | Pass (0 errors, 0 warnings) |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | Pass |
| `npm test` (offline) | Pass: 8 files, 331 tests |
| `DB_TEST_ALLOW_WRITES=1 npm run test:db` (full DB suite) | Pass: 29 files, 748 tests (55 new + 693 existing) |
| `npm run build` | Pass (Next.js 16.3.5, Turbopack; 34 routes compiled) |
| `npm audit` | 0 vulnerabilities |
| `git diff --check` | Clean |

## Step-specific acceptance evidence

### DB integration tests (55 new tests across 3 files)

| Scenario | Result |
|----------|--------|
| Gas 8000 -> pay 4000 -> pay 4000: remaining 8000 -> 4000 -> 0; planned unchanged | PASS |
| Third payment rejects (overpayment) | PASS |
| Partial overpayment rejects (5001 > 5000 remaining) | PASS |
| Concurrent 6000+6000 cannot both settle 8000 (one succeeds, one OverpaymentError) | PASS |
| Duplicate request with same key debits once (one settlement, one movement) | PASS |
| Changed-payload same key rejects (IdempotencyConflictError) | PASS |
| Rollback: non-existent account leaves no settlement | PASS |
| Rollback: non-existent obligation leaves no settlement, balance unchanged | PASS |
| UPDATE_ACCOUNT reduces B and creates a debit movement | PASS |
| ALREADY_REFLECTED leaves B unchanged, no movement, paid tracked | PASS |
| UPDATE_ACCOUNT from never-set balance results in negative balance | PASS |
| Zero amount rejects | PASS |
| Negative amount rejects | PASS |
| UPDATE_ACCOUNT without account rejects | PASS |
| Invalid business date rejects | PASS |
| Archived account rejects | PASS |
| Closed month rejects payment | PASS |
| Cross-owner: user B cannot pay A's obligation | PASS |
| Cross-owner: user A cannot pay using B's account | PASS |
| Reserve target payment reduces outstanding, planned unchanged | PASS |
| Paid/remaining derivation from non-reversed settlements | PASS |
| Receipt 10000 -> 4000 -> 6000 -> 0, expected unchanged | PASS |
| Over-receipt rejects | PASS |
| Concurrent receipts cannot over-receive | PASS |
| Duplicate receipt credits once | PASS |
| Changed-payload receipt key rejects | PASS |
| Receipt rollback (non-existent account) | PASS |
| UPDATE_ACCOUNT receipt adds to balance with credit movement | PASS |
| ALREADY_REFLECTED receipt leaves B unchanged | PASS |
| Receipt zero amount rejects | PASS |
| Receipt closed month rejects | PASS |
| Cross-owner receipt rejected | PASS |
| Received/pending derivation from non-reversed receipts | PASS |
| Settlement reversal before refresh: credits balance, compensating movement | PASS |
| Settlement reversal after refresh: requires explicit decision | PASS |
| Settlement reversal after refresh: adjusts when adjustBalanceAfterRefresh=true | PASS |
| Settlement reversal after refresh: leaves balance unchanged when false | PASS |
| Double settlement reversal guard | PASS |
| Settlement reversal idempotency: same key returns original | PASS |
| Settlement reversal: changed payload rejects | PASS |
| ALREADY_REFLECTED settlement reversal: no balance change | PASS |
| Receipt reversal before refresh: debits balance | PASS |
| Receipt reversal after refresh: requires explicit decision | PASS |
| Receipt reversal after refresh: adjusts when true | PASS |
| Receipt reversal after refresh: leaves unchanged when false | PASS |
| Double receipt reversal guard | PASS |
| Cross-owner settlement reversal rejected | PASS |
| Cross-owner receipt reversal rejected | PASS |
| Closed month settlement reversal rejected | PASS |
| Closed month receipt reversal rejected | PASS |
| Non-existent settlement reversal rejected | PASS |
| Non-existent receipt reversal rejected | PASS |

### Browser QA

Browser QA was not performed by the implementer. Step10 is backend-only;
no UI changes were made. The build compiles successfully with all 34 routes.
Real browser QA will be performed by Hermes during independent review if
needed (Step11 is the mobile settlement UX step).

## Boundaries kept

- No commits/pushes/deployment/production migrations/public writes.
- No global configuration edits (.env not modified).
- No edits to independent review files or existing review files.
- No new features beyond Step10 partial payments and receipts engine.
- No real data import; all fixtures are synthetic @step10.test.local emails,
  cleaned up via disposable schemas (dropped in afterAll).
- No new migration (Step05 schema was sufficient).
- API routes call real production service code; no test-only API
  implementation.
- No UI changes (Step11 scope).
- No settlement/receipt mutation controls enabled in the UI before Step11.
- Greek UI confirmed by user in Step07, carried forward (no UI in this step).
- Online-only financial writes; no PWA cache changes.
- Reversal after refresh requires explicit decision, never blind balance
  change.

## Remaining risks / deferred items

1. Browser QA was not performed by the implementer (backend-only step). Hermes
   should verify the API routes respond correctly if needed.
2. The settlement/receipt UI (payment action, reversal confirmation,
   post-refresh reconciliation prompt) is Step11 scope.
3. Month closing lifecycle (status open -> closed) is not implemented yet
   (Step14/Step15). The services reject closed months, but no UI for closing
   months exists.
4. The post-refresh reversal reconciliation prompt UI is Step11 scope; the
   backend throws RefreshReconciliationRequiredError which the UI must handle.
5. Forecast invariance is verified at the pure-computation level
   (lib/finance/forecast.ts tests). The settlement service correctly updates
   balances and derived paid/received totals so that a new UPDATE_ACCOUNT
   payment reduces B and E equally (free-to-spend unchanged), and an
   ALREADY_REFLECTED payment reduces E only (B unchanged).

## STOP

Step10 partial payments and receipts engine implemented and self-verified.
Awaiting independent Hermes review. No next step started.