// Pure validation helpers for the rollover service. Safe to reuse in tests.
//
// These functions never touch the database. They validate the shape and
// bounds of client-provided input before the service layer locks rows.

import {
  RolloverValidationError,
  type ApplyRolloverInput,
  type MonthKey,
  type OwnerId,
  type Cents,
} from "./types";
import { validateMonthKey as validatePlanMonthKey, validateSavingsTarget } from "../months/validation";

const MONTH_KEY_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

export function validateRolloverMonthKey(monthKey: string): MonthKey {
  if (typeof monthKey !== "string" || !MONTH_KEY_RE.test(monthKey)) {
    throw new RolloverValidationError(
      "Invalid month key; expected YYYY-MM",
    );
  }
  return monthKey;
}

export function validatePreviewDigest(digest: string): string {
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new RolloverValidationError("Invalid preview digest");
  }
  return digest;
}

export function validateIdempotencyKey(key: string): string {
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_RE.test(key)) {
    throw new RolloverValidationError("Invalid idempotency key");
  }
  return key;
}

export function validateObligationId(id: string): string {
  if (typeof id !== "string" || !/^[0-9]{1,19}$/.test(id)) {
    throw new RolloverValidationError("Invalid obligation id");
  }
  return id;
}

export function validateIncomeId(id: string): string {
  if (typeof id !== "string" || !/^[0-9]{1,19}$/.test(id)) {
    throw new RolloverValidationError("Invalid income expectation id");
  }
  return id;
}

export function validateApplyRolloverInput(
  raw: ApplyRolloverInput,
): ApplyRolloverInput {
  if (!raw || typeof raw !== "object") {
    throw new RolloverValidationError("Invalid apply input");
  }
  const sourceMonthKey = validateRolloverMonthKey(raw.sourceMonthKey);
  validatePlanMonthKey(sourceMonthKey);
  const savingsTargetCents = validateSavingsTarget(raw.savingsTargetCents) as Cents;
  const previewDigest = validatePreviewDigest(raw.previewDigest);
  const idempotencyKey = validateIdempotencyKey(raw.idempotencyKey);

  const releaseChoices = Array.isArray(raw.releaseChoices)
    ? raw.releaseChoices.map((c) => {
        if (!c || typeof c !== "object") {
          throw new RolloverValidationError("Invalid release choice");
        }
        return { obligationId: validateObligationId(c.obligationId) };
      })
    : [];
  // Reject duplicate release choices (defensive; service also dedups).
  const releaseIds = new Set(releaseChoices.map((c) => c.obligationId));
  if (releaseIds.size !== releaseChoices.length) {
    throw new RolloverValidationError("Duplicate release choices");
  }

  const carryIncomeIds = Array.isArray(raw.carryIncomeIds)
    ? raw.carryIncomeIds.map(validateIncomeId)
    : [];
  const carrySet = new Set(carryIncomeIds);
  if (carrySet.size !== carryIncomeIds.length) {
    throw new RolloverValidationError("Duplicate carry income ids");
  }

  return {
    sourceMonthKey,
    savingsTargetCents,
    previewDigest,
    releaseChoices: releaseChoices.map((c) => ({
      obligationId: c.obligationId,
    })),
    carryIncomeIds: carryIncomeIds,
    idempotencyKey,
  };
}

export type { OwnerId };