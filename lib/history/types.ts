// Month closing and history service — shared types and errors.
//
// A closing snapshot is an immutable point-in-time record of a month's
// balances, forecast inputs/outputs, savings target and settlement totals at
// close time. Once a month is closed, its snapshot cannot be rewritten by later
// account refreshes, payments, reserve releases or target changes. Later
// corrections are compensating entries in an open period with linkage; v1 does
// not reopen a closed month.
//
// Provenance is a point-in-time copy of the per-account/obligation/income
// breakdown used to build the snapshot. It is read-only history, never a source
// of truth for settlements/payments. The historical detail/comparison view is
// built from provenance for closed months, while the live forecast is only used
// for the open/current month.
//
// The service layer is owner-scoped: every function takes an ownerId derived
// from the verified server session. No function accepts arbitrary unvalidated
// owner input. Every write uses withTransaction (explicit BEGIN/COMMIT/ROLLBACK
// on one checked-out client). Financial cents are exact integers bounded by
// lib/finance/money.

import type { Cents } from "../finance/money";
import type { OwnerId, MonthKey, PlanId } from "../months/types";

export type { OwnerId, MonthKey, PlanId };

// --- Snapshot types ---

/** A per-account balance captured in provenance. */
export type ProvenanceAccount = {
  id: string;
  name: string;
  balanceCents: number | null;
  balanceAsOf: string | null;
};

/** A per-obligation entry captured in provenance. */
export type ProvenanceObligation = {
  id: string;
  kind: "ordinary" | "reserved";
  title: string;
  plannedCents: number;
  paidCents: number;
  remainingCents: number;
  status: string;
  dueDate: string | null;
  linkedReserveId: string | null;
};

/** A per-income entry captured in provenance. */
export type ProvenanceIncome = {
  id: string;
  sourceName: string;
  expectedCents: number;
  receivedCents: number;
  pendingCents: number;
  status: string;
};

/** The immutable provenance payload stored alongside the snapshot. */
export type SnapshotProvenance = {
  accounts: ProvenanceAccount[];
  ordinaryExpenses: ProvenanceObligation[];
  reservedCommitments: ProvenanceObligation[];
  income: ProvenanceIncome[];
};

/** An immutable closing snapshot for a month. */
export type ClosingSnapshot = {
  id: string;
  ownerId: OwnerId;
  monthKey: MonthKey;
  balancesTotalCents: number;
  balancesAsOf: string | null;
  pendingIncomeRemainingCents: number;
  ordinaryUnpaidCents: number;
  reservedOutstandingCents: number;
  savingsTargetCents: number;
  projectedFreeToSpendCents: number | null;
  cashBackedFreeToSpendCents: number | null;
  settlementTotalCents: number;
  closedAt: string;
  provenance: SnapshotProvenance | null;
};

/** Summary row for the history list (no provenance payload). */
export type HistorySummary = {
  id: string;
  monthKey: MonthKey;
  status: "open" | "closed";
  closedAt: string | null;
  savingsTargetCents: number;
  balancesTotalCents: number | null;
  projectedFreeToSpendCents: number | null;
};

/** Result of closing a month. */
export type CloseMonthResult = {
  snapshot: ClosingSnapshot;
  planId: PlanId;
};

// --- Error hierarchy ---

export class HistoryServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HistoryServiceError";
    this.code = code;
  }
}

export class HistoryValidationError extends HistoryServiceError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "HistoryValidationError";
  }
}

export class HistoryNotFoundError extends HistoryServiceError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "HistoryNotFoundError";
  }
}

export class HistoryConflictError extends HistoryServiceError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "HistoryConflictError";
  }
}

export class ClosedMonthError extends HistoryServiceError {
  constructor(message: string) {
    super("CLOSED_MONTH", message);
    this.name = "ClosedMonthError";
  }
}

export type { Cents };