// Income expectation service: owner-scoped CRUD for expected monthly income.
//
// All functions take an ownerId derived from the verified server session.
// No function accepts arbitrary unvalidated owner input from clients. Every
// write uses withTransaction (explicit BEGIN/COMMIT/ROLLBACK on one
// checked-out client). Financial cents are exact integers bounded by
// lib/finance/money.
//
// Key invariants enforced here:
// - The expected_cents is preserved. Received/pending are derived from
//   non-reversed income_receipts (sum of receipts minus reversals).
//   No receipt writes happen in this step — the derived totals are ready
//   for Step10.
// - Revision rule: expected_cents cannot be lowered below the already-
//   received amount. This prevents erasing receipt history.
// - Cancellation is rejected if the income has non-reversed receipts.
// - Income cannot be simultaneously counted as already in B and still
//   pending without a visible reconciliation task. The UI shows
//   received/pending distinctly so the user can reconcile.
// - The month must have an open plan (FK on month_key enforces the plan
//   exists; service enforces open status for writes).
// - Manual bank refresh must not imply an automatic receipt. Receipts are
//   only created in Step10.

import "server-only";
import { withTransaction, query } from "../db";
import type { OwnerId, MonthKey } from "../months/types";
import {
  IncomeNotFoundError,
  IncomeConflictError,
  IncomeValidationError,
  IncomeServiceError,
  IncomeClosedMonthError,
  ReceiptHistoryError,
  type IncomeExpectation,
  type IncomeId,
  type IncomeStatus,
  type CreateIncomeInput,
  type CreateIncomeResult,
  type UpdateIncomeInput,
  type UpdateIncomeResult,
  type CancelIncomeResult,
  type IncomeFilter,
} from "./types";
import {
  validateSourceName,
  validateExpectedCents,
  validateMonthKey,
  validateOptionalAccountId,
  validateIncomeId,
  validateCreateIncomeInput,
  validateUpdateIncomeInput,
} from "./validation";

export {
  IncomeNotFoundError,
  IncomeConflictError,
  IncomeValidationError,
  IncomeServiceError,
  IncomeClosedMonthError,
  ReceiptHistoryError,
};

// --- Row types (raw DB shape, snake_case) ---

type IncomeRow = {
  id: string;
  month_key: string;
  source_name: string;
  expected_cents: string;
  linked_account_id: string | null;
  origin_template_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
};

type ReceiptTotalsRow = {
  received_cents: string | null;
};

type PlanStatusRow = {
  status: string;
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

function mapIncome(row: IncomeRow, receivedCents: number): IncomeExpectation {
  const expected = bigToInt(row.expected_cents) ?? 0;
  return {
    id: row.id,
    monthKey: row.month_key,
    sourceName: row.source_name,
    expectedCents: expected,
    linkedAccountId: row.linked_account_id,
    originTemplateId: row.origin_template_id,
    status: row.status as IncomeStatus,
    receivedCents,
    pendingCents: expected - receivedCents,
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

function isForeignKeyViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: string }).code;
    return code === "23503";
  }
  return false;
}

// --- Receipt totals ---

/**
 * Compute the received amount for an income expectation: sum of non-reversed
 * income_receipts. A receipt is reversed if a matching
 * income_receipt_reversals row exists.
 */
async function computeReceivedCents(
  client: import("../db").PoolClient,
  ownerId: OwnerId,
  incomeId: string,
): Promise<number> {
  const result = await client.query<ReceiptTotalsRow>(
    `SELECT COALESCE(SUM(r.amount_cents), 0)::text AS received_cents
     FROM income_receipts r
     WHERE r.owner_id = $1 AND r.income_expectation_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM income_receipt_reversals rev
         WHERE rev.owner_id = $1 AND rev.original_receipt_id = r.id
       )`,
    [ownerId, incomeId],
  );
  return bigToInt(result.rows[0]?.received_cents) ?? 0;
}

/** Load the received amount for a single income using the pool query. */
async function computeReceivedCentsReadOnly(
  ownerId: OwnerId,
  incomeId: string,
): Promise<number> {
  const result = await query<ReceiptTotalsRow>(
    `SELECT COALESCE(SUM(r.amount_cents), 0)::text AS received_cents
     FROM income_receipts r
     WHERE r.owner_id = $1 AND r.income_expectation_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM income_receipt_reversals rev
         WHERE rev.owner_id = $1 AND rev.original_receipt_id = r.id
       )`,
    [ownerId, incomeId],
  );
  return bigToInt(result.rows[0]?.received_cents) ?? 0;
}

