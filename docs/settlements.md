# Settlements engine — design and operating protocol

This document describes the partial payment and receipt engine implemented in
Step10 (`lib/settlements/*`). It covers lock ordering, the idempotency and
retry protocol, and the post-refresh reversal behavior that prevents blind
balance corruption.

## Overview

A **settlement** is an immutable expense payment against an obligation. A
**receipt** is an immutable income receipt against an income expectation. Both
support two balance modes:

- **UPDATE_ACCOUNT**: the account balance is changed atomically with an
  immutable `account_movements` row (debit for payments, credit for receipts).
- **ALREADY_REFLECTED**: the amount is recorded without a balance change
  because a prior manual bank refresh already includes it. No movement row is
  created.

The planned/expected amount on the parent obligation/income is **never
mutated** by settlements or receipts. Paid/remaining and received/pending are
derived from non-reversed rows. Reversals are separate immutable rows linked
to the original; the original is never UPDATEd.

## Lock order

All writes use a single transaction client (`withTransaction`) with explicit
BEGIN/COMMIT/ROLLBACK. To prevent deadlocks, rows are locked in a fixed
deterministic sequence:

1. **operation_log** row for `(owner_id, idempotency_key)` — checked first via
   SELECT, then INSERTed at the end of the operation.
2. **obligation** or **income_expectation** row — `SELECT ... FOR UPDATE`
   before the paid/received sum query, held until commit. This prevents two
   concurrent payments from both reading the same remaining and overpaying.
3. **account** row — `SELECT ... FOR UPDATE` when mode is UPDATE_ACCOUNT,
   locked after the obligation/income lock.
4. **monthly_plans** row — read-only status check (open/closed), no FOR UPDATE
   needed.

Because every concurrent operation on the same obligation+account locks rows
in the same order, they serialize rather than deadlock. The obligation lock is
the critical concurrency gate: it is held from the paid-sum computation through
the settlement insert, so a second payment cannot read stale remaining.

## Idempotency and retry protocol

Every payment, receipt and reversal requires an `idempotency_key` unique per
`(owner_id, operation_key)`. The `operation_log` table tracks the payload hash
for each key:

- **New key**: the operation proceeds, and the result is stored implicitly via
  the immutable settlement/receipt/reversal row.
- **Same key + same payload hash (replay)**: the operation returns the
  original safe result reconstructed from the DB. No duplicate
  settlement/receipt/movement is created. The account is debited/credited
  exactly once.
- **Same key + different payload hash**: rejected with
  `IdempotencyConflictError`. A retry with the same key but changed parameters
  is never silently accepted.

The `UNIQUE (owner_id, idempotency_key)` constraint on `settlements`,
`income_receipts`, `settlement_reversals`, and `income_receipt_reversals`
provides a DB-level guarantee that a duplicate key cannot create a second row.
The `UNIQUE (owner_id, operation_key)` on `operation_log` provides the
payload-hash check.

## Overpayment rejection

Before inserting a settlement, the service computes the current paid sum
(non-reversed settlements) **under the obligation row lock** and checks:

```
amountCents > (planned_cents - paid_cents)
```

If true, `OverpaymentError` is thrown. The lock is held until commit, so two
concurrent payments (e.g. 6000 + 6000 against an 8000 plan) cannot both pass
the check. One succeeds; the other sees the updated paid sum and is rejected.

The same logic applies to receipts: `amountCents > (expected_cents -
received_cents)` is rejected.

## Post-refresh reversal behavior

A reversal creates an immutable `settlement_reversals` or
`income_receipt_reversals` row linked to the original. When the original used
UPDATE_ACCOUNT, the service must decide whether to adjust the account balance:

### Case 1: account NOT refreshed after the settlement/receipt

The balance is automatically reversed with a compensating movement (credit for
settlement reversal, debit for receipt reversal). This is safe because no
manual refresh has replaced the balance in the meantime.

### Case 2: account WAS refreshed after the settlement/receipt

A manual balance refresh **replaces** (not adds) the current balance. If the
service blindly reversed the original movement, it would corrupt the refreshed
balance. Instead:

- If the caller does not provide `adjustBalanceAfterRefresh`, the service
  throws `RefreshReconciliationRequiredError` (HTTP 409 with
  `requiresRefreshReconciliation: true`). The UI must prompt the user for an
  explicit decision.
- If `adjustBalanceAfterRefresh: true`, the service adjusts the current balance
  with a compensating movement.
- If `adjustBalanceAfterRefresh: false`, the reversal row is recorded but the
  balance is left untouched (the refreshed balance already reflects reality).

The "refreshed after" check queries `balance_adjustments` for rows with
`recorded_at > settlement.recorded_at` on the same account.

### ALREADY_REFLECTED reversals

When the original settlement/receipt used ALREADY_REFLECTED, there is no
account to adjust. The reversal row is recorded and `balanceWasAdjusted` is
`false`. No movement is created.

## Business date vs recorded-at provenance

- `business_date` (DATE): the user-supplied date the payment/receipt/reversal
  occurred. Calendar date, no timezone shift.
- `recorded_at` (timestamptz): when the row was inserted in the DB. Used for
  the post-refresh detection check and audit ordering.

These are kept distinct so a back-dated business event does not confuse the
refresh-after-settlement detection.

## Audit trail

Every payment, receipt, settlement reversal and receipt reversal writes an
immutable `audit_log` row with the operation type, entity reference and a safe
summary (no secrets or raw payloads).

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/settlements/pay` | Record a payment |
| POST | `/api/settlements/receive` | Record an income receipt |
| POST | `/api/settlements/reverse` | Reverse a settlement |
| POST | `/api/receipts/reverse` | Reverse an income receipt |

All routes are owner-scoped via `requireApiUser` and origin-checked for CSRF
protection. Responses are `Cache-Control: no-store`.

## Forecast invariance

- A new UPDATE_ACCOUNT payment reduces B (balance) and E (unpaid ordinary
  expenses) equally, so free-to-spend is unchanged absent other changes.
- An ALREADY_REFLECTED payment reduces E only; B is unchanged.
- A receipt reduces I (pending income) and adds to B once (UPDATE_ACCOUNT) or
  leaves B unchanged (ALREADY_REFLECTED).
- A reserve payment reduces R (reserved outstanding) and B exactly once; the
  linked expense presentation is never double-counted in E.
- Reversals restore the derived paid/received totals; the post-refresh flag
  ensures B is not corrupted by a blind compensating movement.