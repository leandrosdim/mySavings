// Input validation for the settlement service.
//
// All validation is server-side and rejects before any DB write. Cents are
// validated against the safe-integer range via lib/finance/money. Dates are
// ISO YYYY-MM-DD. Mode is an explicit enum; the service never infers mode from
// dates or other inputs.

import { isCents } from "../finance/money";
import {
  SettlementValidationError,
  type SettlementMode,
  type PayInput,
  type ReceiveInput,
  type ReverseSettlementInput,
  type ReverseReceiptInput,
  type ObligationId,
  type IncomeId,
  type SettlementId,
  type ReceiptId,
} from "./types";

const ID_RE = /^[0-9]+$/;
const DATE_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
const REASON_MAX_LENGTH = 500;
const VALID_MODES: SettlementMode[] = ["UPDATE_ACCOUNT", "ALREADY_REFLECTED"];

/** Validate a numeric ID string. */
function validateId(raw: unknown, label: string): string {
  if (typeof raw !== "string") {
    throw new SettlementValidationError(`${label} must be a string`);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new SettlementValidationError(`${label} must not be empty`);
  }
  if (!ID_RE.test(trimmed)) {
    throw new SettlementValidationError(`${label} must be numeric`);
  }
  return trimmed;
}

/** Validate an obligation ID. */
export function validateObligationId(raw: unknown): ObligationId {
  return validateId(raw, "Obligation ID");
}

/** Validate an income ID. */
export function validateIncomeId(raw: unknown): IncomeId {
  return validateId(raw, "Income ID");
}

/** Validate a settlement ID. */
export function validateSettlementId(raw: unknown): SettlementId {
  return validateId(raw, "Settlement ID");
}

/** Validate a receipt ID. */
export function validateReceiptId(raw: unknown): ReceiptId {
  return validateId(raw, "Receipt ID");
}

/** Validate an account ID (required for UPDATE_ACCOUNT, optional otherwise). */
export function validateOptionalAccountId(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  return validateId(raw, "Account ID");
}

/** Validate a settlement mode. Never inferred from other inputs. */
export function validateMode(raw: unknown): SettlementMode {
  if (typeof raw !== "string") {
    throw new SettlementValidationError("Mode must be a string");
  }
  if (!VALID_MODES.includes(raw as SettlementMode)) {
    throw new SettlementValidationError(
      "Mode must be 'UPDATE_ACCOUNT' or 'ALREADY_REFLECTED'",
    );
  }
  return raw as SettlementMode;
}

/** Validate a strictly positive payment/receipt amount in cents. */
export function validateAmountCents(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    throw new SettlementValidationError("Amount must be an integer");
  }
  if (!isCents(raw)) {
    throw new SettlementValidationError("Amount is out of safe bounds");
  }
  if (raw <= 0) {
    throw new SettlementValidationError("Amount must be strictly positive");
  }
  return raw;
}

/** Validate a business date string (ISO YYYY-MM-DD). Returns the trimmed string. */
export function validateBusinessDate(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new SettlementValidationError("Business date must be a string");
  }
  const trimmed = raw.trim();
  const match = trimmed.match(DATE_RE);
  if (!match) {
    throw new SettlementValidationError("Business date must be YYYY-MM-DD");
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
    throw new SettlementValidationError("Business date is not a valid calendar date");
  }
  return trimmed;
}

