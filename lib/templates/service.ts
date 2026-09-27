// Recurring template service: owner-scoped template CRUD.
//
// All functions take an ownerId derived from the verified server session.
// No function accepts arbitrary unvalidated owner input from clients. Every
// write uses withTransaction (explicit BEGIN/COMMIT/ROLLBACK on one
// checked-out client). Financial cents are exact integers bounded by
// lib/finance/money.
//
// Key invariants enforced here:
// - Template name is unique per owner (UNIQUE(owner_id, name) in DB).
// - Templates are definitions, NOT themselves liabilities. They do not enter
//   E or I. They generate obligations/income_expectations per month.
// - Editing a template affects future generation only; existing generated
//   instances (obligations/income_expectations) keep their amount/history.
// - The kind field determines whether generation creates an obligation
//   (ordinary/reserved) or an income_expectation (income).
// - A weekly spending allowance is entered as a monthly budget, not silently
//   multiplied by an assumed four weeks. No recurrence engine.

import "server-only";
import { withTransaction, query, type PoolClient } from "../db";
import type { OwnerId } from "../months/types";
import {
  TemplateNotFoundError,
  TemplateConflictError,
  TemplateValidationError,
  TemplateServiceError,
  type RecurringTemplate,
  type TemplateId,
  type TemplateKind,
  type CreateTemplateInput,
  type CreateTemplateResult,
  type UpdateTemplateInput,
  type UpdateTemplateResult,
} from "./types";
import {
  validateTemplateName,
  validateTemplateKind,
  validateDefaultAmount,
  validateDueDayOfMonth,
  validateActive,
  validateTemplateId,
  validateCreateTemplateInput,
  validateUpdateTemplateInput,
} from "./validation";

export {
  TemplateNotFoundError,
  TemplateConflictError,
  TemplateValidationError,
  TemplateServiceError,
};

// --- Row types (raw DB shape, snake_case) ---

type TemplateRow = {
  id: string;
  name: string;
  kind: string;
  default_amount_cents: string;
  due_day_of_month: number | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

// --- Helpers ---

function bigToInt(value: string | number | null): number | null {
  if (value === null) return null;
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (!Number.isSafeInteger(n)) {
    throw new Error(`BIGINT value out of safe range: ${value}`);
  }
  return n;
}

function mapTemplate(row: TemplateRow): RecurringTemplate {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as TemplateKind,
    defaultAmountCents: bigToInt(row.default_amount_cents) ?? 0,
    dueDayOfMonth: row.due_day_of_month,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: string }).code;
    return code === "23505";
  }
  return false;
}

// --- Template CRUD ---

/** Create a new recurring template. Name must be unique per owner. */
export async function createTemplate(
  ownerId: OwnerId,
  input: CreateTemplateInput,
): Promise<CreateTemplateResult> {
  const validated = validateCreateTemplateInput(input);
  try {
    const template = await withTransaction(async (client) => {
      const row = await client.query<TemplateRow>(
        `INSERT INTO recurring_templates
           (owner_id, name, kind, default_amount_cents, due_day_of_month, active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, kind, default_amount_cents, due_day_of_month,
                   active, created_at, updated_at`,
        [
          ownerId,
          validated.name,
          validated.kind,
          validated.defaultAmountCents,
          validated.dueDayOfMonth,
          validated.active,
        ],
      );
      return mapTemplate(row.rows[0]);
    });
    return { template };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new TemplateConflictError(
        "A template with this name already exists",
      );
    }
    throw error;
  }
}

/** Fetch a single template by ID. Throws TemplateNotFoundError if missing or cross-owner. */
export async function getTemplate(
  ownerId: OwnerId,
  templateId: TemplateId,
): Promise<RecurringTemplate> {
  const id = validateTemplateId(templateId);
  const result = await query<TemplateRow>(
    `SELECT id, name, kind, default_amount_cents, due_day_of_month,
            active, created_at, updated_at
     FROM recurring_templates
     WHERE owner_id = $1 AND id = $2`,
    [ownerId, id],
  );
  if (result.rows.length === 0) {
    throw new TemplateNotFoundError("Template not found");
  }
  return mapTemplate(result.rows[0]);
}

/** List all templates for the owner, active first, then by name. */
export async function listTemplates(ownerId: OwnerId): Promise<RecurringTemplate[]> {
  const result = await query<TemplateRow>(
    `SELECT id, name, kind, default_amount_cents, due_day_of_month,
            active, created_at, updated_at
     FROM recurring_templates
     WHERE owner_id = $1
     ORDER BY active DESC, name ASC, id ASC`,
    [ownerId],
  );
  return result.rows.map(mapTemplate);
}

/** List only active templates for the owner. Used by the generation service. */
export async function listActiveTemplates(ownerId: OwnerId): Promise<RecurringTemplate[]> {
  const result = await query<TemplateRow>(
    `SELECT id, name, kind, default_amount_cents, due_day_of_month,
            active, created_at, updated_at
     FROM recurring_templates
     WHERE owner_id = $1 AND active = true
     ORDER BY kind ASC, name ASC, id ASC`,
    [ownerId],
  );
  return result.rows.map(mapTemplate);
}

/** Update a template. Editing affects future generation only, not existing instances. */
export async function updateTemplate(
  ownerId: OwnerId,
  templateId: TemplateId,
  input: UpdateTemplateInput,
): Promise<UpdateTemplateResult> {
  const id = validateTemplateId(templateId);
  const validated = validateUpdateTemplateInput(input);
  try {
    const template = await withTransaction(async (client) => {
      const lockResult = await client.query<TemplateRow>(
        `SELECT id, name, kind, default_amount_cents, due_day_of_month,
                active, created_at, updated_at
         FROM recurring_templates
         WHERE owner_id = $1 AND id = $2
         FOR UPDATE`,
        [ownerId, id],
      );
      if (lockResult.rows.length === 0) {
        throw new TemplateNotFoundError("Template not found");
      }
      const existing = lockResult.rows[0];
      const newName = validated.name ?? existing.name;
      const newAmount = validated.defaultAmountCents ?? bigToInt(existing.default_amount_cents) ?? 0;
      const newDueDay =
        validated.dueDayOfMonth === undefined
          ? existing.due_day_of_month
          : validated.dueDayOfMonth;
      const newActive = validated.active ?? existing.active;

      const row = await client.query<TemplateRow>(
        `UPDATE recurring_templates
         SET name = $3, default_amount_cents = $4, due_day_of_month = $5,
             active = $6, updated_at = now()
         WHERE owner_id = $1 AND id = $2
         RETURNING id, name, kind, default_amount_cents, due_day_of_month,
                   active, created_at, updated_at`,
        [ownerId, id, newName, newAmount, newDueDay, newActive],
      );
      return mapTemplate(row.rows[0]);
    });
    return { template };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new TemplateConflictError(
        "A template with this name already exists",
      );
    }
    throw error;
  }
}

/** Delete a template. Restricted if it has generated instances (ON DELETE RESTRICT). */
export async function deleteTemplate(
  ownerId: OwnerId,
  templateId: TemplateId,
): Promise<void> {
  const id = validateTemplateId(templateId);
  try {
    await withTransaction(async (client) => {
      const result = await client.query(
        `DELETE FROM recurring_templates
         WHERE owner_id = $1 AND id = $2`,
        [ownerId, id],
      );
      if (result.rowCount === 0) {
        throw new TemplateNotFoundError("Template not found");
      }
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = (error as { code: string }).code;
      if (code === "23503") {
        throw new TemplateConflictError(
          "Cannot delete a template that has generated instances; deactivate it instead",
        );
      }
    }
    throw error;
  }
}