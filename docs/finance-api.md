# Finance core API reference (Step02)

Pure exact-cent money, settlement and forecast helpers implemented in
`lib/finance/`. No database, session, network or React imports. Safe to call in
tests, server actions and client components.

All amounts are EUR integer **cents** branded as `Cents` to prevent mixing with
arbitrary numbers. Negative balances are valid; payment amounts must be
strictly positive. Arithmetic is checked against `Number.MAX_SAFE_INTEGER` /
`MIN_SAFE_INTEGER`.

## `lib/finance/money.ts`

### Types and constants

- `Cents` — branded integer-cent type (`number & { __brand: "Cents" }`).
- `MAX_CENTS` / `MIN_CENTS` — safe-integer bounds.
- `CentsError` — thrown for invalid money operations or inputs.

### Functions

| Function | Description |
|----------|-------------|
| `cents(value: number): Cents` | Construct/validate a `Cents`. Throws on non-integer, non-finite, out-of-bounds. |
| `toCents(value: number): Cents` | Alias of `cents`. |
| `centsToCents(value: Cents): Cents` | Re-validate an existing `Cents`. |
| `isCents(value: unknown): value is Cents` | Type guard. |
| `addCents(a, b): Cents` | Checked addition (throws on overflow). |
| `subCents(a, b): Cents` | Checked subtraction (throws on underflow). |
| `sumCents(values: readonly Cents[]): Cents` | Safe sum (throws on partial overflow). |
| `parseEur(input: string): Cents` | Parse a decimal EUR string to cents. |
| `formatEur(value: Cents): string` | Format cents as `"DD.cc"` (two decimals, dot). |

### Numeric parse/format implementation

`parseEur` and `formatEur` use **safe-integer arithmetic only** — never decimal
floating-point multiplication. This avoids the binary-rounding errors that make
`80.40 * 100` produce `8039.9999...` in IEEE-754.

**`parseEur`**: the trimmed input is matched against a strict decimal regex
(optional sign, integer part, optional single `.` or `,` separator with 0-2
fractional digits). The integer and fractional substrings are split and each
parsed with `Number.parseInt` (base 10). The fractional part is zero-padded to
two digits when needed. The final cents value is `intValue * 100 + fracValue`,
computed entirely with safe integers, then sign-adjusted and bounds-checked via
`assertCents`. `-0` is normalized to `+0`. Exponent notation, thousand grouping
(`"1.234"`/`"1,234"`), excess precision and non-finite values are rejected.

**`formatEur`**: the absolute value is split with `Math.floor(abs / 100)` for
euros and `abs % 100` for the cent remainder; the remainder is zero-padded to
two digits. No `Number.toFixed` is used (it can round inconsistently for large
values); only integer division and modulo on safe integers are involved.

### `parseEur` input rules

Accepted: `"80"`, `"80.00"`, `"80,00"`, `".40"`, `",40"`, `"0.40"`, leading
`+`/`-`, surrounding whitespace, `-0.00` -> `0`.

Rejected (throws `CentsError`):
- **Ambiguous grouping**: `"1.234"` and `"1,234"` are rejected rather than
  guessing whether the user means `1234.00` or `1.234`. Enter plain decimals.
- Excess precision beyond 2 decimals: `"80.401"`.
- Exponent notation: `"1e2"`, `"1E-2"`.
- Empty/whitespace-only, non-numeric, multiple separators.
- Non-string inputs, `NaN`, `Infinity`, out-of-bounds.

### Synthetic examples

```ts
import { cents, parseEur, formatEur, addCents, subCents } from "@/lib/finance/money";

cents(8000);                    // 8000 cents = EUR 80.00
parseEur("80.40");              // 8040
parseEur("80,40");              // 8040  (comma separator)
parseEur("0.40");               // 40
parseEur("-80.40");             // -8040
formatEur(cents(8040));         // "80.40"
formatEur(cents(-40));          // "-0.40"
addCents(cents(4000), cents(4000));  // 8000
subCents(cents(8000), cents(4000)); // 4000
```

## `lib/finance/settlements.ts`

### Reversal semantics (corrected)

A settlement with `reversed: true` marks an **original** settlement that has
been reversed and is therefore **excluded** from the paid total. It is NOT a
negative unlinked compensating amount that is subtracted again.

- `computePaid([{ amount: 4000, reversed: true }])` === `0`
- `computeRemaining(8000, [{ amount: 4000, reversed: true }])` === `8000`

The future Step10 DB layer will store immutable reversal entries; this pure read
model simply skips reversed rows when summing active paid amounts.

### Types

- `Settlement` — `{ amount: Cents; reversed: boolean }`.
- `SettlementStatus` — enum: `Unpaid`, `Partial`, `Paid`.
- `SettlePaymentResult` — discriminated union: `{ ok: true, ... } | { ok: false, settlements, reason }`.

