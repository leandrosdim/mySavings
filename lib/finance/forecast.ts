/**
 * Forecast module for mySavings.
 *
 * Implements the two end-month free-to-spend formulas from
 * `docs/financial-rules.md`:
 *
 * - Projected free-to-spend = B + I - E - R - S
 * - Cash-backed free-to-spend = B - E - R - S
 *
 * where:
 * - B = current active account balances total
 * - I = remaining expected income for the open month
 * - E = unpaid ordinary expenses (EXCLUDING commitments counted in R)
 * - R = reserved commitments protected total now (planned/protected total;
 *   paid amounts reduce the protected commitment, see below)
 * - S = month's protected savings target (a protected total, not a contribution)
 *
 * Ordinary expenses and reserved commitments are distinct types so an
 * obligation is counted exactly once. An ordinary expense may optionally carry
 * a `linkedReserveId` that points at an existing reserve; when present and
 * consistent, the ordinary entry is treated as a presentation of that reserve
 * and is NOT summed into E (it is already counted in R). Conflicting or missing
 * links are rejected rather than guessed.
 *
 * Duplicate IDs within the same array are handled explicitly:
 * - identical duplicate representations may be collapsed to a single copy;
 * - conflicting duplicate representations (different planned/paid totals, even
 *   if they coincidentally have the same remainder) are REJECTED — the module
 *   never silently chooses a maximum from contradictory versions.
 * - blank/empty IDs are rejected.
 *
 * The module returns signed results plus an explicit shortfall and pending
 * income caveat; it never clamps away negative results.
 *
 * Setup-incomplete inputs: an account that exists but was never entered is
 * represented as `amount: null` and makes the forecast setup-incomplete with
 * null forecast figures, distinct from an explicit `amount: 0`. A missing
 * savings target (`null`) has the same semantics. Conflicting
 * duplicate/missing accounts must not be guessed and cause rejection.
 *
 * All non-balance domain amounts must be non-negative safe cents; balance
 * amounts may be negative (overdraft) but a `null` amount marks an unentered
 * account. Internal transfers must have non-blank, distinct from/to IDs and a
 * positive amount (they are metadata only and net-zero by construction, so they
 * do not affect totals; validation runs even when setup is incomplete).
 *
 * This module is pure: no database, session, network or React imports.
 *
 * @module lib/finance/forecast
 */

import {
  addCents,
  CentsError,
  isCents,
  subCents,
  type Cents,
} from "@/lib/finance/money";

/** A current account balance entry. `amount: null` means never entered. */
export interface BalanceEntry {
  readonly id: string;
  /** Cents (may be negative for overdraft), or `null` when never entered. */
  readonly amount: Cents | null;
}

/** An expected income stream for the month. */
export interface PendingIncome {
  readonly id: string;
  readonly expected: Cents;
  readonly receivedCents: Cents;
}

/** An ordinary expense/budget item. `paidCents` are active settlements. */
export interface OrdinaryExpense {
  readonly id: string;
  readonly planned: Cents;
  readonly paidCents: Cents;
  /**
   * Optional: when this ordinary entry is a presentation of a reserved
   * commitment, the id of the matching {@link ReservedCommitment}. The reserve
   * must exist with a matching representation; the ordinary entry is then
   * excluded from E (counted once in R).
   */
  readonly linkedReserveId?: string;
}

/**
 * A reserved commitment (e.g. future taxes), additional to savings.
 *
 * Reserve contract (corrected): the caller supplies `planned` (the gross
 * protected total / planned amount) and `paidCents` (amount already paid
 * against it). The protected outstanding contribution to R is
 * `planned - paidCents`. The field is named `planned` so the contract is
 * unambiguous: the caller supplies the planned/protected total plus paid, and
 * the module subtracts paid exactly once. There is no separate `outstanding`
 * field that would be subtracted again by paid.
 */
export interface ReservedCommitment {
  readonly id: string;
  /** Gross protected/planned total of the reserve. */
  readonly planned: Cents;
  /** Amount already paid against this reserve. */
  readonly paidCents: Cents;
}

/** Internal transfer metadata (net-zero by construction; informational only). */
export interface InternalTransfer {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amount: Cents;
}

/** Inputs for {@link computeForecast}. */
export interface ForecastInput {
  readonly balances: readonly BalanceEntry[];
  readonly pendingIncome: readonly PendingIncome[];
  readonly ordinaryExpenses: readonly OrdinaryExpense[];
  readonly reservedCommitments: readonly ReservedCommitment[];
  readonly internalTransfers: readonly InternalTransfer[];
  /** `null` means "never entered" -> setup-incomplete. */
  readonly savingsTarget: Cents | null;
}

