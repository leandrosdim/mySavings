/**
 * Partial settlement engine for mySavings.
 *
 * Keeps planned amounts immutable, sums active (non-reversed) settlements,
 * rejects overpayment and derives an unpaid/partial/paid state. This module
 * is pure: it does not touch the database, sessions or React.
 *
 * Reversal semantics (corrected): a settlement with `reversed: true` marks an
 * ORIGINAL settlement that has been reversed and is therefore EXCLUDED from the
 * paid total. It is NOT a negative unlinked compensating amount that is
 * subtracted again. `computePaid([{ amount: 4000, reversed: true }])` is `0`,
 * and the remaining on an 8000 plan is `8000`. The future Step10 DB layer will
 * store immutable reversal entries; this pure read model simply skips reversed
 * rows when summing active paid amounts.
 *
 * Every exported helper validates its inputs: settlement amounts must be
 * strictly positive safe cents, `reversed` must be a boolean, and `planned`
 * must be a non-negative safe cents value. Overpaid histories (active paid >
 * planned) are rejected rather than producing negative remainders or a paid
 * status. `settlePayment` returns `{ ok: false }` for any invalid input
 * (including an invalid planned value) instead of throwing unexpectedly.
 *
 * See `docs/financial-rules.md` for the canonical 80/40/40 gas scenario and the
 * "preserve planned, never zero the original amount" rule.
 *
 * @module lib/finance/settlements
 */

import {
  addCents,
  CentsError,
  cents,
  isCents,
  subCents,
  type Cents,
} from "@/lib/finance/money";

/** A single settlement (partial payment or receipt) against an obligation. */
export interface Settlement {
  /** Strictly positive amount in cents at the time it was recorded. */
  readonly amount: Cents;
  /**
   * When `true`, this ORIGINAL settlement has been reversed and is excluded
   * from the paid total. It is not a negative compensating amount.
   */
  readonly reversed: boolean;
}

/** Derived settlement state of an obligation. */
export enum SettlementStatus {
  Unpaid = "unpaid",
  Partial = "partial",
  Paid = "paid",
}

export type SettlementState = SettlementStatus;

/**
 * Validate a single historical settlement entry.
 *
 * `amount` must be a strictly positive safe cents value and `reversed` must be
 * a boolean. Throws {@link CentsError} on any violation.
 */
function validateSettlement(s: Settlement, index: number): void {
  if (typeof s !== "object" || s === null) {
    throw new CentsError(`Settlement at index ${index} must be an object`);
  }
  if (typeof s.reversed !== "boolean") {
    throw new CentsError(
      `Settlement at index ${index} has an invalid reversed flag (must be boolean)`,
    );
  }
  if (!isCents(s.amount)) {
    throw new CentsError(
      `Settlement at index ${index} has an invalid amount (must be safe integer cents)`,
    );
  }
  if (s.amount <= 0) {
    throw new CentsError(
      `Settlement at index ${index} amount must be strictly positive, got ${s.amount}`,
    );
  }
}

/** Validate an array of historical settlements. */
function validateSettlements(settlements: readonly Settlement[]): void {
  for (let i = 0; i < settlements.length; i++) {
    validateSettlement(settlements[i], i);
  }
}

/**
 * Validate a planned amount is a non-negative safe cents value.
 * Throws {@link CentsError} on violation.
 */
function validatePlanned(planned: Cents): void {
  if (!isCents(planned)) {
    throw new CentsError("Planned amount must be a safe integer number of cents");
  }
  if (planned < 0) {
    throw new CentsError(`Planned amount must be non-negative, got ${planned}`);
  }
}

/**
 * Net paid = sum of active (non-reversed) settlements. Reversed settlements are
 * excluded (the original is skipped), never subtracted as negative amounts.
 *
 * @throws {CentsError} if any settlement has a non-positive amount, a
 *   non-boolean `reversed` flag, or an out-of-bounds/overflowing total.
 */
export function computePaid(settlements: readonly Settlement[]): Cents {
  validateSettlements(settlements);
  let acc: Cents = 0 as Cents;
  for (const s of settlements) {
    if (!s.reversed) {
      acc = addCents(acc, s.amount);
    }
  }
  return acc;
}

/**
 * Remaining = planned - active paid settlements.
 *
 * @throws {CentsError} if `planned` is invalid, any settlement is malformed,
 *   or the history is overpaid (active paid > planned) — never returns a
 *   negative remainder for a valid history.
 */
export function computeRemaining(
  planned: Cents,
  settlements: readonly Settlement[],
): Cents {
  validatePlanned(planned);
  const paid = computePaid(settlements);
  if (paid > planned) {
    throw new CentsError(
      `Overpaid history: active paid ${paid} exceeds planned ${planned}`,
    );
  }
  return subCents(planned, paid);
}

