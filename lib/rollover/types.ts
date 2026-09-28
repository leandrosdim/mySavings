// Month rollover service shared types and errors.
//
// Rollover is the guided transition from a source open month to the next
// calendar month. It is a two-phase operation:
//   1. Preview: read-only snapshot of what *would* happen — proposed recurring
//      instances from active templates, outstanding ordinary obligations that
//      would carry by reference (SAME row, never a duplicate), persistent
//      reserved commitments, the prior savings target as a reviewable default,
//      and any expired/unresolved expected income that requires an explicit
//      decision (it is NOT silently assumed to be new reliable income).
//   2. Apply: atomically, on one checked-out client with owner/month locking,
//      create the next-month plan (if absent), generate recurring instances,
//      carry unpaid ordinary obligations by updating current_month_key on the
//      SAME row (preserving original_month_key, planned_cents and all
//      settlement history), and optionally release selected ordinary items.
//      Reserves are NOT duplicated and are NOT auto-released; they persist by
//      reference until explicitly released through their own workflow.
//
// Invariants enforced by the service layer:
// - Source month must be OPEN. Rollover does not auto-close (closing is
//   Step15). Closed source months are rejected.
// - Accounts are continuous: balances are NEVER copied into new accounts or
//   month-balance rows as spendable duplicates.
// - Future template changes do not alter prior-month entries. Generation uses
//   template values at apply time; existing generated instances keep their
//   amount.
// - Apply is idempotent: a stable operation_key + payload hash deduplicates
//   retries. Re-running with the same key and matching payload returns the
//   original result summary; a changed payload is rejected.
// - A stale preview (one whose input digest no longer matches the live source
//   state because a concurrent payment/template edit changed relevant inputs)
//   is rejected on apply — the user must re-review. We never silently apply an
//   old remainder.
// - Old payments stay old-period facts: a settlement's business_date is never
//   rewritten. The obligation's current_month_key moves forward but its
//   settlement history stays where it was recorded.

import type { OwnerId, MonthKey } from "../months/types";
import type { Cents } from "../finance/money";

// --- Preview line items ---

/** An ordinary obligation that would carry forward to the next month. */
export type CarryoverObligationPreview = {
  id: string;
  title: string;
  plannedCents: Cents;
  paidCents: Cents;
  remainingCents: Cents;
  originalMonthKey: MonthKey;
  /** True when the obligation has no template origin (manual one-off). */
  fromTemplate: boolean;
};

/** A recurring template that would generate a new instance next month. */
export type RecurringInstancePreview = {
  templateId: string;
  name: string;
  kind: "ordinary" | "reserved" | "income";
  defaultAmountCents: Cents;
  dueDayOfMonth: number | null;
  /** A generated instance already exists for next month (re-run safety). */
  alreadyGenerated: boolean;
};

/** A persistent reserved commitment (carries by reference, not duplicated). */
export type ReservedCarryoverPreview = {
  id: string;
  title: string;
  plannedCents: Cents;
  paidCents: Cents;
  remainingCents: Cents;
  originalMonthKey: MonthKey;
};

/** An expired/unresolved income expectation from the source month. */
export type UnresolvedIncomePreview = {
  id: string;
  sourceName: string;
  expectedCents: Cents;
  receivedCents: Cents;
  pendingCents: Cents;
  monthKey: MonthKey;
};

/** The full read-only next-month preview. */
export type RolloverPreview = {
  sourceMonthKey: MonthKey;
  targetMonthKey: MonthKey;
  /** Next-month plan already exists (re-run / partial apply safety). */
  targetPlanExists: boolean;
  /** Default savings target copied from the source plan (reviewable). */
  proposedSavingsTargetCents: Cents;
  /** Source plan has no savings target set (0 is explicit, missing is null). */
  sourceHasTarget: boolean;
  recurringInstances: RecurringInstancePreview[];
  carryoverObligations: CarryoverObligationPreview[];
  reservedCarryover: ReservedCarryoverPreview[];
  unresolvedIncome: UnresolvedIncomePreview[];
  /**
   * Stable digest of the source-month inputs at preview time. Apply sends this
   * back; if the live state has changed (concurrent payment/template edit),
   * apply is rejected as a stale preview.
   */
  previewDigest: string;
};

// --- Apply input / result ---

/** A carryover item the user chose to release instead of carrying. */
export type ReleaseChoice = {
  obligationId: string;
};

/** Input for applying a rollover. */
export type ApplyRolloverInput = {
  sourceMonthKey: MonthKey;
  /** Reviewable savings target for the next month (defaults to source). */
  savingsTargetCents: Cents;
  /** The preview digest from the preview the user reviewed. */
  previewDigest: string;
  /** Ordinary obligation IDs to release (not carry). Reserves cannot be released here. */
  releaseChoices: ReleaseChoice[];
  /**
   * Unresolved income expectation IDs from the source month to carry forward
   * as a new expectation in the next month. Others are dropped (the user
   * explicitly chose not to rely on them again).
   */
  carryIncomeIds: string[];
  /** Stable idempotency key (owner-scoped). */
  idempotencyKey: string;
};

/** Result of applying a rollover. */
export type ApplyRolloverResult = {
  sourceMonthKey: MonthKey;
  targetMonthKey: MonthKey;
  targetPlanCreated: boolean;
  savingsTargetCents: Cents;
  generatedObligations: number;
  generatedIncome: number;
  skippedObligations: number;
  skippedIncome: number;
  carriedObligations: number;
  releasedObligations: number;
  carriedIncome: number;
  /** Whether this was an idempotent replay (no new writes). */
  replay: boolean;
};

export type { OwnerId, MonthKey, Cents };

// --- Error hierarchy ---

export class RolloverServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RolloverServiceError";
    this.code = code;
  }
}

export class RolloverValidationError extends RolloverServiceError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "RolloverValidationError";
  }
}

export class RolloverConflictError extends RolloverServiceError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "RolloverConflictError";
  }
}

/** The source month is closed; rollover refuses to run. */
export class RolloverClosedMonthError extends RolloverServiceError {
  constructor(message: string) {
    super("CLOSED_MONTH", message);
    this.name = "RolloverClosedMonthError";
  }
}

/** The preview digest no longer matches live state; re-review required. */
export class RolloverStalePreviewError extends RolloverServiceError {
  constructor(message: string) {
    super("STALE_PREVIEW", message);
    this.name = "RolloverStalePreviewError";
  }
}

/** Idempotency key reused with a different payload. */
export class RolloverIdempotencyConflictError extends RolloverServiceError {
  constructor(message: string) {
    super("IDEMPOTENCY_CONFLICT", message);
    this.name = "RolloverIdempotencyConflictError";
  }
}