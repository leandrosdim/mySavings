# Step02 independent review corrections — self-report (GLM 5.2 Cloud)

This report documents the corrections applied to the pure financial
modules/tests/docs in response to the Step02 independent review. It does not
claim Hermes approval. Scope was strictly limited to `lib/finance/*.ts`,
`tests/finance/*.test.ts`, and `docs/finance-api.md`. No DB driver, DB
connection, schema, UI, auth, commits, or pushes were touched. The real Neon
URL in `.env` was never read, printed, changed, or consumed in tests.

## Initial findings (before corrections)

- **Original suite**: 82 passed (money, settlements, forecast).
- **Hermes independent suite** (`hermes-review.test.ts`): 8 failed / 2 passed.
- **Root causes**:
  1. `computePaid` subtracted reversed settlements instead of excluding the
     original — `computePaid([{amount:4000,reversed:true}])` returned `-4000`
     instead of `0`.
  2. No validation of historical settlement amounts/flags; overpaid histories
     produced negative remainnings instead of rejecting.
  3. `settlePayment` threw (or behaved inconsistently) on invalid planned
     (`NaN`) instead of returning `ok:false`.
  4. `validatePositiveCents` only checked integer-ness, permitting negative
     savings targets, negative received/paid, negative expected income.
  5. Duplicate balance IDs were summed twice (200000 instead of 100000);
     duplicate reserve/ordinary IDs were max-chosen from contradictory versions.
  6. Same liability in ordinary and reserve arrays was counted in both
     (20000 instead of 10000) with no linking mechanism.
  7. Reserve `outstanding` was treated as gross then paid subtracted — ambiguous
     outstanding-minus-paid API.
  8. No `amount:null` representation for never-entered balances; no distinction
     from `amount:0`.

## Corrections applied

### 1. Settlements (`lib/finance/settlements.ts`)

- **Reversal = exclude, not subtract**: `reversed:true` now marks an original
  settlement as reversed and excluded from paid. `computePaid` sums only
  non-reversed entries. `computePaid([{amount:4000,reversed:true}])` === `0`;
  `computeRemaining(8000, [...])` === `8000`.
- **History validation**: every settlement amount must be strictly positive
  safe cents; `reversed` must be boolean. Non-positive amounts, non-boolean
  flags, and out-of-bounds values throw `CentsError`.
- **Overpaid history rejection**: `computeRemaining` and `settlementStatus`
  reject (throw `CentsError`) when active paid > planned — never return a
  negative remainder or mark overpayment as paid.
- **`settlePayment` consistent `ok:false`**: validates `planned` (non-negative
  safe cents), existing history, and payment; returns `{ok:false, reason}` for
  any invalid input (including `NaN` planned, malformed history, overpaid
  history, nonpositive/non-integer payment, overflow) instead of throwing.
- **No input mutation**: success returns a new settlements array; the input
  array reference is untouched and returned unchanged on failure.
- **Constructor validation**: `activeSettlement`/`reversedSettlement` reject
  non-positive amounts.
- **Zero-plan status**: `planned:0` with no active settlements => `Unpaid`
  (documented consistently).

### 2. Forecast (`lib/finance/forecast.ts`)

- **Non-negativity validation**: renamed `validatePositiveCents` to
  `validateNonNegativeCents`; validates non-negativity for all non-balance
  domain fields (income expected/received, expense planned/paid, reserve
  planned/paid, transfer amount, savings target). Balance amounts may be
  negative (overdraft). Validation runs even when setup is incomplete.
- **Null balances**: `BalanceEntry.amount` is now `Cents | null`. `null` means
  never-entered => `setupIncomplete:true` with null forecasts, distinct from
  `amount:0`. Conflicting duplicate/missing accounts are rejected, not guessed.
- **Duplicate ID policy**: identical duplicate representations are collapsed to
  one copy; **conflicting** duplicates (different fields, even with equal
  remainder) are **rejected** — no maximum choosing. Blank IDs rejected.
  Applied to balances, income, ordinary expenses, and reserves.
- **`linkedReserveId` mechanism**: `OrdinaryExpense` gains optional
  `linkedReserveId`. When present, the referenced reserve must exist with a
  matching representation; the ordinary entry is then excluded from E (counted
  once in R). Missing links and contradictory representations are rejected.
  Same ordinary/reserve id without an explicit link is rejected (no guessing).
