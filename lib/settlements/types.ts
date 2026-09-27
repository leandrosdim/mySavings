// Settlement service shared types and errors.
//
// A settlement is an immutable expense payment against an obligation. A receipt
// is an immutable income receipt against an income expectation. Both support
// two modes:
// - UPDATE_ACCOUNT: the account balance is changed atomically with a movement.
// - ALREADY_REFLECTED: a prior manual bank refresh already includes the amount;
//   no balance change or movement is created.
//
// Reversals are separate immutable rows (settlement_reversals /
// income_receipt_reversals) linked to the original. The original row is never
// UPDATEd. A reversal after a later manual balance refresh must not blindly
// credit/debit the account: the caller must decide whether to adjust the
// balance, because the refreshed balance already replaced the old value.
//
// The service layer is owner-scoped: every function takes an ownerId derived
// from the verified server session inside the trusted boundary (route handlers
// / server components). No function accepts arbitrary unvalidated owner input
// from clients.

import type { OwnerId } from "../months/types";

/** Settlement identifier as a string (BIGINT from the DB). */
export type SettlementId = string;

/** Receipt identifier as a string (BIGINT from the DB). */
export type ReceiptId = string;

/** Account identifier as a string (BIGINT from the DB). */
export type AccountId = string;

/** Obligation identifier as a string (BIGINT from the DB). */
export type ObligationId = string;

/** Income expectation identifier as a string (BIGINT from the DB). */
export type IncomeId = string;

/** Settlement/receipt balance mode. */
export type SettlementMode = "UPDATE_ACCOUNT" | "ALREADY_REFLECTED";

/** A settlement row as returned to callers. */
export type Settlement = {
  id: SettlementId;
  ownerId: OwnerId;
  obligationId: ObligationId;
  amountCents: number;
  mode: SettlementMode;
  accountId: string | null;
  businessDate: string;
  recordedAt: string;
  idempotencyKey: string;
  reversed: boolean;
};

/** A receipt row as returned to callers. */
export type Receipt = {
  id: ReceiptId;
  ownerId: OwnerId;
  incomeExpectationId: IncomeId;
  amountCents: number;
  mode: SettlementMode;
  accountId: string | null;
  businessDate: string;
  recordedAt: string;
  idempotencyKey: string;
  reversed: boolean;
};

/** Input for recording a payment (expense settlement). */
export type PayInput = {
  obligationId: ObligationId;
  amountCents: number;
  mode: SettlementMode;
  accountId: string | null;
  businessDate: string;
  idempotencyKey: string;
};

/** Result of recording a payment. */
export type PayResult = {
  settlementId: SettlementId;
  obligationId: ObligationId;
  amountCents: number;
  mode: SettlementMode;
  accountId: string | null;
  businessDate: string;
  paidCents: number;
  remainingCents: number;
  accountNewBalance: number | null;
  reversed: boolean;
};

/** Input for recording an income receipt. */
export type ReceiveInput = {
  incomeExpectationId: IncomeId;
  amountCents: number;
  mode: SettlementMode;
  accountId: string | null;
  businessDate: string;
  idempotencyKey: string;
};

/** Result of recording an income receipt. */
export type ReceiveResult = {
  receiptId: ReceiptId;
  incomeExpectationId: IncomeId;
  amountCents: number;
  mode: SettlementMode;
  accountId: string | null;
  businessDate: string;
  receivedCents: number;
  pendingCents: number;
  accountNewBalance: number | null;
  reversed: boolean;
};

/** Input for reversing a settlement. */
export type ReverseSettlementInput = {
  settlementId: SettlementId;
  businessDate: string;
  idempotencyKey: string;
  reason?: string;
  /**
   * Required when the original settlement used UPDATE_ACCOUNT AND the account
   * was manually refreshed after the settlement. When true, the account
   * balance is adjusted by the compensating credit. When false, the account
   * balance is left untouched (the refreshed balance already reflects
   * reality). When the account was NOT refreshed after the settlement, this
   * field is ignored and the balance is always reversed.
   */
  adjustBalanceAfterRefresh?: boolean;
};

/** Result of reversing a settlement. */
export type ReverseSettlementResult = {
  reversalId: string;
  originalSettlementId: SettlementId;
  obligationId: ObligationId;
  amountCents: number;
  businessDate: string;
  accountNewBalance: number | null;
  balanceWasAdjusted: boolean;
};

/** Input for reversing an income receipt. */
export type ReverseReceiptInput = {
  receiptId: ReceiptId;
  businessDate: string;
  idempotencyKey: string;
  reason?: string;
  adjustBalanceAfterRefresh?: boolean;
};

/** Result of reversing an income receipt. */
export type ReverseReceiptResult = {
  reversalId: string;
  originalReceiptId: ReceiptId;
  incomeExpectationId: IncomeId;
  amountCents: number;
  businessDate: string;
  accountNewBalance: number | null;
  balanceWasAdjusted: boolean;
};

// --- Error hierarchy ---
//
// Service errors carry a stable `code` so route handlers can map them to
// HTTP status codes without inspecting message text. All messages are
// safe to return to the caller (no internal IDs, SQL or credentials).

export class SettlementServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SettlementServiceError";
    this.code = code;
  }
}

export class SettlementValidationError extends SettlementServiceError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "SettlementValidationError";
  }
}

export class SettlementNotFoundError extends SettlementServiceError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "SettlementNotFoundError";
  }
}

export class SettlementConflictError extends SettlementServiceError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "SettlementConflictError";
  }
}

export class IdempotencyConflictError extends SettlementServiceError {
  constructor(message: string) {
    super("IDEMPOTENCY_CONFLICT", message);
    this.name = "IdempotencyConflictError";
  }
}

export class OverpaymentError extends SettlementServiceError {
  constructor(message: string) {
    super("OVERPAYMENT", message);
    this.name = "OverpaymentError";
  }
}

export class ClosedMonthError extends SettlementServiceError {
  constructor(message: string) {
    super("CLOSED_MONTH", message);
    this.name = "ClosedMonthError";
  }
}

export class AlreadyReversedError extends SettlementServiceError {
  constructor(message: string) {
    super("ALREADY_REVERSED", message);
    this.name = "AlreadyReversedError";
  }
}

export class RefreshReconciliationRequiredError extends SettlementServiceError {
  readonly settlementId: string | null;
  readonly accountRefreshedAfterSettlement: boolean;
  constructor(
    message: string,
    settlementId: string | null = null,
    accountRefreshedAfterSettlement = true,
  ) {
    super("REFRESH_RECONCILIATION_REQUIRED", message);
    this.name = "RefreshReconciliationRequiredError";
    this.settlementId = settlementId;
    this.accountRefreshedAfterSettlement = accountRefreshedAfterSettlement;
  }
}

export type { OwnerId };