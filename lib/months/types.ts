// Monthly plan service shared types and errors.
//
// A monthly plan is one record per owner per calendar month (YYYY-MM, Europe/
// Athens boundary). The savings target is a protected month-end total, NOT a
// monthly contribution or bank movement. Target 0 is explicit; a missing plan
// means incomplete setup.
//
// The service layer is owner-scoped: every function takes an ownerId derived
// from the verified server session inside the trusted boundary.

import type { Cents } from "../finance/money";

/** Owner identifier as a string (BIGINT from the verified session). */
export type OwnerId = string;

/** Monthly plan identifier as a string (BIGINT from the DB). */
export type PlanId = string;

/** Month key in YYYY-MM format (Europe/Athens boundary). */
export type MonthKey = string;

/** A monthly plan row as returned to callers. */
export type MonthlyPlan = {
  id: PlanId;
  monthKey: MonthKey;
  savingsTargetCents: number;
  status: "open" | "closed";
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Input for creating a monthly plan. */
export type CreatePlanInput = {
  monthKey: MonthKey;
  savingsTargetCents: number;
};

/** Input for updating the savings target. */
export type UpdateTargetInput = {
  planId: PlanId;
  savingsTargetCents: number;
};

/** Result of creating a plan. */
export type CreatePlanResult = {
  plan: MonthlyPlan;
  generated: boolean;
};

/** Result of updating the savings target. */
export type UpdateTargetResult = {
  plan: MonthlyPlan;
};

/** Result of generating entries from templates. */
export type GenerationResult = {
  planId: PlanId;
  monthKey: MonthKey;
  generatedObligations: number;
  generatedIncome: number;
  skippedObligations: number;
  skippedIncome: number;
};

// --- Error hierarchy ---

export class PlanServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PlanServiceError";
    this.code = code;
  }
}

export class PlanValidationError extends PlanServiceError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "PlanValidationError";
  }
}

export class PlanNotFoundError extends PlanServiceError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "PlanNotFoundError";
  }
}

export class PlanConflictError extends PlanServiceError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "PlanConflictError";
  }
}

export class ClosedMonthError extends PlanServiceError {
  constructor(message: string) {
    super("CLOSED_MONTH", message);
    this.name = "ClosedMonthError";
  }
}