/** Validate an idempotency key. Must be a non-empty bounded string. */
export function validateIdempotencyKey(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new SettlementValidationError("Idempotency key must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new SettlementValidationError("Idempotency key must not be empty");
  }
  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new SettlementValidationError(
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
    throw new SettlementValidationError("Reason must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > REASON_MAX_LENGTH) {
    throw new SettlementValidationError(`Reason must not exceed ${REASON_MAX_LENGTH} characters`);
  }
  return trimmed;
}

/** Validate a complete PayInput. */
export function validatePayInput(raw: {
  obligationId: unknown;
  amountCents: unknown;
  mode: unknown;
  accountId: unknown;
  businessDate: unknown;
  idempotencyKey: unknown;
}): PayInput {
  const obligationId = validateObligationId(raw.obligationId);
  const amountCents = validateAmountCents(raw.amountCents);
  const mode = validateMode(raw.mode);
  const accountId = validateOptionalAccountId(raw.accountId);
  if (mode === "UPDATE_ACCOUNT" && accountId === null) {
    throw new SettlementValidationError(
      "An account is required for UPDATE_ACCOUNT mode",
    );
  }
  const businessDate = validateBusinessDate(raw.businessDate);
  const idempotencyKey = validateIdempotencyKey(raw.idempotencyKey);
  return { obligationId, amountCents, mode, accountId, businessDate, idempotencyKey };
}

/** Validate a complete ReceiveInput. */
export function validateReceiveInput(raw: {
  incomeExpectationId: unknown;
  amountCents: unknown;
  mode: unknown;
  accountId: unknown;
  businessDate: unknown;
  idempotencyKey: unknown;
}): ReceiveInput {
  const incomeExpectationId = validateIncomeId(raw.incomeExpectationId);
  const amountCents = validateAmountCents(raw.amountCents);
  const mode = validateMode(raw.mode);
  const accountId = validateOptionalAccountId(raw.accountId);
  if (mode === "UPDATE_ACCOUNT" && accountId === null) {
    throw new SettlementValidationError(
      "An account is required for UPDATE_ACCOUNT mode",
    );
  }
  const businessDate = validateBusinessDate(raw.businessDate);
  const idempotencyKey = validateIdempotencyKey(raw.idempotencyKey);
  return {
    incomeExpectationId,
    amountCents,
    mode,
    accountId,
    businessDate,
    idempotencyKey,
  };
}

/** Validate a complete ReverseSettlementInput. */
export function validateReverseSettlementInput(raw: {
  settlementId: unknown;
  businessDate: unknown;
  idempotencyKey: unknown;
  reason?: unknown;
  adjustBalanceAfterRefresh?: unknown;
}): ReverseSettlementInput {
  const settlementId = validateSettlementId(raw.settlementId);
  const businessDate = validateBusinessDate(raw.businessDate);
  const idempotencyKey = validateIdempotencyKey(raw.idempotencyKey);
  const reason = validateOptionalReason(raw.reason);
  let adjustBalanceAfterRefresh: boolean | undefined;
  if (raw.adjustBalanceAfterRefresh !== undefined) {
    if (typeof raw.adjustBalanceAfterRefresh !== "boolean") {
      throw new SettlementValidationError("adjustBalanceAfterRefresh must be a boolean");
    }
    adjustBalanceAfterRefresh = raw.adjustBalanceAfterRefresh;
  }
  return { settlementId, businessDate, idempotencyKey, reason, adjustBalanceAfterRefresh };
}

/** Validate a complete ReverseReceiptInput. */
export function validateReverseReceiptInput(raw: {
  receiptId: unknown;
  businessDate: unknown;
  idempotencyKey: unknown;
  reason?: unknown;
  adjustBalanceAfterRefresh?: unknown;
}): ReverseReceiptInput {
  const receiptId = validateReceiptId(raw.receiptId);
  const businessDate = validateBusinessDate(raw.businessDate);
  const idempotencyKey = validateIdempotencyKey(raw.idempotencyKey);
  const reason = validateOptionalReason(raw.reason);
  let adjustBalanceAfterRefresh: boolean | undefined;
  if (raw.adjustBalanceAfterRefresh !== undefined) {
    if (typeof raw.adjustBalanceAfterRefresh !== "boolean") {
      throw new SettlementValidationError("adjustBalanceAfterRefresh must be a boolean");
    }
    adjustBalanceAfterRefresh = raw.adjustBalanceAfterRefresh;
  }
  return { receiptId, businessDate, idempotencyKey, reason, adjustBalanceAfterRefresh };
}