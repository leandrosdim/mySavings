// Input validation for the obligation service.
//
// All validation is server-side and rejects before any DB write. Titles are
// trimmed and length-bounded. Cents are validated against the safe-integer
// range via lib/finance/money. Dates are ISO YYYY-MM-DD. Month keys are
// YYYY-MM. Only ordinary and reserved kinds are accepted here (income has its
// own service); this prevents accidental creation of income-type obligations.

import { isCents } from "../finance/money";
import {
  ObligationValidationError,
  type ObligationKind,
  type ObligationId,
  type CreateObligationInput,
  type UpdateObligationInput,
} from "./types";

const TITLE_MIN_LENGTH = 1;
const TITLE_MAX_LENGTH = 200;
const ID_RE = /^[0-9]+$/;
const MONTH_KEY_RE = /^([0-9]{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const VALID_KINDS: ObligationKind[] = ["ordinary", "reserved"];

/** Validate and normalize an obligation title. Throws on invalid. */
export function validateTitle(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ObligationValidationError("Title must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length < TITLE_MIN_LENGTH) {
    throw new ObligationValidationError("Title must not be empty");
  }
  if (trimmed.length > TITLE_MAX_LENGTH) {
    throw new ObligationValidationError(
      `Title must not exceed ${TITLE_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

/** Validate an obligation kind. Only ordinary/reserved accepted. */
export function validateKind(raw: unknown): ObligationKind {
  if (typeof raw !== "string") {
    throw new ObligationValidationError("Kind must be a string");
  }
  if (!VALID_KINDS.includes(raw as ObligationKind)) {
    throw new ObligationValidationError(
      "Kind must be 'ordinary' or 'reserved'",
    );
  }
  return raw as ObligationKind;
}

/** Validate a planned amount (non-negative cents). */
export function validatePlannedCents(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    throw new ObligationValidationError("Planned amount must be an integer");
  }
  if (!isCents(raw)) {
    throw new ObligationValidationError("Planned amount is out of safe bounds");
  }
  if (raw < 0) {
    throw new ObligationValidationError("Planned amount must not be negative");
  }
  return raw;
}

/** Validate a month key (YYYY-MM). */
export function validateMonthKey(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ObligationValidationError("Month key must be a string");
  }
  const trimmed = raw.trim();
  if (!MONTH_KEY_RE.test(trimmed)) {
    throw new ObligationValidationError("Month key must be YYYY-MM");
  }
  const year = Number.parseInt(trimmed.slice(0, 4), 10);
  if (year < 1900 || year > 9999) {
    throw new ObligationValidationError("Year must be between 1900 and 9999");
  }
  return trimmed;
}

/** Validate an optional due date (ISO YYYY-MM-DD or null). Returns null or trimmed string. */
export function validateOptionalDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  if (typeof raw !== "string") {
    throw new ObligationValidationError("Date must be a string or null");
  }
  const trimmed = raw.trim();
  const match = trimmed.match(DATE_RE);
  if (!match) {
    throw new ObligationValidationError("Date must be YYYY-MM-DD");
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
    throw new ObligationValidationError("Date is not a valid calendar date");
  }
  return trimmed;
}

/** Validate an optional linked account ID (numeric string or null). */
export function validateOptionalAccountId(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  if (typeof raw !== "string") {
    throw new ObligationValidationError("Account ID must be a string or null");
  }
  const trimmed = raw.trim();
  if (!ID_RE.test(trimmed)) {
    throw new ObligationValidationError("Account ID must be numeric");
  }
  return trimmed;
}

/** Validate an obligation ID string (numeric). */
export function validateObligationId(raw: unknown): ObligationId {
  if (typeof raw !== "string") {
    throw new ObligationValidationError("Obligation ID must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ObligationValidationError("Obligation ID must not be empty");
  }
  if (!ID_RE.test(trimmed)) {
    throw new ObligationValidationError("Obligation ID must be numeric");
  }
  return trimmed;
}

/** Validate a complete CreateObligationInput. */
export function validateCreateObligationInput(raw: {
  kind: unknown;
  title: unknown;
  plannedCents: unknown;
  monthKey: unknown;
  dueDate?: unknown;
  linkedAccountId?: unknown;
}): CreateObligationInput {
  const kind = validateKind(raw.kind);
  const title = validateTitle(raw.title);
  const plannedCents = validatePlannedCents(raw.plannedCents);
  const monthKey = validateMonthKey(raw.monthKey);
  const dueDate = validateOptionalDate(raw.dueDate);
  const linkedAccountId = validateOptionalAccountId(raw.linkedAccountId);
  return { kind, title, plannedCents, monthKey, dueDate, linkedAccountId };
}

/** Validate a partial UpdateObligationInput. At least one field must be present. */
export function validateUpdateObligationInput(raw: {
  title?: unknown;
  plannedCents?: unknown;
  dueDate?: unknown;
  linkedAccountId?: unknown;
}): UpdateObligationInput {
  const hasTitle = raw.title !== undefined;
  const hasAmount = raw.plannedCents !== undefined;
  const hasDueDate = raw.dueDate !== undefined;
  const hasAccount = raw.linkedAccountId !== undefined;
  if (!hasTitle && !hasAmount && !hasDueDate && !hasAccount) {
    throw new ObligationValidationError(
      "At least one field must be provided for update",
    );
  }
  const result: UpdateObligationInput = {};
  if (hasTitle) {
    result.title = validateTitle(raw.title);
  }
  if (hasAmount) {
    result.plannedCents = validatePlannedCents(raw.plannedCents);
  }
  if (hasDueDate) {
    result.dueDate = validateOptionalDate(raw.dueDate);
  }
  if (hasAccount) {
    result.linkedAccountId = validateOptionalAccountId(raw.linkedAccountId);
  }
  return result;
}