- **Reserve contract renamed**: `outstanding` field renamed to `planned` (gross
  protected total). R contribution = `planned - paidCents`. No misleading
  outstanding-minus-paid double subtraction. Callers supply planned/protected
  total plus paid.
- **Transfer validation**: non-blank, distinct from/to IDs; strictly positive
  amount. Validated even when setup incomplete.
- **Formula cleanup**: removed the needless `subCents(..., 0)` term from the
  projected free-to-spend formula.

### 3. Tests

- **`settlements.test.ts`**: aligned reversal tests to exclude semantics
  (reversed originals excluded, not subtracted). Added suites for invalid
  history rejection (`CentsError`), `settlePayment` invalid-input `ok:false`
  paths, no-mutation, and constructor validation.
- **`forecast.test.ts`**: updated reserve helper to `planned` field; added
  suites for null balances, conflicting duplicate rejection (equal-remainder
  case included), `linkedReserveId` cross-category linking (matching, missing,
  contradictory, same-id-without-link), transfer validation, partial reserve
  payment, and nonnegative-domain rejection for every field.
- **`hermes-review.test.ts`**: kept all independent financial assertions;
  improved catch assertions to expect `CentsError` on permitted rejection paths
  (not any exception). Adapted the cross-category test to use the genuine
  `linkedReserveId` case (not a duplicate-only reserve array). Added
  conflicting-duplicate-balance and same-id-without-link rejection tests.
  Kept the bigint oracle boundary test unchanged.

### 4. Docs (`docs/finance-api.md`)

- Documented corrected reversal semantics, history validation, `ok:false`
  contract, zero-plan status, non-negativity validation, null balances,
  duplicate/conflicting ID policy, `linkedReserveId`, renamed reserve contract,
  transfer validation, and formula cleanup.
- Added an explicit "Numeric parse/format implementation" section: safe-integer
  arithmetic only (parseInt + integer multiply by 100), never decimal float
  multiplication; format uses `Math.floor(abs/100)` and `abs%100`, never
  `toFixed`.
- Added a "Correction notes" section listing all 10 corrections with
  references to the financial rules; explicitly states this does not claim
  Hermes approval.

## Verification results

| Gate | Result |
|------|--------|
| `npm run lint` | pass (no errors) |
| `npm run typecheck` | pass (types generated, tsc --noEmit clean) |
| `npm test` (`vitest run`) | 4 files, **127 passed**, 0 failed |
| `npm run build` | pass (compiled, TypeScript clean, static pages generated) |
| `npm audit` | 0 vulnerabilities |

## Test coverage summary

- Original suite assertions preserved (gas scenario, overpayment, formulas,
  shortfalls, receipts, transfers, aggregation).
- Hermes independent assertions preserved and strengthened (`CentsError`
  expectations; genuine cross-category link test).
- New cases added: reversal original exclusion, all-reversed history,
  non-positive/non-boolean settlement rejection, overpaid history rejection,
  `NaN`/negative planned `ok:false`, malformed history `ok:false`, no-mutation,
  constructor validation, null balance setup-incomplete, identical-duplicate
  collapse, conflicting-duplicate rejection (equal-remainder boundary),
  `linkedReserveId` matching/missing/contradictory/same-id-without-link,
  partial reserve payment, transfer distinct/positive validation,
  nonnegative-domain rejection for every field, bigint oracle boundary.

## Out of scope (not touched)

- DB driver, DB connection, schema, migrations.
- UI, app routes, auth, session.
- Registered future prompts (`steps/`, `prompts/`) — Step03 not marked started.
- Git commits / pushes.
- `.env` (never read/printed/changed/consumed).

## Notes

- The `money.ts` module required no behavioral changes; its parse/format
  already used safe-integer arithmetic. The "Numeric parse/format
  implementation" section was added to the docs to make the implementation
  explicit as requested.
- The `docs/product.md`, `package.json`, and `package-lock.json` modifications
  visible in `git status` are pre-existing from the original Step02
  implementation run, not from this correction pass.

STOP. Awaiting explicit user approval before any next step.