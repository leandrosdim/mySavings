// Obligation service: owner-scoped CRUD for ordinary expenses and reserved
// commitments.
//
// All functions take an ownerId derived from the verified server session.
// No function accepts arbitrary unvalidated owner input from clients. Every
// write uses withTransaction (explicit BEGIN/COMMIT/ROLLBACK on one
// checked-out client). Financial cents are exact integers bounded by
// lib/finance/money.
//
// Key invariants enforced here:
// - The planned_cents is preserved. Partial settlements do not zero it.
//   Paid/remaining are derived from non-reversed settlements (sum of
//   settlements minus sum of reversals). No settlement writes happen in this
//   step — the derived totals are ready for Step10.
// - Revision rule: planned_cents cannot be lowered below the already-paid
//   amount (sum of non-reversed settlements). This prevents erasing paid
//   history by lowering the plan.
// - Cancellation (status -> cancelled) is rejected if the obligation has
//   non-reversed settlements. Paid history is never deleted.
// - Editing the title/due_date/linked_account does not mutate planned_cents
//   or settlements.
// - The month must have an open plan (FK on current_month_key enforces the
//   plan exists; service enforces open status for writes).
// - Reserve items (kind='reserved') are kept out of ordinary expense
//   aggregates by the kind filter. No duplicated reserve creation interface.
// - A weekly spending allowance is entered as a monthly budget, not silently
//   multiplied by an assumed four weeks.

import "server-only";
import { withTransaction, query } from "../db";
import type { OwnerId, MonthKey } from "../months/types";
import {
  ObligationNotFoundError,
  ObligationConflictError,
  ObligationValidationError,
  ObligationServiceError,
  ClosedMonthError,
  SettledHistoryError,
  type Obligation,
  type ObligationId,
  type ObligationKind,
  type ObligationStatus,
  type CreateObligationInput,
  type CreateObligationResult,
  type UpdateObligationInput,
  type UpdateObligationResult,
  type CancelObligationResult,
  type ReleaseObligationResult,
  type ObligationFilter,
} from "./types";
import {
  validateTitle,
  validateKind,
  validatePlannedCents,
  validateMonthKey,
  validateOptionalDate,
  validateOptionalAccountId,
  validateObligationId,
  validateCreateObligationInput,
  validateUpdateObligationInput,
} from "./validation";

export {
  ObligationNotFoundError,
  ObligationConflictError,
  ObligationValidationError,
  ObligationServiceError,
  ClosedMonthError,
  SettledHistoryError,
};

// --- Row types (raw DB shape, snake_case) ---

type ObligationRow = {
  id: string;
  kind: string;
  title: string;
  planned_cents: string;
  original_month_key: string;
  current_month_key: string;
  due_date: Date | null;
  linked_account_id: string | null;
  origin_template_id: string | null;
  linked_reserve_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
};

