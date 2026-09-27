// Input validation for the income expectation service.
//
// All validation is server-side and rejects before any DB write. Source names
// are trimmed and length-bounded. Cents are validated against the safe-integer
// range via lib/finance/money. Month keys are YYYY-MM. Account IDs are numeric
// strings or null.

import { isCents } from "../finance/money";
import {
  IncomeValidationError,
  type IncomeId,
  type CreateIncomeInput,
  type UpdateIncomeInput,
} from "./types";

const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 200;
const ID_RE = /^[0-9]+$/;
const MONTH_KEY_RE = /^([0-9]{4})-(0[1-9]|1[0-2])$/;

/** Validate and normalize a source name. Throws on invalid. */
export function validateSourceName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new IncomeValidationError("Source name must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length < NAME_MIN_LENGTH) {
    throw new IncomeValidationError("Source name must not be empty");
  }
  if (trimmed.length > NAME_MAX_LENGTH) {
    throw new IncomeValidationError(
      `Source name must not exceed ${NAME_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

/** Validate an expected amount (non-negative cents). */
export function validateExpectedCents(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    throw new IncomeValidationError("Expected amount must be an integer");
  }
  if (!isCents(raw)) {
    throw new IncomeValidationError("Expected amount is out of safe bounds");
  }
  if (raw < 0) {
    throw new IncomeValidationError("Expected amount must not be negative");
  }
  return raw;
}

/** Validate a month key (YYYY-MM). */
export function validateMonthKey(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new IncomeValidationError("Month key must be a string");
  }
  const trimmed = raw.trim();
  if (!MONTH_KEY_RE.test(trimmed)) {
    throw new IncomeValidationError("Month key must be YYYY-MM");
  }
  const year = Number.parseInt(trimmed.slice(0, 4), 10);
  if (year < 1900 || year > 9999) {
    throw new IncomeValidationError("Year must be between 1900 and 9999");
  }
  return trimmed;
}

/** Validate an optional linked account ID (numeric string or null). */
export function validateOptionalAccountId(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  if (typeof raw !== "string") {
    throw new IncomeValidationError("Account ID must be a string or null");
  }
  const trimmed = raw.trim();
  if (!ID_RE.test(trimmed)) {
    throw new IncomeValidationError("Account ID must be numeric");
  }
  return trimmed;
}

/** Validate an income ID string (numeric). */
export function validateIncomeId(raw: unknown): IncomeId {
  if (typeof raw !== "string") {
    throw new IncomeValidationError("Income ID must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new IncomeValidationError("Income ID must not be empty");
  }
  if (!ID_RE.test(trimmed)) {
    throw new IncomeValidationError("Income ID must be numeric");
  }
  return trimmed;
}

/** Validate a complete CreateIncomeInput. */
export function validateCreateIncomeInput(raw: {
  monthKey: unknown;
  sourceName: unknown;
  expectedCents: unknown;
  linkedAccountId?: unknown;
}): CreateIncomeInput {
  const monthKey = validateMonthKey(raw.monthKey);
  const sourceName = validateSourceName(raw.sourceName);
  const expectedCents = validateExpectedCents(raw.expectedCents);
  const linkedAccountId = validateOptionalAccountId(raw.linkedAccountId);
  return { monthKey, sourceName, expectedCents, linkedAccountId };
}

/** Validate a partial UpdateIncomeInput. At least one field must be present. */
export function validateUpdateIncomeInput(raw: {
  sourceName?: unknown;
  expectedCents?: unknown;
  linkedAccountId?: unknown;
}): UpdateIncomeInput {
  const hasName = raw.sourceName !== undefined;
  const hasAmount = raw.expectedCents !== undefined;
  const hasAccount = raw.linkedAccountId !== undefined;
  if (!hasName && !hasAmount && !hasAccount) {
    throw new IncomeValidationError(
      "At least one field must be provided for update",
    );
  }
  const result: UpdateIncomeInput = {};
  if (hasName) {
    result.sourceName = validateSourceName(raw.sourceName);
  }
  if (hasAmount) {
    result.expectedCents = validateExpectedCents(raw.expectedCents);
  }
  if (hasAccount) {
    result.linkedAccountId = validateOptionalAccountId(raw.linkedAccountId);
  }
  return result;
}