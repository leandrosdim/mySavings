// Income expectation service shared types and errors.
//
// An income expectation is an expected monthly income entry. It has its own
// receipt history (income_receipts). Receipts add to the account balance or
// are already reflected. The expected_cents is preserved; received/pending are
// derived from non-reversed receipts.
//
// The service layer is owner-scoped: every function takes an ownerId derived
// from the verified server session inside the trusted boundary.

import type { OwnerId, MonthKey } from "../months/types";

/** Income expectation identifier as a string (BIGINT from the DB). */
export type IncomeId = string;

/** Income expectation status. */
export type IncomeStatus = "active" | "received" | "cancelled";

/** An income expectation row as returned to callers, with derived receipt totals. */
export type IncomeExpectation = {
  id: IncomeId;
  monthKey: MonthKey;
  sourceName: string;
  expectedCents: number;
  linkedAccountId: string | null;
  originTemplateId: string | null;
  status: IncomeStatus;
  receivedCents: number;
  pendingCents: number;
  createdAt: string;
  updatedAt: string;
};

/** Input for creating an income expectation. */
export type CreateIncomeInput = {
  monthKey: MonthKey;
  sourceName: string;
  expectedCents: number;
  linkedAccountId?: string | null;
};

/** Input for updating an income expectation. */
export type UpdateIncomeInput = {
  sourceName?: string;
  expectedCents?: number;
  linkedAccountId?: string | null;
};

/** Result of creating an income expectation. */
export type CreateIncomeResult = {
  income: IncomeExpectation;
};

/** Result of updating an income expectation. */
export type UpdateIncomeResult = {
  income: IncomeExpectation;
};

/** Result of cancelling an income expectation. */
export type CancelIncomeResult = {
  income: IncomeExpectation;
};

/** Filter for listing income expectations. */
export type IncomeFilter = {
  monthKey?: MonthKey;
  status?: IncomeStatus;
};

// --- Error hierarchy ---

export class IncomeServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IncomeServiceError";
    this.code = code;
  }
}

export class IncomeValidationError extends IncomeServiceError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "IncomeValidationError";
  }
}

export class IncomeNotFoundError extends IncomeServiceError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "IncomeNotFoundError";
  }
}

export class IncomeConflictError extends IncomeServiceError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "IncomeConflictError";
  }
}

export class IncomeClosedMonthError extends IncomeServiceError {
  constructor(message: string) {
    super("CLOSED_MONTH", message);
    this.name = "IncomeClosedMonthError";
  }
}

export class ReceiptHistoryError extends IncomeServiceError {
  constructor(message: string) {
    super("RECEIPT_HISTORY", message);
    this.name = "ReceiptHistoryError";
  }
}

export type { OwnerId, MonthKey };