type SettlementTotalsRow = {
  paid_cents: string | null;
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

/** Format a DATE column (returned by pg in local time) as YYYY-MM-DD. */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mapObligation(
  row: ObligationRow,
  paidCents: number,
): Obligation {
  const planned = bigToInt(row.planned_cents) ?? 0;
  return {
    id: row.id,
    kind: row.kind as ObligationKind,
    title: row.title,
    plannedCents: planned,
    originalMonthKey: row.original_month_key,
    currentMonthKey: row.current_month_key,
    dueDate: row.due_date ? formatDate(row.due_date) : null,
    linkedAccountId: row.linked_account_id,
    originTemplateId: row.origin_template_id,
    linkedReserveId: row.linked_reserve_id,
    status: row.status as ObligationStatus,
    paidCents,
    remainingCents: planned - paidCents,
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

/** Parse a YYYY-MM-DD date string to a JS Date at noon UTC (avoids TZ edge). */
function parseDate(dateStr: string): Date {
  const parts = dateStr.split("-");
  const y = Number.parseInt(parts[0], 10);
  const m = Number.parseInt(parts[1], 10);
  const d = Number.parseInt(parts[2], 10);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

// --- Settlement totals ---

/**
 * Compute the paid amount for an obligation: sum of non-reversed settlements.
 * A settlement is reversed if a matching settlement_reversals row exists.
 */
async function computePaidCents(
  client: import("../db").PoolClient,
  ownerId: OwnerId,
  obligationId: string,
): Promise<number> {
  const result = await client.query<SettlementTotalsRow>(
    `SELECT COALESCE(SUM(s.amount_cents), 0)::text AS paid_cents
     FROM settlements s
     WHERE s.owner_id = $1 AND s.obligation_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM settlement_reversals r
         WHERE r.owner_id = $1 AND r.original_settlement_id = s.id
       )`,
    [ownerId, obligationId],
  );
  return bigToInt(result.rows[0]?.paid_cents) ?? 0;
}

/** Load the paid amount for a single obligation using the pool query. */
async function computePaidCentsReadOnly(
  ownerId: OwnerId,
  obligationId: string,
): Promise<number> {
  const result = await query<SettlementTotalsRow>(
    `SELECT COALESCE(SUM(s.amount_cents), 0)::text AS paid_cents
     FROM settlements s
     WHERE s.owner_id = $1 AND s.obligation_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM settlement_reversals r
         WHERE r.owner_id = $1 AND r.original_settlement_id = s.id
       )`,
    [ownerId, obligationId],
  );
  return bigToInt(result.rows[0]?.paid_cents) ?? 0;
}

/** Load paid amounts for multiple obligations in one query. */
async function computePaidCentsBatch(
  ownerId: OwnerId,
  obligationIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (obligationIds.length === 0) return map;
  const result = await query<{ obligation_id: string; paid_cents: string }>(
    `SELECT s.obligation_id, COALESCE(SUM(s.amount_cents), 0)::text AS paid_cents
     FROM settlements s
     WHERE s.owner_id = $1 AND s.obligation_id = ANY($2::bigint[])
       AND NOT EXISTS (
         SELECT 1 FROM settlement_reversals r
         WHERE r.owner_id = $1 AND r.original_settlement_id = s.id
       )
     GROUP BY s.obligation_id`,
    [ownerId, obligationIds],
  );
  for (const row of result.rows) {
    map.set(row.obligation_id, bigToInt(row.paid_cents) ?? 0);
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
    throw new ObligationValidationError(
      `No plan exists for ${monthKey}; create a plan first`,
    );
  }
  if (result.rows[0].status === "closed") {
    throw new ClosedMonthError(`Month ${monthKey} is closed and cannot be edited`);
  }
}

// --- Linked-reserve validation ---

type LinkedReserveRow = {
  id: string;
  kind: string;
  planned_cents: string;
  status: string;
};

/**
 * Validate that an ordinary expense's linkedReserveId points to an
 * owner-scoped reserved obligation. The linked reserve must belong to the
 * same owner, be of kind 'reserved', and have a matching representation when
 * the caller provides planned/amount context. This prevents a free
 * client-controlled cross-owner relation and double-counting of the same
 * liability in both E and R.
 *
 * When `expectedPlannedCents` is provided, the ordinary expense's planned
 * amount must match the reserve's planned amount exactly. This enforces "one
 * canonical liability": the ordinary entry is a *presentation* of the reserve,
 * not a separate liability, so its amount must equal the reserve's amount.
 */
async function validateLinkedReserve(
  client: import("../db").PoolClient,
  ownerId: OwnerId,
  linkedReserveId: string,
  expectedPlannedCents?: number,
): Promise<void> {
  const result = await client.query<LinkedReserveRow>(
    `SELECT id::text, kind, planned_cents::text, status
     FROM obligations
     WHERE owner_id = $1 AND id = $2
     FOR UPDATE`,
    [ownerId, linkedReserveId],
  );
  if (result.rows.length === 0) {
    throw new ObligationValidationError(
      "The linked reserved commitment does not exist or does not belong to you",
    );
  }
  const row = result.rows[0];
  if (row.kind !== "reserved") {
    throw new ObligationValidationError(
      "The linked obligation is not a reserved commitment",
    );
  }
  if (row.status === "cancelled") {
    throw new ObligationValidationError(
      "Cannot link to a cancelled reserved commitment",
    );
  }
  if (expectedPlannedCents !== undefined) {
    const reservePlanned = bigToInt(row.planned_cents) ?? 0;
    if (reservePlanned !== expectedPlannedCents) {
      throw new ObligationConflictError(
        "The linked ordinary expense must have the same planned amount as the reserved commitment it presents",
      );
    }
  }
}

// --- Obligation CRUD ---

/** Create a new obligation for the given owner + month. */
export async function createObligation(
  ownerId: OwnerId,
  input: CreateObligationInput,
): Promise<CreateObligationResult> {
  const validated = validateCreateObligationInput(input);
  try {
    const obligation = await withTransaction(async (client) => {
      await requireOpenMonth(client, ownerId, validated.monthKey);
      // Validate the linked reserve (owner-scoped, kind=reserved, matching
      // amount) when an ordinary expense links to a reserve for display.
      const linkedReserveId = validated.linkedReserveId ?? null;
      if (linkedReserveId !== null) {
        await validateLinkedReserve(
          client,
          ownerId,
          linkedReserveId,
          validated.plannedCents,
        );
      }
      const row = await client.query<ObligationRow>(
        `INSERT INTO obligations
           (owner_id, kind, title, planned_cents, original_month_key,
            current_month_key, due_date, linked_account_id, linked_reserve_id,
            status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
         RETURNING id, kind, title, planned_cents, original_month_key,
                   current_month_key, due_date, linked_account_id,
                   origin_template_id, linked_reserve_id, status,
                   created_at, updated_at`,
        [
          ownerId,
          validated.kind,
          validated.title,
          validated.plannedCents,
          validated.monthKey,
          validated.monthKey,
          validated.dueDate ? parseDate(validated.dueDate) : null,
          validated.linkedAccountId,
          linkedReserveId,
        ],
      );
      return mapObligation(row.rows[0], 0);
    });
    return { obligation };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ObligationConflictError(
        "A duplicate obligation already exists",
      );
    }
    if (isForeignKeyViolation(error)) {
      throw new ObligationValidationError(
        "The selected account does not exist or does not belong to you",
      );
    }
    throw error;
  }
}

/** Fetch a single obligation by ID. Throws ObligationNotFoundError if missing or cross-owner. */
export async function getObligation(
  ownerId: OwnerId,
  obligationId: ObligationId,
): Promise<Obligation> {
  const id = validateObligationId(obligationId);
  const result = await query<ObligationRow>(
    `SELECT id, kind, title, planned_cents, original_month_key,
            current_month_key, due_date, linked_account_id,
            origin_template_id, linked_reserve_id, status,
            created_at, updated_at
     FROM obligations
     WHERE owner_id = $1 AND id = $2`,
    [ownerId, id],
  );
  if (result.rows.length === 0) {
    throw new ObligationNotFoundError("Obligation not found");
  }
  const paid = await computePaidCentsReadOnly(ownerId, id);
  return mapObligation(result.rows[0], paid);
}

/** List obligations for the owner with optional filters. */
export async function listObligations(
  ownerId: OwnerId,
  filter: ObligationFilter = {},
): Promise<Obligation[]> {
  const conditions: string[] = ["owner_id = $1"];
  const params: unknown[] = [ownerId];
  let paramIdx = 2;

  if (filter.monthKey !== undefined) {
    validateMonthKey(filter.monthKey);
    conditions.push(`current_month_key = $${paramIdx++}`);
    params.push(filter.monthKey);
  }
  if (filter.kind !== undefined) {
    validateKind(filter.kind);
    conditions.push(`kind = $${paramIdx++}`);
    params.push(filter.kind);
  }
  if (filter.status !== undefined) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(filter.status);
  }
  // By default, exclude reserved from ordinary expense aggregates unless
  // explicitly requested. When kind is 'ordinary', reserved is always excluded.
  // When kind is 'reserved', only reserved is returned. When no kind is given
  // and includeReserved is not true, exclude reserved.
  if (filter.kind === "ordinary") {
    // already filtered to ordinary
  } else if (filter.kind === "reserved") {
    // already filtered to reserved
  } else if (filter.includeReserved !== true) {
    conditions.push(`kind <> 'reserved'`);
  }

  const whereClause = conditions.join(" AND ");
  const result = await query<ObligationRow>(
    `SELECT id, kind, title, planned_cents, original_month_key,
            current_month_key, due_date, linked_account_id,
            origin_template_id, linked_reserve_id, status,
            created_at, updated_at
     FROM obligations
     WHERE ${whereClause}
     ORDER BY due_date NULLS LAST, id ASC`,
    params,
  );
  const ids = result.rows.map((r) => r.id);
  const paidMap = await computePaidCentsBatch(ownerId, ids);
  return result.rows.map((r) =>
    mapObligation(r, paidMap.get(r.id) ?? 0),
  );
}

/** Update an obligation. Enforces revision rules preserving paid history. */
export async function updateObligation(
  ownerId: OwnerId,
  obligationId: ObligationId,
  input: UpdateObligationInput,
): Promise<UpdateObligationResult> {
  const id = validateObligationId(obligationId);
  const validated = validateUpdateObligationInput(input);
  const obligation = await withTransaction(async (client) => {
    const lockResult = await client.query<ObligationRow>(
      `SELECT id, kind, title, planned_cents, original_month_key,
              current_month_key, due_date, linked_account_id,
              origin_template_id, linked_reserve_id, status,
              created_at, updated_at
       FROM obligations
       WHERE owner_id = $1 AND id = $2
       FOR UPDATE`,
      [ownerId, id],
    );
    if (lockResult.rows.length === 0) {
      throw new ObligationNotFoundError("Obligation not found");
    }
    const existing = lockResult.rows[0];

    // Check the month is open for edits.
    const planResult = await client.query<PlanStatusRow>(
      `SELECT status FROM monthly_plans
       WHERE owner_id = $1 AND month_key = $2`,
      [ownerId, existing.current_month_key],
    );
    if (planResult.rows[0]?.status === "closed") {
      throw new ClosedMonthError(
        `Month ${existing.current_month_key} is closed and cannot be edited`,
      );
    }

    // Compute current paid amount to enforce revision rules.
    const paidCents = await computePaidCents(client, ownerId, id);

    const newTitle = validated.title ?? existing.title;
    const newDueDate =
      validated.dueDate === undefined
        ? existing.due_date
        : validated.dueDate
          ? parseDate(validated.dueDate)
          : null;
    const newAccountId =
      validated.linkedAccountId === undefined
        ? existing.linked_account_id
        : validated.linkedAccountId;

    // Resolve the new linked_reserve_id. Only an ordinary expense may link
    // to a reserve; a reserved obligation must never carry a linked reserve
    // (that would create a second liability representation).
    let newLinkedReserveId: string | null;
    if (validated.linkedReserveId === undefined) {
      newLinkedReserveId = existing.linked_reserve_id;
    } else {
      newLinkedReserveId = validated.linkedReserveId;
      if (newLinkedReserveId !== null && existing.kind !== "ordinary") {
        throw new ObligationValidationError(
          "Only an ordinary expense may link to a reserved commitment",
        );
      }
      if (newLinkedReserveId !== null) {
        // The ordinary expense's planned amount (after this update) must
        // match the linked reserve's planned amount exactly so the same
        // liability is never counted in both E and R.
        const plannedForLink =
          validated.plannedCents !== undefined
            ? validated.plannedCents
            : (bigToInt(existing.planned_cents) ?? 0);
        await validateLinkedReserve(
          client,
          ownerId,
          newLinkedReserveId,
          plannedForLink,
        );
      }
    }

    let newPlannedCents: number;
    if (validated.plannedCents !== undefined) {
      newPlannedCents = validated.plannedCents;
      // Revision rule: cannot lower planned below already-paid amount.
      if (newPlannedCents < paidCents) {
        throw new SettledHistoryError(
          "Cannot lower the planned amount below the already-paid amount",
        );
      }
      // When linked to a reserve, the planned amount must equal the reserve's
      // planned amount. If the amount changed, re-validate the link.
      if (
        newLinkedReserveId !== null &&
        validated.plannedCents !== undefined &&
        validated.linkedReserveId === undefined
      ) {
        await validateLinkedReserve(
          client,
          ownerId,
          newLinkedReserveId,
          newPlannedCents,
        );
      }
    } else {
      newPlannedCents = bigToInt(existing.planned_cents) ?? 0;
    }

    try {
      const row = await client.query<ObligationRow>(
        `UPDATE obligations
         SET title = $3, planned_cents = $4, due_date = $5,
             linked_account_id = $6, linked_reserve_id = $7, updated_at = now()
         WHERE owner_id = $1 AND id = $2
         RETURNING id, kind, title, planned_cents, original_month_key,
                   current_month_key, due_date, linked_account_id,
                   origin_template_id, linked_reserve_id, status,
                   created_at, updated_at`,
        [ownerId, id, newTitle, newPlannedCents, newDueDate, newAccountId, newLinkedReserveId],
      );
      return mapObligation(row.rows[0], paidCents);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ObligationValidationError(
          "The selected account or linked reserve does not exist or does not belong to you",
        );
      }
      throw error;
    }
  });
  return { obligation };
}

/** Cancel an obligation. Rejects if it has non-reversed settlements. */
export async function cancelObligation(
  ownerId: OwnerId,
  obligationId: ObligationId,
): Promise<CancelObligationResult> {
  const id = validateObligationId(obligationId);
  const obligation = await withTransaction(async (client) => {
    const lockResult = await client.query<ObligationRow>(
      `SELECT id, kind, title, planned_cents, original_month_key,
              current_month_key, due_date, linked_account_id,
              origin_template_id, linked_reserve_id, status,
              created_at, updated_at
       FROM obligations
       WHERE owner_id = $1 AND id = $2
       FOR UPDATE`,
      [ownerId, id],
    );
    if (lockResult.rows.length === 0) {
      throw new ObligationNotFoundError("Obligation not found");
    }
    const existing = lockResult.rows[0];
    if (existing.status === "cancelled") {
      return mapObligation(existing, await computePaidCents(client, ownerId, id));
    }

    // Check the month is open.
    const planResult = await client.query<PlanStatusRow>(
      `SELECT status FROM monthly_plans
       WHERE owner_id = $1 AND month_key = $2`,
      [ownerId, existing.current_month_key],
    );
    if (planResult.rows[0]?.status === "closed") {
      throw new ClosedMonthError(
        `Month ${existing.current_month_key} is closed and cannot be edited`,
      );
    }

    // Reject cancellation if there are non-reversed settlements.
    const paidCents = await computePaidCents(client, ownerId, id);
    if (paidCents > 0) {
      throw new SettledHistoryError(
        "Cannot cancel an obligation with paid settlement history; reverse the settlements first",
      );
    }

    const row = await client.query<ObligationRow>(
      `UPDATE obligations
       SET status = 'cancelled', updated_at = now()
       WHERE owner_id = $1 AND id = $2
       RETURNING id, kind, title, planned_cents, original_month_key,
                 current_month_key, due_date, linked_account_id,
                 origin_template_id, linked_reserve_id, status,
                 created_at, updated_at`,
      [ownerId, id],
    );
    return mapObligation(row.rows[0], paidCents);
  });
  return { obligation };
}

/**
 * Release the unpaid remainder of an obligation. The status transitions to
 * 'released'; the planned_cents is preserved and paid history is never
 * deleted. The outstanding amount (planned minus paid) is un-protected from
 * the spendable calculation, but the row and its settlement history remain.
 *
 * Release is intended for reserved commitments whose remainder will never be
 * paid (e.g. a tax estimate that was lowered). It is audited. An obligation
 * with non-reversed settlements can still be released: the paid portion stays
 * settled and only the unpaid remainder is released. Releasing an already-
 * released obligation is idempotent.
 *
 * Release is rejected on a closed month (immutable snapshots). Cancelled
 * obligations cannot be released (they are already removed from the
 * spendable calculation).
 */
export async function releaseObligation(
  ownerId: OwnerId,
  obligationId: ObligationId,
): Promise<ReleaseObligationResult> {
  const id = validateObligationId(obligationId);
  const obligation = await withTransaction(async (client) => {
    const lockResult = await client.query<ObligationRow>(
      `SELECT id, kind, title, planned_cents, original_month_key,
              current_month_key, due_date, linked_account_id,
              origin_template_id, linked_reserve_id, status,
              created_at, updated_at
       FROM obligations
       WHERE owner_id = $1 AND id = $2
       FOR UPDATE`,
      [ownerId, id],
    );
    if (lockResult.rows.length === 0) {
      throw new ObligationNotFoundError("Obligation not found");
    }
    const existing = lockResult.rows[0];

    // Idempotent: releasing an already-released obligation returns it.
    if (existing.status === "released") {
      return mapObligation(existing, await computePaidCents(client, ownerId, id));
    }

    // Cancelled obligations are already removed from the spendable
    // calculation; releasing them is not meaningful.
    if (existing.status === "cancelled") {
      throw new ObligationValidationError(
        "Cannot release a cancelled obligation",
      );
    }

    // Check the month is open (closed snapshots are immutable).
    const planResult = await client.query<PlanStatusRow>(
      `SELECT status FROM monthly_plans
       WHERE owner_id = $1 AND month_key = $2`,
      [ownerId, existing.current_month_key],
    );
    if (planResult.rows[0]?.status === "closed") {
      throw new ClosedMonthError(
        `Month ${existing.current_month_key} is closed and cannot be edited`,
      );
    }

    const paidCents = await computePaidCents(client, ownerId, id);
    const plannedCents = bigToInt(existing.planned_cents) ?? 0;
    const releasedCents = plannedCents - paidCents;

    const row = await client.query<ObligationRow>(
      `UPDATE obligations
       SET status = 'released', updated_at = now()
       WHERE owner_id = $1 AND id = $2
       RETURNING id, kind, title, planned_cents, original_month_key,
                 current_month_key, due_date, linked_account_id,
                 origin_template_id, linked_reserve_id, status,
                 created_at, updated_at`,
      [ownerId, id],
    );

    // Audit the release. The summary records the released (unpaid remainder)
    // amount without exposing internal IDs beyond the entity_id column.
    await client.query(
      `INSERT INTO audit_log (owner_id, operation_type, entity_type, entity_id, summary)
       VALUES ($1, 'obligation_release', 'obligation', $2, $3)`,
      [
        ownerId,
        id,
        `Released ${releasedCents} cents unpaid remainder of obligation`,
      ],
    );

    return mapObligation(row.rows[0], paidCents);
  });
  return { obligation };
}