/** Load received amounts for multiple income expectations in one query. */
async function computeReceivedCentsBatch(
  ownerId: OwnerId,
  incomeIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (incomeIds.length === 0) return map;
  const result = await query<{ income_expectation_id: string; received_cents: string }>(
    `SELECT r.income_expectation_id, COALESCE(SUM(r.amount_cents), 0)::text AS received_cents
     FROM income_receipts r
     WHERE r.owner_id = $1 AND r.income_expectation_id = ANY($2::bigint[])
       AND NOT EXISTS (
         SELECT 1 FROM income_receipt_reversals rev
         WHERE rev.owner_id = $1 AND rev.original_receipt_id = r.id
       )
     GROUP BY r.income_expectation_id`,
    [ownerId, incomeIds],
  );
  for (const row of result.rows) {
    map.set(row.income_expectation_id, bigToInt(row.received_cents) ?? 0);
  }
  return map;
}

// --- Plan status check ---

async function requireOpenMonth(
  client: import("../db").PoolClient,
  ownerId: OwnerId,
  monthKey: string,
): Promise<void> {
  const result = await client.query<PlanStatusRow>(
    `SELECT status FROM monthly_plans
     WHERE owner_id = $1 AND month_key = $2`,
    [ownerId, monthKey],
  );
  if (result.rows.length === 0) {
    throw new IncomeValidationError(
      `No plan exists for ${monthKey}; create a plan first`,
    );
  }
  if (result.rows[0].status === "closed") {
    throw new IncomeClosedMonthError(`Month ${monthKey} is closed and cannot be edited`);
  }
}

// --- Income CRUD ---

/** Create a new income expectation for the given owner + month. */
export async function createIncome(
  ownerId: OwnerId,
  input: CreateIncomeInput,
): Promise<CreateIncomeResult> {
  const validated = validateCreateIncomeInput(input);
  try {
    const income = await withTransaction(async (client) => {
      await requireOpenMonth(client, ownerId, validated.monthKey);
      const row = await client.query<IncomeRow>(
        `INSERT INTO income_expectations
           (owner_id, month_key, source_name, expected_cents,
            linked_account_id, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING id, month_key, source_name, expected_cents,
                   linked_account_id, origin_template_id, status,
                   created_at, updated_at`,
        [
          ownerId,
          validated.monthKey,
          validated.sourceName,
          validated.expectedCents,
          validated.linkedAccountId,
        ],
      );
      return mapIncome(row.rows[0], 0);
    });
    return { income };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new IncomeConflictError(
        "An income expectation with this source name already exists for this month",
      );
    }
    if (isForeignKeyViolation(error)) {
      throw new IncomeValidationError(
        "The selected account does not exist or does not belong to you",
      );
    }
    throw error;
  }
}

/** Fetch a single income expectation by ID. Throws IncomeNotFoundError if missing or cross-owner. */
export async function getIncome(
  ownerId: OwnerId,
  incomeId: IncomeId,
): Promise<IncomeExpectation> {
  const id = validateIncomeId(incomeId);
  const result = await query<IncomeRow>(
    `SELECT id, month_key, source_name, expected_cents,
            linked_account_id, origin_template_id, status,
            created_at, updated_at
     FROM income_expectations
     WHERE owner_id = $1 AND id = $2`,
    [ownerId, id],
  );
  if (result.rows.length === 0) {
    throw new IncomeNotFoundError("Income expectation not found");
  }
  const received = await computeReceivedCentsReadOnly(ownerId, id);
  return mapIncome(result.rows[0], received);
}

/** List income expectations for the owner with optional filters. */
export async function listIncome(
  ownerId: OwnerId,
  filter: IncomeFilter = {},
): Promise<IncomeExpectation[]> {
  const conditions: string[] = ["owner_id = $1"];
  const params: unknown[] = [ownerId];
  let paramIdx = 2;

  if (filter.monthKey !== undefined) {
    validateMonthKey(filter.monthKey);
    conditions.push(`month_key = $${paramIdx++}`);
    params.push(filter.monthKey);
  }
  if (filter.status !== undefined) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(filter.status);
  }

  const whereClause = conditions.join(" AND ");
  const result = await query<IncomeRow>(
    `SELECT id, month_key, source_name, expected_cents,
            linked_account_id, origin_template_id, status,
            created_at, updated_at
     FROM income_expectations
     WHERE ${whereClause}
     ORDER BY id ASC`,
    params,
  );
  const ids = result.rows.map((r) => r.id);
  const receivedMap = await computeReceivedCentsBatch(ownerId, ids);
  return result.rows.map((r) =>
    mapIncome(r, receivedMap.get(r.id) ?? 0),
  );
}