/** Result of {@link computeForecast}. */
export interface ForecastResult {
  /** true when required inputs are missing (unentered balance or null target). */
  readonly setupIncomplete: boolean;
  readonly balancesTotal: Cents;
  readonly pendingIncomeRemaining: Cents;
  readonly ordinaryUnpaid: Cents;
  readonly reservedOutstanding: Cents;
  /** null when setup-incomplete. */
  readonly projectedFreeToSpend: Cents | null;
  /** null when setup-incomplete. */
  readonly cashBackedFreeToSpend: Cents | null;
  /** Negative projected free-to-spend, or null when non-negative / incomplete. */
  readonly shortfall: Cents | null;
  /** true when some expected income has not yet been received (not cash). */
  readonly hasPendingIncomeCaveat: boolean;
}

function validateNonNegativeCents(value: Cents, label: string): void {
  if (!isCents(value)) {
    throw new CentsError(`${label} must be an integer number of cents`);
  }
  if (value < 0) {
    throw new CentsError(`${label} must be non-negative, got ${value}`);
  }
}

function validateId(id: unknown, label: string): void {
  if (typeof id !== "string" || id.trim() === "") {
    throw new CentsError(`${label} must be a non-blank string id`);
  }
}

interface DedupResult<T> {
  /** Map of id -> item (collapsed identical duplicates). */
  readonly byId: Map<string, T>;
  /** Set of ids that appeared more than once (for conflict detection). */
  readonly seenIds: Set<string>;
}

/**
 * Collapse entries by id. Identical duplicate representations are collapsed to
 * a single copy. Conflicting duplicate representations (different fields, even
 * when the derived value is equal) are rejected. Blank ids are rejected.
 */
function dedupById<T extends { id: string }>(
  items: readonly T[],
  label: string,
  sameRep: (a: T, b: T) => boolean,
): Map<string, T> {
  const byId = new Map<string, T>();
  for (const item of items) {
    validateId(item.id, `${label} id`);
    const existing = byId.get(item.id);
    if (existing === undefined) {
      byId.set(item.id, item);
      continue;
    }
    if (sameRep(existing, item)) {
      // identical duplicate: keep one copy (no double count)
      continue;
    }
    throw new CentsError(
      `Conflicting duplicate ${label} id "${item.id}" — cannot choose between contradictory representations`,
    );
  }
  return byId;
}

/** Structural equality for balance entries (ignoring object identity). */
function sameBalance(a: BalanceEntry, b: BalanceEntry): boolean {
  return a.amount === b.amount;
}

/** Structural equality for income entries. */
function sameIncome(a: PendingIncome, b: PendingIncome): boolean {
  return a.expected === b.expected && a.receivedCents === b.receivedCents;
}

/** Structural equality for ordinary expense entries (including link). */
function sameOrdinary(a: OrdinaryExpense, b: OrdinaryExpense): boolean {
  return (
    a.planned === b.planned &&
    a.paidCents === b.paidCents &&
    a.linkedReserveId === b.linkedReserveId
  );
}

/** Structural equality for reserve entries. */
function sameReserve(a: ReservedCommitment, b: ReservedCommitment): boolean {
  return a.planned === b.planned && a.paidCents === b.paidCents;
}

/**
 * Compute the month forecast from the given inputs.
 *
 * @throws {CentsError} when any individual entry is invalid (negative planned,
 *   paid > planned, negative outstanding, conflicting duplicate ids, missing
 *   reserve link, negative transfer, identical transfer ids, overflow). Does
 *   not throw for setup-incomplete inputs; those return `setupIncomplete: true`.
 */