### Functions

| Function | Description |
|----------|-------------|
| `computePaid(settlements): Cents` | Sum of active (non-reversed) settlements. Validates every entry. |
| `computeRemaining(planned, settlements): Cents` | `planned - computePaid`. Rejects overpaid history. |
| `settlementStatus(planned, settlements): SettlementStatus` | Derived state. Rejects overpaid history. |
| `settlePayment(input): SettlePaymentResult` | Apply a new payment; returns `ok:false` for any invalid input (invalid planned, malformed history, nonpositive payment, overpayment, overflow). Never throws for invalid input. |
| `activeSettlement(amount): Settlement` | Construct an active settlement (strictly positive amount). |
| `reversedSettlement(amount): Settlement` | Construct a reversed (excluded) settlement (strictly positive amount). |

### Input validation

- `amount` in every settlement must be a **strictly positive** safe cents value.
- `reversed` must be a **boolean**.
- `planned` must be a **non-negative** safe cents value.
- Overpaid histories (active paid > planned) are **rejected** with `CentsError` —
  they never produce a negative remainder or a paid status.
- `settlePayment` validates `planned`, the existing history, and the payment,
  returning `{ ok: false, reason }` (with the unchanged settlements reference)
  instead of throwing. It never mutates its input arrays.

### Zero-plan status

When `planned` is `0` and there are no active settlements, the status is
`Unpaid` (nothing is owed, nothing has been paid). A strictly positive payment
against a zero plan is rejected as overpayment.

### Canonical 80/40/40 gas scenario

```ts
const planned = cents(8000);
const r1 = settlePayment({ planned, settlements: [], payment: cents(4000) });
// r1.remaining === 4000, r1.state === Partial, planned === 8000 (unchanged)
const r2 = settlePayment({ planned, settlements: r1.settlements, payment: cents(4000) });
// r2.remaining === 0, r2.state === Paid, planned === 8000
```

The planned amount is never mutated; only the settlements array grows. Inputs
are never mutated — a new settlements array is returned on success.

## `lib/finance/forecast.ts`

### Types

- `BalanceEntry` — `{ id: string; amount: Cents | null }`. `amount` may be
  negative (overdraft). `null` means the account exists but was never entered
  (setup-incomplete), distinct from `amount: 0`.
- `PendingIncome` — `{ id, expected: Cents, receivedCents: Cents }` (both
  non-negative).
- `OrdinaryExpense` — `{ id, planned: Cents, paidCents: Cents, linkedReserveId? }`
  (both non-negative). `linkedReserveId` optionally marks this entry as a
  presentation of an existing reserve.
- `ReservedCommitment` — `{ id, planned: Cents, paidCents: Cents }` (both
  non-negative). **Renamed contract**: the caller supplies `planned` (the gross
  protected/planned total) and `paidCents` (amount already paid). The
  outstanding contribution to R is `planned - paidCents`. There is no separate
  `outstanding` field that would be subtracted again by paid — the old
  `outstanding`-minus-`paid` API was misleading and has been removed.
- `InternalTransfer` — `{ fromAccountId, toAccountId, amount }` (metadata,
  net-zero). `fromAccountId` and `toAccountId` must be non-blank and distinct;
  `amount` must be strictly positive.
- `ForecastInput` — all of the above plus `savingsTarget: Cents | null`.
- `ForecastResult` — see below.

### `computeForecast(input: ForecastInput): ForecastResult`

- `setupIncomplete: boolean` — `true` when any balance has `amount: null`
  (never entered), when there are no balances, or when `savingsTarget` is
  `null`. Distinct from explicit zero (a zero balance or zero target is
  complete).
- `balancesTotal` (B), `pendingIncomeRemaining` (I), `ordinaryUnpaid` (E),
  `reservedOutstanding` (R).
- `projectedFreeToSpend` = `B + I - E - R - S` (null if incomplete).
- `cashBackedFreeToSpend` = `B - E - R - S` (null if incomplete).
- `shortfall` — negative projected value, or `null` when non-negative / incomplete.
- `hasPendingIncomeCaveat` — `true` when some expected income is not yet received.

Negative results are returned signed; they are never clamped to zero.

### Domain non-negativity validation

All non-balance domain amounts must be **non-negative** safe cents:
- `PendingIncome.expected`, `PendingIncome.receivedCents`
- `OrdinaryExpense.planned`, `OrdinaryExpense.paidCents`
- `ReservedCommitment.planned`, `ReservedCommitment.paidCents`
- `InternalTransfer.amount`
- `savingsTarget` (when not `null`)

`BalanceEntry.amount` is the only field that may be negative (overdraft); a
`null` amount marks an unentered account. `paidCents` may not exceed
`planned`/`expected`. Validation runs **even when setup is incomplete**.