/** Update an income expectation. Enforces revision rules preserving receipt history. */
export async function updateIncome(
  ownerId: OwnerId,
  incomeId: IncomeId,
  input: UpdateIncomeInput,
): Promise<UpdateIncomeResult> {
  const id = validateIncomeId(incomeId);
  const validated = validateUpdateIncomeInput(input);
  const income = await withTransaction(async (client) => {
    const lockResult = await client.query<IncomeRow>(
      `SELECT id, month_key, source_name, expected_cents,
              linked_account_id, origin_template_id, status,
              created_at, updated_at
       FROM income_expectations
       WHERE owner_id = $1 AND id = $2
       FOR UPDATE`,
      [ownerId, id],
    );
    if (lockResult.rows.length === 0) {
      throw new IncomeNotFoundError("Income expectation not found");
    }
    const existing = lockResult.rows[0];

    // Check the month is open for edits.
    const planResult = await client.query<PlanStatusRow>(
      `SELECT status FROM monthly_plans
       WHERE owner_id = $1 AND month_key = $2`,
      [ownerId, existing.month_key],
    );
    if (planResult.rows[0]?.status === "closed") {
      throw new IncomeClosedMonthError(
        `Month ${existing.month_key} is closed and cannot be edited`,
      );
    }

    // Compute current received amount to enforce revision rules.
    const receivedCents = await computeReceivedCents(client, ownerId, id);

    const newSourceName = validated.sourceName ?? existing.source_name;
    const newAccountId =
      validated.linkedAccountId === undefined
        ? existing.linked_account_id
        : validated.linkedAccountId;

    let newExpectedCents: number;
    if (validated.expectedCents !== undefined) {
      newExpectedCents = validated.expectedCents;
      // Revision rule: cannot lower expected below already-received amount.
      if (newExpectedCents < receivedCents) {
        throw new ReceiptHistoryError(
          "Cannot lower the expected amount below the already-received amount",
        );
      }
    } else {
      newExpectedCents = bigToInt(existing.expected_cents) ?? 0;
    }

    try {
      const row = await client.query<IncomeRow>(
        `UPDATE income_expectations
         SET source_name = $3, expected_cents = $4, linked_account_id = $5,
             updated_at = now()
         WHERE owner_id = $1 AND id = $2
         RETURNING id, month_key, source_name, expected_cents,
                   linked_account_id, origin_template_id, status,
                   created_at, updated_at`,
        [ownerId, id, newSourceName, newExpectedCents, newAccountId],
      );
      return mapIncome(row.rows[0], receivedCents);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new IncomeConflictError(
          "An income expectation with this source name already exists for this month",
        );
      }
      if (isForeignKeyViolation(error)) {
        throw new IncomeValidationError(
          "The selected account does not exist or does not belong to you",
        );
      }
      throw error;
    }
  });
  return { income };
}

/** Cancel an income expectation. Rejects if it has non-reversed receipts. */
export async function cancelIncome(
  ownerId: OwnerId,
  incomeId: IncomeId,
): Promise<CancelIncomeResult> {
  const id = validateIncomeId(incomeId);
  const income = await withTransaction(async (client) => {
    const lockResult = await client.query<IncomeRow>(
      `SELECT id, month_key, source_name, expected_cents,
              linked_account_id, origin_template_id, status,
              created_at, updated_at
       FROM income_expectations
       WHERE owner_id = $1 AND id = $2
       FOR UPDATE`,
      [ownerId, id],
    );
    if (lockResult.rows.length === 0) {
      throw new IncomeNotFoundError("Income expectation not found");
    }
    const existing = lockResult.rows[0];
    if (existing.status === "cancelled") {
      return mapIncome(existing, await computeReceivedCents(client, ownerId, id));
    }

    // Check the month is open.
    const planResult = await client.query<PlanStatusRow>(
      `SELECT status FROM monthly_plans
       WHERE owner_id = $1 AND month_key = $2`,
      [ownerId, existing.month_key],
    );
    if (planResult.rows[0]?.status === "closed") {
      throw new IncomeClosedMonthError(
        `Month ${existing.month_key} is closed and cannot be edited`,
      );
    }

    // Reject cancellation if there are non-reversed receipts.
    const receivedCents = await computeReceivedCents(client, ownerId, id);
    if (receivedCents > 0) {
      throw new ReceiptHistoryError(
        "Cannot cancel an income expectation with received receipt history; reverse the receipts first",
      );
    }

    const row = await client.query<IncomeRow>(
      `UPDATE income_expectations
       SET status = 'cancelled', updated_at = now()
       WHERE owner_id = $1 AND id = $2
       RETURNING id, month_key, source_name, expected_cents,
                 linked_account_id, origin_template_id, status,
                 created_at, updated_at`,
      [ownerId, id],
    );
    return mapIncome(row.rows[0], receivedCents);
  });
  return { income };
}