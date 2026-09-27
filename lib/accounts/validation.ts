// Input validation for the account service.
//
// All validation is server-side and rejects before any DB write. Names are
// trimmed and length-bounded. Cents are validated against the safe-integer
// range via the existing lib/finance/money module. Dates are ISO YYYY-MM-DD.

import {
  cents,
  isCents,
  CentsError,
  type Cents,
} from "../finance/money";
import {
  ValidationError,
  type CreateAccountInput,
  type RefreshBalanceInput,
  type TransferInput,
} from "./types";

const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 100;
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
const MONTH_KEY_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

/** Validate and normalize an account name. Throws ValidationError on invalid. */
export function validateAccountName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ValidationError("Account name must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length < NAME_MIN_LENGTH) {
    throw new ValidationError("Account name must not be empty");
  }
  if (trimmed.length > NAME_MAX_LENGTH) {
    throw new ValidationError(
      `Account name must not exceed ${NAME_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

/** Validate an optional initial balance. null means never-entered. */
export function validateOptionalBalance(raw: unknown): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    throw new ValidationError("Initial balance must be an integer or null");
  }
  if (!isCents(raw)) {
    throw new ValidationError("Initial balance is out of safe bounds");
  }
  return raw;
}

/** Validate a required positive Cents amount (for transfers). */
export function validatePositiveCents(raw: unknown): Cents {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    throw new ValidationError("Amount must be an integer");
  }
  if (!isCents(raw)) {
    throw new ValidationError("Amount is out of safe bounds");
  }
  if (raw <= 0) {
    throw new ValidationError("Amount must be strictly positive");
  }
  return cents(raw);
}

/** Validate a required Cents balance (may be negative, may be zero). */
export function validateBalanceCents(raw: unknown): Cents {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    throw new ValidationError("Balance must be an integer");
  }
  if (!isCents(raw)) {
    throw new ValidationError("Balance is out of safe bounds");
  }
  return cents(raw);
}

/** Validate a business date string (ISO YYYY-MM-DD). Returns the trimmed string. */
export function validateBusinessDate(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ValidationError("Business date must be a string");
  }
  const trimmed = raw.trim();
  const match = trimmed.match(MONTH_KEY_RE);
  if (!match) {
    throw new ValidationError("Business date must be YYYY-MM-DD");
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ValidationError("Business date is not a valid calendar date");
  }
  return trimmed;
}

/** Validate an idempotency key. Must be a non-empty bounded string. */
export function validateIdempotencyKey(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ValidationError("Idempotency key must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Idempotency key must not be empty");
  }
  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new ValidationError(
      `Idempotency key must not exceed ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

/** Validate an optional reason string. */
export function validateOptionalReason(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new ValidationError("Reason must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > 500) {
    throw new ValidationError("Reason must not exceed 500 characters");
  }
  return trimmed;
}

/** Validate an expected version (optimistic concurrency). */
export function validateExpectedVersion(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    throw new ValidationError("Expected version must be an integer");
  }
  if (raw < 1) {
    throw new ValidationError("Expected version must be >= 1");
  }
  return raw;
}

/** Validate a complete CreateAccountInput. */
export function validateCreateAccountInput(raw: {
  name: unknown;
  initialBalanceCents: unknown;
  trackBalance: unknown;
}): CreateAccountInput {
  const name = validateAccountName(raw.name);
  const initialBalanceCents = validateOptionalBalance(raw.initialBalanceCents);
  const trackBalance =
    typeof raw.trackBalance === "boolean" ? raw.trackBalance : true;
  return { name, initialBalanceCents, trackBalance };
}

/** Validate a complete RefreshBalanceInput. */
export function validateRefreshBalanceInput(raw: {
  accountId: unknown;
  newBalanceCents: unknown;
  asOf: unknown;
  expectedVersion: unknown;
  idempotencyKey: unknown;
  reason?: unknown;
}): RefreshBalanceInput {
  const accountId = validateAccountId(raw.accountId);
  const newBalanceCents = validateBalanceCents(raw.newBalanceCents);
  const asOf = validateAsOfDate(raw.asOf);
  const expectedVersion = validateExpectedVersion(raw.expectedVersion);
  const idempotencyKey = validateIdempotencyKey(raw.idempotencyKey);
  const reason = validateOptionalReason(raw.reason);
  return {
    accountId,
    newBalanceCents,
    asOf,
    expectedVersion,
    idempotencyKey,
    reason,
  };
}

/** Validate a complete TransferInput. */
export function validateTransferInput(raw: {
  fromAccountId: unknown;
  toAccountId: unknown;
  amountCents: unknown;
  businessDate: unknown;
  idempotencyKey: unknown;
}): TransferInput {
  const fromAccountId = validateAccountId(raw.fromAccountId);
  const toAccountId = validateAccountId(raw.toAccountId);
  if (fromAccountId === toAccountId) {
    throw new ValidationError("Source and destination accounts must differ");
  }
  const amountCents = validatePositiveCents(raw.amountCents);
  const businessDate = validateBusinessDate(raw.businessDate);
  const idempotencyKey = validateIdempotencyKey(raw.idempotencyKey);
  return { fromAccountId, toAccountId, amountCents, businessDate, idempotencyKey };
}

/** Validate an account ID string (numeric). */
export function validateAccountId(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ValidationError("Account ID must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Account ID must not be empty");
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new ValidationError("Account ID must be numeric");
  }
  return trimmed;
}

/** Validate an as-of date (Date object or ISO string). */
export function validateAsOfDate(raw: unknown): Date {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      throw new ValidationError("As-of date is invalid");
    }
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new ValidationError("As-of date must not be empty");
    }
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      throw new ValidationError("As-of date is not a valid ISO date");
    }
    return date;
  }
  throw new ValidationError("As-of date must be a Date or ISO string");
}

/** Re-export CentsError so callers can catch money-parse failures uniformly. */
export { CentsError };