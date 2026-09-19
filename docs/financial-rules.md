# Financial rules and acceptance scenarios

## Money/time
EUR integer cents with safe integer bounds and DB constraints (or exact decimals converted safely). Deterministic Greek decimal-input parsing; reject excess precision/NaN/Infinity. DATE for business dates, timezone-aware audit timestamps. Month boundaries initially Europe/Athens. No UTC-shifting date-only values.

## Forecast
B = current active account balances including recorded payments/receipts/adjustments.
I = remaining expected income for selected open month.
E = unpaid ordinary expenses/budget remainder for month, including carried overdue items but EXCLUDING commitments counted in R.
R = reserved commitments outstanding and protected now, including those due later.
S = month's protected savings target.
Projected end-month balance before protected commitments = B + I - E.
Projected free-to-spend = B + I - E - R - S.
Cash-backed free-to-spend = B - E - R - S.
Show negative shortfalls; never silently clamp. Expected income is not cash. Missing target/never-entered balances means incomplete setup, not confident spendable figure.

## Settlements/balances
Retain planned amount. Remaining = planned minus active settlements. Derived unpaid/partial/paid state. Gas planned 8000 cents: first 4000 leaves 4000; second 4000 leaves zero. Reject nonpositive payments and overpayment; row-lock/version-check stale forms.
Explicit modes:
- UPDATE_ACCOUNT: create payment, subtract amount from selected owner account and record movement atomically.
- ALREADY_REFLECTED: payment recorded without balance change because bank refresh already includes it.
Income receipts mirror with additions. Show balance effect before confirmation; do not guess mode from dates.
Manual balance refresh replaces current balance and audits old/new/difference/as-of time. No automatic income/payment creation or settlement. Guide reconciliation of pending items already reflected and warn while unresolved. Protect refresh against concurrent payments using versions/locks.
Owner+operation idempotency keys deduplicate retries and reject changed payload reuse. Atomic payment/movement/audit. Concurrent installments cannot overpay. Corrections use compensating entries. Reversal after a later manual refresh MUST NOT blindly reverse the old balance movement: require explicit balance-effect reconciliation and tests.

## Reserved commitments
Creating a tax reserve reduces spendable amount, not B. Protect full explicitly entered outstanding reserve even before due month. Payment reduces R and B once (unless already reflected). Linked expense presentation never adds this again to E. Release/amendments require confirmation/audit; settled history remains. Do not invent automatic monthly allocations from total liability.

## Rollover/history
Continuous account/obligation identities. Unique owner/template/month recurring generation. Unpaid carryover references SAME obligation, never a second liability. Reserves not duplicated month to month. Preview rollover choices, apply atomically/idempotently, review prior savings target. Closed-month snapshots retain balances, forecast inputs/outputs, target and settlement totals; later updates cannot rewrite them. Never infer actual spending from manual balance differences. Define reopening/correction policy before Step15.

## Required tests
- Gas 8000 -> payment 4000 -> payment 4000: remaining 8000 -> 4000 -> 0; planned unchanged.
- New payment reduces B and E equally; free-to-spend unchanged absent other changes.
- Already-reflected payment reduces E only, B unchanged.
- Receipt reduces I and adds to B once; already-reflected receipt leaves B unchanged.
- Reserve creation affects R only; payment reduces B and R exactly once; linked expense not double counted.
- Refresh replaces rather than adds; stale concurrent form fails safely.
- Retry dedupe, concurrent overpayment rejection, rollback, exact cents, negative shortfalls, correction/reversal including post-refresh case.
- Internal transfer changes individual accounts but not total B/forecast.
- Owner A cannot read/write B's accounts, months, IDs, payments, commitments, nested relations or exports.
- Closed snapshot unchanged by later month; rerun rollover creates no duplicate items.