/**
 * Derive {@link SettlementStatus} from planned and settlements.
 *
 * Zero-plan status: when `planned` is `0` and there are no active settlements,
 * the status is `Unpaid` (nothing is owed, nothing has been paid). A strictly
 * positive payment against a zero plan is rejected as overpayment before
 * reaching this point.
 *
 * @throws {CentsError} if `planned` is invalid, any settlement is malformed,
 *   or the history is overpaid.
 */
export function settlementStatus(
  planned: Cents,
  settlements: readonly Settlement[],
): SettlementStatus {
  validatePlanned(planned);
  const paid = computePaid(settlements);
  if (paid > planned) {
    throw new CentsError(
      `Overpaid history: active paid ${paid} exceeds planned ${planned}`,
    );
  }
  if (paid <= 0) return SettlementStatus.Unpaid;
  if (paid >= planned) return SettlementStatus.Paid;
  return SettlementStatus.Partial;
}

/** Input for {@link settlePayment}. */
export interface SettlePaymentInput {
  readonly planned: Cents;
  readonly settlements: readonly Settlement[];
  readonly payment: Cents;
}

/** Successful settlement result. */
export interface SettlePaymentOk {
  readonly ok: true;
  readonly settlements: Settlement[];
  readonly paid: Cents;
  readonly remaining: Cents;
  readonly state: SettlementStatus;
}

/** Failed settlement result (overpayment, nonpositive or invalid payment). */
export interface SettlePaymentErr {
  readonly ok: false;
  readonly settlements: readonly Settlement[];
  readonly reason: string;
}

export type SettlePaymentResult = SettlePaymentOk | SettlePaymentErr;

/**
 * Apply a new partial payment to an obligation.
 *
 * Rules (from `docs/financial-rules.md`):
 * - `planned` must be a non-negative safe cents value
 * - existing settlements must be a valid history (strictly positive amounts,
 *   boolean reversed flags, not overpaid)
 * - `payment` must be a strictly positive safe cents value
 * - the new active total must not exceed planned (reject overpayment in v1)
 * - the planned amount is never mutated; only settlements grow
 * - inputs are never mutated; a new settlements array is returned on success
 *
 * On any failure returns `{ ok: false, settlements: <unchanged>, reason }` so
 * callers can present a user-facing error without catching exceptions. Overflow
 * during paid-total computation is also reported as `ok: false`.
 */
export function settlePayment(input: SettlePaymentInput): SettlePaymentResult {
  const { planned, settlements, payment } = input;

  if (!isCents(planned) || planned < 0) {
    return {
      ok: false,
      settlements,
      reason: "Planned amount must be a non-negative integer number of cents",
    };
  }

  try {
    validateSettlements(settlements);
  } catch (e) {
    return {
      ok: false,
      settlements,
      reason: e instanceof CentsError ? e.message : "Invalid settlement history",
    };
  }

  let paidBefore: Cents;
  try {
    paidBefore = computePaid(settlements);
  } catch (e) {
    return {
      ok: false,
      settlements,
      reason: e instanceof CentsError ? e.message : "Invalid settlement history",
    };
  }

  if (paidBefore > planned) {
    return {
      ok: false,
      settlements,
      reason: "Existing history is overpaid",
    };
  }

  if (!isCents(payment)) {
    return {
      ok: false,
      settlements,
      reason: "Payment must be an integer number of cents",
    };
  }
  if (payment <= 0) {
    return {
      ok: false,
      settlements,
      reason: "Payment must be strictly positive",
    };
  }

  let paidAfter: Cents;
  try {
    paidAfter = addCents(paidBefore, payment);
  } catch (e) {
    return {
      ok: false,
      settlements,
      reason: e instanceof CentsError ? e.message : "Payment amount overflows",
    };
  }

  if (paidAfter > planned) {
    return {
      ok: false,
      settlements,
      reason: "Payment would overpay the planned amount",
    };
  }

  const newSettlements: Settlement[] = [...settlements, { amount: payment, reversed: false }];
  const remaining = subCents(planned, paidAfter);
  const state =
    paidAfter >= planned
      ? SettlementStatus.Paid
      : paidAfter > 0
        ? SettlementStatus.Partial
        : SettlementStatus.Unpaid;

  return {
    ok: true,
    settlements: newSettlements,
    paid: paidAfter,
    remaining,
    state,
  };
}

/**
 * Convenience: construct an active settlement. Throws {@link CentsError} if
 * `amount` is not a strictly positive safe integer.
 */
export function activeSettlement(amount: number): Settlement {
  const c = cents(amount);
  if (c <= 0) {
    throw new CentsError(`Active settlement amount must be strictly positive, got ${c}`);
  }
  return { amount: c, reversed: false };
}

/**
 * Convenience: construct a reversed (original excluded) settlement. Throws
 * {@link CentsError} if `amount` is not a strictly positive safe integer.
 */
export function reversedSettlement(amount: number): Settlement {
  const c = cents(amount);
  if (c <= 0) {
    throw new CentsError(`Reversed settlement amount must be strictly positive, got ${c}`);
  }
  return { amount: c, reversed: true };
}