// Account service shared types and errors.
//
// The service layer is owner-scoped: every function takes an ownerId derived
// from the verified server session inside the trusted boundary (route
// handlers / server actions). No function accepts arbitrary unvalidated
// owner input from clients.

import type { Cents } from "../finance/money";

/** Owner identifier as a string (BIGINT from the verified session). */
export type OwnerId = string;

/** Account identifier as a string (BIGINT from the DB). */
export type AccountId = string;

/** Transfer identifier as a string. */
export type TransferId = string;

/** Adjustment identifier as a string. */
export type AdjustmentId = string;

/** A single account row as returned to callers. */
export type Account = {
  id: AccountId;
  name: string;
  currentBalanceCents: number | null;
  balanceAsOf: string | null;
  trackBalance: boolean;
  archived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Result of a balance refresh. */
export type BalanceRefreshResult = {
  accountId: AccountId;
  previousBalanceCents: number | null;
  newBalanceCents: number;
  differenceCents: number;
  newVersion: number;
  asOf: string;
};

/** Result of an internal transfer. */
export type TransferResult = {
  transferId: TransferId;
  fromAccountId: AccountId;
  toAccountId: AccountId;
  amountCents: number;
  fromAccountNewBalance: number | null;
  toAccountNewBalance: number | null;
  businessDate: string;
};

/** Result of account creation. */
export type CreateAccountResult = {
  account: Account;
};

/** Result of account rename. */
export type RenameAccountResult = {
  account: Account;
};

/** Result of account archive. */
export type ArchiveAccountResult = {
  account: Account;
};

/** Input for creating an account. */
export type CreateAccountInput = {
  name: string;
  initialBalanceCents: number | null;
  trackBalance: boolean;
};

/** Input for refreshing a balance. */
export type RefreshBalanceInput = {
  accountId: AccountId;
  newBalanceCents: Cents;
  asOf: Date;
  expectedVersion: number;
  idempotencyKey: string;
  reason?: string;
};

/** Input for an internal transfer. */
export type TransferInput = {
  fromAccountId: AccountId;
  toAccountId: AccountId;
  amountCents: Cents;
  businessDate: string;
  idempotencyKey: string;
};

// --- Error hierarchy ---
//
// Service errors carry a stable `code` so route handlers can map them to
// HTTP status codes without inspecting message text. All messages are
// safe to return to the caller (no internal IDs, SQL or credentials).

export class AccountServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AccountServiceError";
    this.code = code;
  }
}

export class ValidationError extends AccountServiceError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AccountServiceError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AccountServiceError {
  readonly currentVersion: number | null;
  constructor(message: string, currentVersion?: number) {
    super("CONFLICT", message);
    this.name = "ConflictError";
    this.currentVersion = typeof currentVersion === "number" ? currentVersion : null;
  }
}

export class ArchiveRestrictedError extends AccountServiceError {
  constructor(message: string) {
    super("ARCHIVE_RESTRICTED", message);
    this.name = "ArchiveRestrictedError";
  }
}

export class IdempotencyConflictError extends AccountServiceError {
  constructor(message: string) {
    super("IDEMPOTENCY_CONFLICT", message);
    this.name = "IdempotencyConflictError";
  }
}