### Deduplication (corrected)

Duplicate IDs within the same array are handled explicitly — the module never
silently chooses a maximum from contradictory versions:

- **Identical duplicate representations** (same fields) are collapsed to a
  single copy so an obligation is counted exactly once.
- **Conflicting duplicate representations** (different planned/paid totals, even
  when the derived remainder is coincidentally equal) are **rejected** with
  `CentsError`.
- **Blank/empty IDs** are rejected.

### Cross-category linking (`linkedReserveId`)

An ordinary expense may carry a `linkedReserveId` pointing at an existing
reserve. When present and the representations match exactly, the ordinary entry
is excluded from E (counted once in R). Missing links or contradictory
representations are rejected. An ordinary expense and a reserve sharing the same
id **without** an explicit `linkedReserveId` is rejected — the module never
guesses the relationship.

### Reserve contract (corrected)

The caller supplies `planned` (gross protected total) and `paidCents` (paid so
far). R contribution = `planned - paidCents`. A partial reserve payment reduces
R by the paid amount. There is no `outstanding` field that is subtracted again
by paid — the old `outstanding`-minus-`paid` API was ambiguous and has been
replaced.

### Synthetic example

```ts
computeForecast({
  balances: [{ id: "a1", amount: cents(200000) }],        // B = 2000.00
  pendingIncome: [{ id: "i1", expected: cents(50000), receivedCents: cents(0) }], // I = 500.00
  ordinaryExpenses: [{ id: "e1", planned: cents(60000), paidCents: cents(0) }],  // E = 600.00
  reservedCommitments: [{ id: "r1", planned: cents(30000), paidCents: cents(0) }], // R = 300.00
  internalTransfers: [],
  savingsTarget: cents(70000),                              // S = 700.00
});
// projectedFreeToSpend = 2000 + 500 - 600 - 300 - 700 = 900.00
// cashBackedFreeToSpend = 2000 - 600 - 300 - 700 = 400.00
```

## Date and timezone conventions

This Step02 core is pure calculation and does not consume dates. The following
conventions are fixed for later steps that integrate dates with these modules:

- **Business dates** are date-only (`YYYY-MM-DD`) and must not be UTC-shifted.
  A date-only value represents a calendar day in `Europe/Athens` and is stored
  as `DATE` in PostgreSQL (no time component), so no UTC conversion occurs.
- **Audit timestamps** are timezone-aware (`timestamptz`) and stored in UTC.
- Month boundaries use `Europe/Athens`. A month-end snapshot is keyed by the
  local calendar month, not by a UTC timestamp range.
- Never construct a date by calling `new Date(year, month-1, day)` and then
  reading `getUTCHours`; date-only values have no time-of-day. Convert
  date-only strings to a calendar date directly when date math is needed
  (deferred to the step that introduces due dates / rollover).

## Test runner

- [Vitest](https://vitest.dev) 5.0.1 (devDependency only; Node >=22.12).
- `npm test` — deterministic single run (`vitest run`).
- `npm run test:watch` — watch mode for development.
- Config: `vitest.config.mts` (node environment, `tests/**/*.test.ts`, `@/*`
  alias). No production dependency on the test runner.

## Correction notes (Step02 review)

The following corrections were made to the original Step02 implementation after
the independent review identified contradictions with the financial rules. They
do not claim Hermes approval; they align the pure read model with the original
business rules documented in `docs/financial-rules.md`:

1. **Settlement reversal** — `reversed` now excludes the original settlement
   from paid (not a negative subtracted compensating amount).
2. **History validation** — settlement amounts must be strictly positive,
   `reversed` strictly boolean, overpaid histories rejected.
3. **`settlePayment` invalid input** — consistently returns `ok:false` instead
   of throwing; validates planned and history; overflow-safe; never mutates
   inputs.
4. **Forecast non-negativity** — all non-balance domain amounts must be
   non-negative (renamed/repurposed `validatePositiveCents` to
   `validateNonNegativeCents`).
5. **Duplicate IDs** — identical duplicates collapsed; conflicting duplicates
   rejected (no maximum choosing); blank IDs rejected.
6. **Cross-category linking** — `linkedReserveId` added; same ordinary/reserve
   id without a link rejected.
7. **Reserve contract** — `outstanding` field renamed to `planned` (gross
   protected total); R = `planned - paidCents`; no misleading
   outstanding-minus-paid double subtraction.
8. **Null balances** — `amount: null` marks a never-entered account
   (setup-incomplete) distinct from `amount: 0`.
9. **Transfer validation** — non-blank distinct from/to ids, strictly positive
   amount; validated even when setup incomplete.
10. **Formula cleanup** — removed the needless `subCents(..., 0)` term from the
    projected free-to-spend formula.