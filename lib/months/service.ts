// Monthly plan service: owner-scoped plan CRUD and savings target management.
//
// All functions take an ownerId derived from the verified server session.
// No function accepts arbitrary unvalidated owner input from clients. Every
// write uses withTransaction (explicit BEGIN/COMMIT/ROLLBACK on one
// checked-out client). Financial cents are exact integers bounded by
// lib/finance/money.
//
// Key invariants enforced here:
// - One plan per owner per month_key (UNIQUE(owner_id, month_key) in DB).
// - Savings target is a protected month-end total, NOT a monthly contribution
//   or bank movement. Target 0 is explicit. Missing target (no plan) means
//   incomplete setup.
// - Closed months reject target edits (lifecycle: open -> closed).
// - Month boundaries are Europe/Athens; the month_key is a calendar YYYY-MM
//   string, not a timestamp. No UTC shifting of date-only values.

import "server-only";
import { withTransaction, query, type PoolClient } from "../db";
import {
  PlanNotFoundError,
  PlanConflictError,
  ClosedMonthError,
  PlanValidationError,
  PlanServiceError,
  type MonthlyPlan,
  type OwnerId,
  type PlanId,
  type MonthKey,
  type CreatePlanInput,
  type CreatePlanResult,
  type UpdateTargetInput,
  type UpdateTargetResult,
  type GenerationResult,
} from "./types";
import {
  validateMonthKey,
  validateSavingsTarget,
  validatePlanId,
  validateCreatePlanInput,
  validateUpdateTargetInput,
} from "./validation";

export {
  PlanNotFoundError,
  PlanConflictError,
  ClosedMonthError,
  PlanValidationError,
  PlanServiceError,
};

// --- Row types (raw DB shape, snake_case) ---

type PlanRow = {
  id: string;
  month_key: string;
  savings_target_cents: string;
  status: string;
  closed_at: Date | null;
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

function mapPlan(row: PlanRow): MonthlyPlan {
  return {
    id: row.id,
    monthKey: row.month_key,
    savingsTargetCents: bigToInt(row.savings_target_cents) ?? 0,
    status: row.status as "open" | "closed",
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// --- Plan CRUD ---

/** Create a new monthly plan for the given owner + month. Unique per owner+month. */
export async function createPlan(
  ownerId: OwnerId,
  input: CreatePlanInput,
): Promise<CreatePlanResult> {
  const validated = validateCreatePlanInput(input);
  try {
    const plan = await withTransaction(async (client) => {
      const row = await client.query<PlanRow>(
        `INSERT INTO monthly_plans (owner_id, month_key, savings_target_cents)
         VALUES ($1, $2, $3)
         RETURNING id, month_key, savings_target_cents, status, closed_at,
                   created_at, updated_at`,
        [ownerId, validated.monthKey, validated.savingsTargetCents],
      );
      return mapPlan(row.rows[0]);
    });
    return { plan, generated: false };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PlanConflictError(
        "A plan for this month already exists",
      );
    }
    throw error;
  }
}

/** Get or create a plan for the given owner + month. Idempotent creation. */
export async function getOrCreatePlan(
  ownerId: OwnerId,
  monthKey: MonthKey,
  savingsTargetCents: number = 0,
): Promise<CreatePlanResult> {
  const key = validateMonthKey(monthKey);
  const target = validateSavingsTarget(savingsTargetCents);
  try {
    const plan = await withTransaction(async (client) => {
      const existing = await client.query<PlanRow>(
        `SELECT id, month_key, savings_target_cents, status, closed_at,
                created_at, updated_at
         FROM monthly_plans
         WHERE owner_id = $1 AND month_key = $2
         FOR UPDATE`,
        [ownerId, key],
      );
      if (existing.rows.length > 0) {
        return { plan: mapPlan(existing.rows[0]), generated: false };
      }
      const row = await client.query<PlanRow>(
        `INSERT INTO monthly_plans (owner_id, month_key, savings_target_cents)
         VALUES ($1, $2, $3)
         RETURNING id, month_key, savings_target_cents, status, closed_at,
                   created_at, updated_at`,
        [ownerId, key, target],
      );
      return { plan: mapPlan(row.rows[0]), generated: true };
    });
    return plan;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await getPlanByMonth(ownerId, key);
      return { plan: existing, generated: false };
    }
    throw error;
  }
}

/** Fetch a single plan by ID. Throws PlanNotFoundError if missing or cross-owner. */
export async function getPlan(
  ownerId: OwnerId,
  planId: PlanId,
): Promise<MonthlyPlan> {
  const id = validatePlanId(planId);
  const result = await query<PlanRow>(
    `SELECT id, month_key, savings_target_cents, status, closed_at,
            created_at, updated_at
     FROM monthly_plans
     WHERE owner_id = $1 AND id = $2`,
    [ownerId, id],
  );
  if (result.rows.length === 0) {
    throw new PlanNotFoundError("Plan not found");
  }
  return mapPlan(result.rows[0]);
}

/** Fetch a plan by owner + month key. Throws PlanNotFoundError if missing. */
export async function getPlanByMonth(
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<MonthlyPlan> {
  const key = validateMonthKey(monthKey);
  const result = await query<PlanRow>(
    `SELECT id, month_key, savings_target_cents, status, closed_at,
            created_at, updated_at
     FROM monthly_plans
     WHERE owner_id = $1 AND month_key = $2`,
    [ownerId, key],
  );
  if (result.rows.length === 0) {
    throw new PlanNotFoundError("Plan not found for this month");
  }
  return mapPlan(result.rows[0]);
}

/** List all plans for the owner, ordered by month_key descending. */
export async function listPlans(ownerId: OwnerId): Promise<MonthlyPlan[]> {
  const result = await query<PlanRow>(
    `SELECT id, month_key, savings_target_cents, status, closed_at,
            created_at, updated_at
     FROM monthly_plans
     WHERE owner_id = $1
     ORDER BY month_key DESC, id DESC`,
    [ownerId],
  );
  return result.rows.map(mapPlan);
}

/** Get the current month key in Europe/Athens timezone. */
export function currentMonthKeyAthens(now: Date = new Date()): MonthKey {
  const athens = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Europe/Athens",
  });
  const formatted = athens.format(now);
  const parts = formatted.split("-");
  return `${parts[0]}-${parts[1]}`;
}

