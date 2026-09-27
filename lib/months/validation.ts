// Input validation for the monthly plan service.
//
// All validation is server-side and rejects before any DB write. Month keys
// are YYYY-MM strings validated against the calendar. Cents are validated
// against the safe-integer range via lib/finance/money.

import { isCents, type Cents } from "../finance/money";
import {
  PlanValidationError,
  type MonthKey,
  type CreatePlanInput,
  type UpdateTargetInput,
  type PlanId,
} from "./types";

const MONTH_KEY_RE = /^([0-9]{4})-(0[1-9]|1[0-2])$/;
const PLAN_ID_RE = /^[0-9]+$/;

/** Validate and normalize a month key (YYYY-MM). Throws on invalid. */
export function validateMonthKey(raw: unknown): MonthKey {
  if (typeof raw !== "string") {
    throw new PlanValidationError("Month key must be a string");
  }
  const trimmed = raw.trim();
  const match = trimmed.match(MONTH_KEY_RE);
  if (!match) {
    throw new PlanValidationError("Month key must be YYYY-MM");
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (year < 1900 || year > 9999) {
    throw new PlanValidationError("Month key year must be between 1900 and 9999");
  }
  void month;
  return trimmed;
}

/** Validate a savings target (non-negative cents). Target 0 is explicit. */
export function validateSavingsTarget(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    throw new PlanValidationError("Savings target must be an integer");
  }
  if (!isCents(raw)) {
    throw new PlanValidationError("Savings target is out of safe bounds");
  }
  if (raw < 0) {
    throw new PlanValidationError("Savings target must not be negative");
  }
  return raw;
}

/** Validate a plan ID string (numeric). */
export function validatePlanId(raw: unknown): PlanId {
  if (typeof raw !== "string") {
    throw new PlanValidationError("Plan ID must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new PlanValidationError("Plan ID must not be empty");
  }
  if (!PLAN_ID_RE.test(trimmed)) {
    throw new PlanValidationError("Plan ID must be numeric");
  }
  return trimmed;
}

/** Validate a complete CreatePlanInput. */
export function validateCreatePlanInput(raw: {
  monthKey: unknown;
  savingsTargetCents: unknown;
}): CreatePlanInput {
  const monthKey = validateMonthKey(raw.monthKey);
  const savingsTargetCents = validateSavingsTarget(raw.savingsTargetCents);
  return { monthKey, savingsTargetCents };
}

/** Validate a complete UpdateTargetInput. */
export function validateUpdateTargetInput(raw: {
  planId: unknown;
  savingsTargetCents: unknown;
}): UpdateTargetInput {
  const planId = validatePlanId(raw.planId);
  const savingsTargetCents = validateSavingsTarget(raw.savingsTargetCents);
  return { planId, savingsTargetCents };
}

/** Re-export Cents for callers that need the branded type. */
export type { Cents };