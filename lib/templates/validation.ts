// Input validation for the recurring template service.
//
// All validation is server-side and rejects before any DB write. Names are
// trimmed and length-bounded. Cents are validated against the safe-integer
// range via lib/finance/money. Due day is 1-31 or null.

import { isCents } from "../finance/money";
import {
  TemplateValidationError,
  type TemplateKind,
  type CreateTemplateInput,
  type UpdateTemplateInput,
  type TemplateId,
} from "./types";

const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 100;
const TEMPLATE_ID_RE = /^[0-9]+$/;
const VALID_KINDS: TemplateKind[] = ["ordinary", "reserved", "income"];

/** Validate and normalize a template name. Throws on invalid. */
export function validateTemplateName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new TemplateValidationError("Template name must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length < NAME_MIN_LENGTH) {
    throw new TemplateValidationError("Template name must not be empty");
  }
  if (trimmed.length > NAME_MAX_LENGTH) {
    throw new TemplateValidationError(
      `Template name must not exceed ${NAME_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

/** Validate a template kind. */
export function validateTemplateKind(raw: unknown): TemplateKind {
  if (typeof raw !== "string") {
    throw new TemplateValidationError("Template kind must be a string");
  }
  if (!VALID_KINDS.includes(raw as TemplateKind)) {
    throw new TemplateValidationError(
      "Template kind must be 'ordinary', 'reserved' or 'income'",
    );
  }
  return raw as TemplateKind;
}

/** Validate a default amount (non-negative cents). */
export function validateDefaultAmount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    throw new TemplateValidationError("Default amount must be an integer");
  }
  if (!isCents(raw)) {
    throw new TemplateValidationError("Default amount is out of safe bounds");
  }
  if (raw < 0) {
    throw new TemplateValidationError("Default amount must not be negative");
  }
  return raw;
}

/** Validate a due day of month (1-31 or null). */
export function validateDueDayOfMonth(raw: unknown): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    throw new TemplateValidationError("Due day must be an integer or null");
  }
  if (raw < 1 || raw > 31) {
    throw new TemplateValidationError("Due day must be between 1 and 31");
  }
  return raw;
}

/** Validate an active flag. */
export function validateActive(raw: unknown): boolean {
  if (typeof raw !== "boolean") {
    throw new TemplateValidationError("Active flag must be a boolean");
  }
  return raw;
}

/** Validate a template ID string (numeric). */
export function validateTemplateId(raw: unknown): TemplateId {
  if (typeof raw !== "string") {
    throw new TemplateValidationError("Template ID must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new TemplateValidationError("Template ID must not be empty");
  }
  if (!TEMPLATE_ID_RE.test(trimmed)) {
    throw new TemplateValidationError("Template ID must be numeric");
  }
  return trimmed;
}

/** Validate a complete CreateTemplateInput. */
export function validateCreateTemplateInput(raw: {
  name: unknown;
  kind: unknown;
  defaultAmountCents: unknown;
  dueDayOfMonth: unknown;
  active: unknown;
}): CreateTemplateInput {
  const name = validateTemplateName(raw.name);
  const kind = validateTemplateKind(raw.kind);
  const defaultAmountCents = validateDefaultAmount(raw.defaultAmountCents);
  const dueDayOfMonth = validateDueDayOfMonth(raw.dueDayOfMonth);
  const active = validateActive(raw.active);
  return { name, kind, defaultAmountCents, dueDayOfMonth, active };
}

/** Validate a partial UpdateTemplateInput. At least one field must be present. */
export function validateUpdateTemplateInput(raw: {
  name?: unknown;
  defaultAmountCents?: unknown;
  dueDayOfMonth?: unknown;
  active?: unknown;
}): UpdateTemplateInput {
  const hasName = raw.name !== undefined;
  const hasAmount = raw.defaultAmountCents !== undefined;
  const hasDueDay = raw.dueDayOfMonth !== undefined;
  const hasActive = raw.active !== undefined;
  if (!hasName && !hasAmount && !hasDueDay && !hasActive) {
    throw new TemplateValidationError(
      "At least one field must be provided for update",
    );
  }
  const result: UpdateTemplateInput = {};
  if (hasName) {
    result.name = validateTemplateName(raw.name);
  }
  if (hasAmount) {
    result.defaultAmountCents = validateDefaultAmount(raw.defaultAmountCents);
  }
  if (hasDueDay) {
    result.dueDayOfMonth = validateDueDayOfMonth(raw.dueDayOfMonth);
  }
  if (hasActive) {
    result.active = validateActive(raw.active);
  }
  return result;
}