/** Get the next month key (handles year rollover). */
export function nextMonthKey(monthKey: MonthKey): MonthKey {
  const parts = monthKey.split("-");
  const year = Number.parseInt(parts[0], 10);
  const month = Number.parseInt(parts[1], 10);
  if (month === 12) {
    return `${year + 1}-01`;
  }
  return `${year}-${(month + 1).toString().padStart(2, "0")}`;
}

/** Get the previous month key (handles year rollover). */
export function prevMonthKey(monthKey: MonthKey): MonthKey {
  const parts = monthKey.split("-");
  const year = Number.parseInt(parts[0], 10);
  const month = Number.parseInt(parts[1], 10);
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${(month - 1).toString().padStart(2, "0")}`;
}

/** Update the savings target on an open plan. Rejects edits to closed months. */
export async function updateSavingsTarget(
  ownerId: OwnerId,
  input: UpdateTargetInput,
): Promise<UpdateTargetResult> {
  const validated = validateUpdateTargetInput(input);
  const plan = await withTransaction(async (client) => {
    const lockResult = await client.query<PlanRow>(
      `SELECT id, month_key, savings_target_cents, status, closed_at,
              created_at, updated_at
       FROM monthly_plans
       WHERE owner_id = $1 AND id = $2
       FOR UPDATE`,
      [ownerId, validated.planId],
    );
    if (lockResult.rows.length === 0) {
      throw new PlanNotFoundError("Plan not found");
    }
    const existing = mapPlan(lockResult.rows[0]);
    if (existing.status === "closed") {
      throw new ClosedMonthError("Cannot edit the savings target of a closed month");
    }
    const row = await client.query<PlanRow>(
      `UPDATE monthly_plans
       SET savings_target_cents = $3, updated_at = now()
       WHERE owner_id = $1 AND id = $2
       RETURNING id, month_key, savings_target_cents, status, closed_at,
                 created_at, updated_at`,
      [ownerId, validated.planId, validated.savingsTargetCents],
    );
    return mapPlan(row.rows[0]);
  });
  return { plan };
}

// --- Unique violation detection ---

function isUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: string }).code;
    return code === "23505";
  }
  return false;
}

// --- Month boundary helper ---

/**
 * Convert a Europe/Athens local date (year, month, day) into a month_key.
 * This is used by the generation service to determine which month a template
 * due-day falls into. The month_key is a calendar string, not a timestamp.
 */
export function monthKeyFromAthensDate(year: number, month: number): MonthKey {
  if (year < 1900 || year > 9999) {
    throw new PlanValidationError("Year must be between 1900 and 9999");
  }
  if (month < 1 || month > 12) {
    throw new PlanValidationError("Month must be between 1 and 12");
  }
  return `${year}-${month.toString().padStart(2, "0")}`;
}