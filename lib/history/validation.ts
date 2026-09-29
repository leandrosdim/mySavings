// Month closing and history service — input validation.
//
// All validation is pure and throws HistoryValidationError on bad input. The
// month_key format and cent bounds mirror lib/months/validation and
// lib/finance/money so there is one canonical acceptance shape.

import {
  HistoryValidationError,
  type MonthKey,
  type OwnerId,
  type PlanId,
} from "./types";

const MONTH_KEY_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const PLAN_ID_RE = /^[0-9]+$/;
const OWNER_ID_RE = /^[0-9]+$/;

export function validateMonthKey(value: unknown): MonthKey {
  if (typeof value !== "string" || !MONTH_KEY_RE.test(value)) {
    throw new HistoryValidationError("Invalid month key; expected YYYY-MM");
  }
  return value;
}

export function validateOwnerId(value: unknown): OwnerId {
  if (typeof value !== "string" || !OWNER_ID_RE.test(value)) {
    throw new HistoryValidationError("Invalid owner id");
  }
  return value;
}

export function validatePlanId(value: unknown): PlanId {
  if (typeof value !== "string" || !PLAN_ID_RE.test(value)) {
    throw new HistoryValidationError("Invalid plan id");
  }
  return value;
}

export function validateHistoryMonthKey(value: unknown): MonthKey {
  return validateMonthKey(value);
}