export function computeForecast(input: ForecastInput): ForecastResult {
  // --- Balances: dedup by id, reject conflicting duplicates, detect unentered ---
  const balanceById = dedupById(input.balances, "Balance", sameBalance);
  let balancesTotal: Cents = 0 as Cents;
  let hasUnenteredBalance = false;
  let hasEnteredBalance = false;
  for (const b of balanceById.values()) {
    if (b.amount === null) {
      hasUnenteredBalance = true;
      continue;
    }
    if (!isCents(b.amount)) {
      throw new CentsError("Balance amount must be an integer number of cents");
    }
    hasEnteredBalance = true;
    balancesTotal = addCents(balancesTotal, b.amount);
  }

  // --- Income: validate non-negativity, dedup, remaining = max(expected - received, 0) ---
  const incomeById = dedupById(input.pendingIncome, "Income", sameIncome);
  let pendingIncomeRemaining: Cents = 0 as Cents;
  for (const i of incomeById.values()) {
    validateNonNegativeCents(i.expected, "Income expected");
    validateNonNegativeCents(i.receivedCents, "Income received");
    if (i.receivedCents > i.expected) {
      throw new CentsError("Income received exceeds expected");
    }
    pendingIncomeRemaining = addCents(
      pendingIncomeRemaining,
      subCents(i.expected, i.receivedCents),
    );
  }

  // --- Reserves: validate, dedup, outstanding = planned - paid ---
  const reserveById = dedupById(
    input.reservedCommitments,
    "Reserve",
    sameReserve,
  );
  const reserveIds = new Set<string>(reserveById.keys());
  let reservedOutstanding: Cents = 0 as Cents;
  for (const r of reserveById.values()) {
    validateNonNegativeCents(r.planned, "Reserve planned");
    validateNonNegativeCents(r.paidCents, "Reserve paid");
    if (r.paidCents > r.planned) {
      throw new CentsError("Reserve paid exceeds planned");
    }
    reservedOutstanding = addCents(
      reservedOutstanding,
      subCents(r.planned, r.paidCents),
    );
  }

  // --- Ordinary: validate, dedup, exclude linked reserves from E ---
  const ordinaryById = dedupById(
    input.ordinaryExpenses,
    "Ordinary expense",
    sameOrdinary,
  );
  // Cross-category same-ID guard: an ordinary expense and a reserve sharing the
  // same id without an explicit linkedReserveId is ambiguous — reject rather
  // than guessing whether the ordinary entry is a presentation of the reserve.
  for (const ordinaryId of ordinaryById.keys()) {
    if (reserveIds.has(ordinaryId)) {
      const ord = ordinaryById.get(ordinaryId)!;
      if (ord.linkedReserveId === undefined) {
        throw new CentsError(
          `Ordinary expense "${ordinaryId}" shares id with a reserve but has no linkedReserveId — cannot guess the relationship`,
        );
      }
    }
  }
  let ordinaryUnpaid: Cents = 0 as Cents;
  for (const e of ordinaryById.values()) {
    validateNonNegativeCents(e.planned, "Ordinary expense planned");
    validateNonNegativeCents(e.paidCents, "Ordinary expense paid");
    if (e.paidCents > e.planned) {
      throw new CentsError("Ordinary expense paid exceeds planned");
    }
    if (e.linkedReserveId !== undefined) {
      validateId(e.linkedReserveId, "Ordinary expense linkedReserveId");
      const linked = reserveById.get(e.linkedReserveId);
      if (linked === undefined) {
        throw new CentsError(
          `Ordinary expense "${e.id}" links to missing reserve "${e.linkedReserveId}"`,
        );
      }
      // The ordinary entry must match the reserve representation exactly.
      if (!sameReserve(linked, { id: e.linkedReserveId, planned: e.planned, paidCents: e.paidCents })) {
        throw new CentsError(
          `Ordinary expense "${e.id}" linkedReserveId "${e.linkedReserveId}" has a contradictory representation`,
        );
      }
      // Counted once in R; skip it in E.
      continue;
    }
    ordinaryUnpaid = addCents(
      ordinaryUnpaid,
      subCents(e.planned, e.paidCents),
    );
  }

  // --- Internal transfers: metadata only, but validate even when incomplete ---
  for (const t of input.internalTransfers) {
    validateId(t.fromAccountId, "Transfer fromAccountId");
    validateId(t.toAccountId, "Transfer toAccountId");
    if (t.fromAccountId === t.toAccountId) {
      throw new CentsError("Transfer from and to accounts must be distinct");
    }
    validateNonNegativeCents(t.amount, "Transfer amount");
    if (t.amount <= 0) {
      throw new CentsError("Transfer amount must be strictly positive");
    }
  }

  const savingsTarget = input.savingsTarget;
  // Incomplete account setup must not bypass validation of a supplied target.
  if (savingsTarget !== null) {
    validateNonNegativeCents(savingsTarget, "Savings target");
  }

  const setupIncomplete =
    hasUnenteredBalance || balanceById.size === 0 || savingsTarget === null;

  if (setupIncomplete) {
    return {
      setupIncomplete: true,
      balancesTotal: hasEnteredBalance ? balancesTotal : (0 as Cents),
      pendingIncomeRemaining,
      ordinaryUnpaid,
      reservedOutstanding,
      projectedFreeToSpend: null,
      cashBackedFreeToSpend: null,
      shortfall: null,
      hasPendingIncomeCaveat: pendingIncomeRemaining > 0,
    };
  }

  const target = savingsTarget as Cents;
  validateNonNegativeCents(target, "Savings target");

  // Projected free-to-spend = B + I - E - R - S
  const projected = subCents(
    subCents(
      subCents(addCents(balancesTotal, pendingIncomeRemaining), ordinaryUnpaid),
      reservedOutstanding,
    ),
    target,
  );

  // Cash-backed free-to-spend = B - E - R - S
  const cashBacked = subCents(
    subCents(subCents(balancesTotal, ordinaryUnpaid), reservedOutstanding),
    target,
  );

  const shortfall = projected < (0 as Cents) ? projected : null;

  return {
    setupIncomplete: false,
    balancesTotal,
    pendingIncomeRemaining,
    ordinaryUnpaid,
    reservedOutstanding,
    projectedFreeToSpend: projected,
    cashBackedFreeToSpend: cashBacked,
    shortfall,
    hasPendingIncomeCaveat: pendingIncomeRemaining > 0,
  };
}