// Obligation service shared types and errors.
//
// An obligation is an ordinary monthly expense or a reserved commitment with
// durable identity. The id is immutable and persists across months for
// carryover. The planned_cents is immutable once written; partial settlements
// do not zero it. Remaining is derived from non-reversed settlements.
//
// The service layer is owner-scoped: every function takes an ownerId derived
// from the verified server session inside the trusted boundary (route
// handlers / server components). No function accepts arbitrary unvalidated
// owner input from clients.

import type { OwnerId, MonthKey } from "../months/types";

/** Obligation identifier as a string (BIGINT from the DB). */
export type ObligationId = string;

/** Obligation kind: ordinary expense or reserved commitment. */
export type ObligationKind = "ordinary" | "reserved";

/** Obligation status. */
export type ObligationStatus = "active" | "settled" | "released" | "cancelled";

/** An obligation row as returned to callers, with derived settlement totals. */
export type Obligation = {
  id: ObligationId;
  kind: ObligationKind;
  title: string;
  plannedCents: number;
  originalMonthKey: MonthKey;
  currentMonthKey: MonthKey;
  dueDate: string | null;
  linkedAccountId: string | null;
  originTemplateId: string | null;
  linkedReserveId: string | null;
  status: ObligationStatus;
  paidCents: number;
  remainingCents: number;
  createdAt: string;
  updatedAt: string;
};

/** Input for creating an obligation. */
export type CreateObligationInput = {
  kind: ObligationKind;
  title: string;
  plannedCents: number;
  monthKey: MonthKey;
  dueDate?: string | null;
  linkedAccountId?: string | null;
  /**
   * Optional link from an ordinary expense to a reserved commitment it
   * presents. When set, the ordinary expense is counted once in R (via the
   * reserve) and excluded from E so aggregation never double-counts the same
   * liability. Only an ordinary obligation may carry a linkedReserveId; a
   * reserved obligation must not link to another reserve.
   */
  linkedReserveId?: string | null;
};

/** Input for updating an obligation. */
export type UpdateObligationInput = {
  title?: string;
  plannedCents?: number;
  dueDate?: string | null;
  linkedAccountId?: string | null;
  linkedReserveId?: string | null;
};

/** Result of creating an obligation. */
export type CreateObligationResult = {
  obligation: Obligation;
};

/** Result of updating an obligation. */
export type UpdateObligationResult = {
  obligation: Obligation;
};

/** Result of cancelling an obligation. */
export type CancelObligationResult = {
  obligation: Obligation;
};

/** Result of deleting a released obligation with no payment history. */
export type DeleteObligationResult = {
  obligationId: ObligationId;
};

/** Result of releasing an obligation's unpaid remainder. */
export type ReleaseObligationResult = {
  obligation: Obligation;
};

/** Filter for listing obligations. */
export type ObligationFilter = {
  monthKey?: MonthKey;
  kind?: ObligationKind;
  status?: ObligationStatus;
  includeReserved?: boolean;
};

// --- Error hierarchy ---
//
// Service errors carry a stable `code` so route handlers can map them to
// HTTP status codes without inspecting message text. All messages are
// safe to return to the caller (no internal IDs, SQL or credentials).

export class ObligationServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ObligationServiceError";
    this.code = code;
  }
}

export class ObligationValidationError extends ObligationServiceError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "ObligationValidationError";
  }
}

export class ObligationNotFoundError extends ObligationServiceError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "ObligationNotFoundError";
  }
}

export class ObligationConflictError extends ObligationServiceError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "ObligationConflictError";
  }
}

export class ClosedMonthError extends ObligationServiceError {
  constructor(message: string) {
    super("CLOSED_MONTH", message);
    this.name = "ClosedMonthError";
  }
}

export class SettledHistoryError extends ObligationServiceError {
  constructor(message: string) {
    super("SETTLED_HISTORY", message);
    this.name = "SettledHistoryError";
  }
}

export type { OwnerId, MonthKey };