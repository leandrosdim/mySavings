// Recurring template service shared types and errors.
//
// Templates are definitions (recurring expense/income/reserve), NOT themselves
// liabilities. They generate obligations or income expectations per month.
// Uniqueness on generation is enforced on the generated entity, not on the
// template. The template name is unique per owner.

import type { OwnerId } from "../months/types";

/** Template identifier as a string (BIGINT from the DB). */
export type TemplateId = string;

/** Template kind: ordinary expense, reserved commitment, or income. */
export type TemplateKind = "ordinary" | "reserved" | "income";

/** A recurring template row as returned to callers. */
export type RecurringTemplate = {
  id: TemplateId;
  name: string;
  kind: TemplateKind;
  defaultAmountCents: number;
  dueDayOfMonth: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Input for creating a template. */
export type CreateTemplateInput = {
  name: string;
  kind: TemplateKind;
  defaultAmountCents: number;
  dueDayOfMonth: number | null;
  active: boolean;
};

/** Input for updating a template. */
export type UpdateTemplateInput = {
  name?: string;
  defaultAmountCents?: number;
  dueDayOfMonth?: number | null;
  active?: boolean;
};

/** Result of creating a template. */
export type CreateTemplateResult = {
  template: RecurringTemplate;
};

/** Result of updating a template. */
export type UpdateTemplateResult = {
  template: RecurringTemplate;
};

// --- Error hierarchy ---

export class TemplateServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TemplateServiceError";
    this.code = code;
  }
}

export class TemplateValidationError extends TemplateServiceError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "TemplateValidationError";
  }
}

export class TemplateNotFoundError extends TemplateServiceError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "TemplateNotFoundError";
  }
}

export class TemplateConflictError extends TemplateServiceError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "TemplateConflictError";
  }
}

export type { OwnerId };