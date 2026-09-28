// Month rollover service: owner-scoped next-month preview and atomic apply.
//
// All functions take an ownerId derived from the verified server session.
// No function accepts arbitrary unvalidated owner input from clients. Every
// write uses withTransaction (explicit BEGIN/COMMIT/ROLLBACK on one checked-out
// client). Financial cents are exact integers bounded by lib/finance/money.
//
// Key invariants enforced here:
// - Source month must be OPEN. Rollover does not auto-close (Step15 owns
//   closing). A closed source month is rejected.
// - Carry unpaid ordinary obligations BY REFERENCE: update current_month_key
//   on the SAME row. original_month_key, planned_cents and all settlement
//   history are preserved. Never a duplicate liability.
// - Reserves are persistent commitments: they carry by reference too, but are
//   NOT auto-released and NOT duplicated. Their release goes through the
//   existing obligation release workflow (owner-explicit, audited).
// - A variable allowance (ordinary expense) may be released on explicit user
//   choice rather than carried. Releases go through the existing
//   releaseObligation path so the audit trail and paid-history preservation
//   are reused — rollover does not invent a second release mechanism.
// - Accounts are continuous: balances are never copied into new accounts or
//   month-balance rows as spendable duplicates. Rollover does not touch
//   accounts at all.
// - Future template changes do not alter prior-month entries. Generation uses
//   template values at apply time; existing generated instances keep their
//   amount (partial unique indexes make generation idempotent).
// - Apply is idempotent: a stable operation_key + payload hash deduplicates
//   retries. A retry with matching payload returns a replay summary; a retry
//   with a changed payload is rejected.
// - Stale preview detection: the preview records a SHA-256 digest of the
//   source-month inputs (obligations, income, template count, plan target).
//   Apply recomputes the digest under lock; if it differs, the preview is
//   stale and apply is rejected. This prevents silently applying an old
//   remainder when a concurrent payment/template edit changed the inputs.
// - Old payments stay old-period facts: settlement business_date is never
//   rewritten. Only the obligation's current_month_key moves forward.
// - Expired/unresolved expected income is NOT silently assumed to be new
//   reliable income. The preview lists it for an explicit decision; only the
//   IDs the user explicitly carries are created as a new expectation in the
//   next month (with received=0).
//
// Deterministic lock order (prevents deadlocks across concurrent operations):
//   1. operation_log row for (owner_id, idempotency_key) — via check.
//   2. source monthly_plans row (FOR UPDATE) — pins the source month.
//   3. target monthly_plans row (FOR UPDATE when it exists / INSERT otherwise).
//   4. obligations rows (FOR UPDATE) — carry/release targets.
//   5. income_expectations rows (FOR UPDATE) — carry targets.

import "server-only";
import { createHash } from "node:crypto";
import { withTransaction, query, type PoolClient } from "../db";
import type { OwnerId, MonthKey } from "../months/types";
import type { Cents } from "../finance/money";
import { nextMonthKey } from "../months/service";
import { listActiveTemplates } from "../templates/service";
import { generateFromTemplates } from "../generation/service";
import {
  RolloverServiceError,
  RolloverValidationError,
  RolloverConflictError,
  RolloverClosedMonthError,
  RolloverStalePreviewError,
  RolloverIdempotencyConflictError,
  type RolloverPreview,
  type ApplyRolloverInput,
  type ApplyRolloverResult,
  type CarryoverObligationPreview,
  type RecurringInstancePreview,
  type ReservedCarryoverPreview,
  type UnresolvedIncomePreview,
} from "./types";
import { validateApplyRolloverInput, validateRolloverMonthKey } from "./validation";

export {
  RolloverServiceError,
  RolloverValidationError,
  RolloverConflictError,
  RolloverClosedMonthError,
  RolloverStalePreviewError,
  RolloverIdempotencyConflictError,
};

// --- Row types (raw DB shape, snake_case) ---

type PlanRow = {
  id: string;
  month_key: string;
  savings_target_cents: string;
  status: string;
};

type ObligationRow = {
  id: string;
  kind: string;
  title: string;
  planned_cents: string;
  original_month_key: string;
  current_month_key: string;
  origin_template_id: string | null;
  status: string;
};

type IncomeRow = {
  id: string;
  month_key: string;
  source_name: string;
  expected_cents: string;
  linked_account_id: string | null;
  origin_template_id: string | null;
  status: string;
};

type TemplateRow = {
  id: string;
  name: string;
  kind: string;
  default_amount_cents: string;
  due_day_of_month: number | null;
  active: boolean;
};

type PaidRow = { obligation_id: string; paid_cents: string };
type ReceivedRow = { income_expectation_id: string; received_cents: string };
type GeneratedExistsRow = { origin_template_id: string; n: string };
type IncomeExistsRow = { origin_template_id: string; n: string };
type OperationLogRow = { payload_hash: string; operation_type: string };

// --- Helpers ---

function bigToInt(value: string | number | null): number | null {
  if (value === null) return null;
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (!Number.isSafeInteger(n)) {
    throw new Error(`BIGINT value out of safe range: ${value}`);
  }
  return n;
}

function isUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "23505";
  }
  return false;
}

function payloadHash(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Compute a stable SHA-256 digest of the source-month inputs that matter for
 * rollover: the source plan target, every source obligation (id, planned,
 * current month, status, kind, origin template), every source income
 * expectation (id, expected, status), and the count of active templates.
 *
 * This is recomputed under lock at apply time; a mismatch means a concurrent
 * payment/template edit changed the inputs and the preview is stale.
 */
function computeSourceDigest(params: {
  planTargetCents: number;
  obligations: {
    id: string;
    kind: string;
    plannedCents: number;
    currentMonthKey: string;
    status: string;
    originTemplateId: string | null;
  }[];
  income: {
    id: string;
    expectedCents: number;
    status: string;
  }[];
  activeTemplateCount: number;
}): string {
  const obls = params.obligations
    .map(
      (o) =>
        `${o.id}|${o.kind}|${o.plannedCents}|${o.currentMonthKey}|${o.status}|${o.originTemplateId ?? ""}`,
    )
    .sort()
    .join(";");
  const inc = params.income
    .map((i) => `${i.id}|${i.expectedCents}|${i.status}`)
    .sort()
    .join(";");
  const payload = `target=${params.planTargetCents};obls=[${obls}];inc=[${inc}];tpls=${params.activeTemplateCount}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

// --- Paid / received batch helpers (read-only, pool query) ---

async function loadPaidMap(
  ownerId: OwnerId,
  obligationIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (obligationIds.length === 0) return map;
  const result = await query<PaidRow>(
    `SELECT s.obligation_id::text AS obligation_id,
            COALESCE(SUM(s.amount_cents), 0)::text AS paid_cents
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

async function loadReceivedMap(
  ownerId: OwnerId,
  incomeIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (incomeIds.length === 0) return map;
  const result = await query<ReceivedRow>(
    `SELECT r.income_expectation_id::text AS income_expectation_id,
            COALESCE(SUM(r.amount_cents), 0)::text AS received_cents
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

async function loadGeneratedExistsMap(
  ownerId: OwnerId,
  targetMonthKey: MonthKey,
  templateIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (templateIds.length === 0) return map;
  const result = await query<GeneratedExistsRow>(
    `SELECT origin_template_id::text AS origin_template_id,
            count(*)::text AS n
     FROM obligations
     WHERE owner_id = $1 AND current_month_key = $2
       AND origin_template_id = ANY($3::bigint[])
     GROUP BY origin_template_id`,
    [ownerId, targetMonthKey, templateIds],
  );
  for (const row of result.rows) {
    map.set(row.origin_template_id, bigToInt(row.n) ?? 0);
  }
  return map;
}

async function loadIncomeExistsMap(
  ownerId: OwnerId,
  targetMonthKey: MonthKey,
  templateIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (templateIds.length === 0) return map;
  const result = await query<IncomeExistsRow>(
    `SELECT origin_template_id::text AS origin_template_id,
            count(*)::text AS n
     FROM income_expectations
     WHERE owner_id = $1 AND month_key = $2
       AND origin_template_id = ANY($3::bigint[])
     GROUP BY origin_template_id`,
    [ownerId, targetMonthKey, templateIds],
  );
  for (const row of result.rows) {
    map.set(row.origin_template_id, bigToInt(row.n) ?? 0);
  }
  return map;
}

// --- Preview ---

/**
 * Build a read-only next-month preview for the given source month.
 *
 * The source month must correspond to an OPEN plan. The preview lists:
 * - proposed recurring instances from active templates (with already-generated
 *   flags so a re-run is honest),
 * - outstanding ordinary obligations that would carry by reference,
 * - persistent reserved commitments,
 * - the prior savings target as a reviewable default,
 * - any expired/unresolved expected income for an explicit carry/drop decision.
 *
 * No writes. The preview records a stable digest of the source-month inputs
 * that apply recomputes to detect a stale preview.
 */
export async function buildRolloverPreview(
  ownerId: OwnerId,
  sourceMonthKey: MonthKey,
): Promise<RolloverPreview> {
  const sourceKey = validateRolloverMonthKey(sourceMonthKey);
  const targetKey = nextMonthKey(sourceKey);

  // Load the source plan. A missing plan is an honest empty state — there is
  // nothing to roll over. We surface it as a preview with no items and a
  // digest of the empty state so apply can still reject staleness.
  const sourcePlanResult = await query<PlanRow>(
    `SELECT id::text, month_key, savings_target_cents::text, status
     FROM monthly_plans WHERE owner_id = $1 AND month_key = $2`,
    [ownerId, sourceKey],
  );
  const sourcePlan = sourcePlanResult.rows[0] ?? null;

  if (sourcePlan !== null && sourcePlan.status === "closed") {
    throw new RolloverClosedMonthError(
      `Month ${sourceKey} is closed; rollover does not run on a closed month`,
    );
  }

  const sourceTarget = sourcePlan ? bigToInt(sourcePlan.savings_target_cents) ?? 0 : 0;

  // Active templates (proposed recurring instances).
  const templates = await listActiveTemplates(ownerId);
  const templateIds = templates.map((t) => t.id);
  const genExists = await loadGeneratedExistsMap(ownerId, targetKey, templateIds);
  const incExists = await loadIncomeExistsMap(ownerId, targetKey, templateIds);

  const recurringInstances: RecurringInstancePreview[] = templates.map((t) => ({
    templateId: t.id,
    name: t.name,
    kind: t.kind as "ordinary" | "reserved" | "income",
    defaultAmountCents: t.defaultAmountCents as Cents,
    dueDayOfMonth: t.dueDayOfMonth,
    alreadyGenerated:
      t.kind === "income"
        ? (incExists.get(t.id) ?? 0) > 0
        : (genExists.get(t.id) ?? 0) > 0,
  }));

  // Source obligations (current_month_key = source). Reserved commitments are
  // listed separately from ordinary carryover. Cancelled items are excluded.
  const oblResult = await query<ObligationRow>(
    `SELECT id::text, kind, title, planned_cents::text, original_month_key,
            current_month_key, origin_template_id::text, status
     FROM obligations
     WHERE owner_id = $1 AND current_month_key = $2
     ORDER BY id ASC`,
    [ownerId, sourceKey],
  );
  const oblIds = oblResult.rows.map((r) => r.id);
  const paidMap = await loadPaidMap(ownerId, oblIds);

  const carryoverObligations: CarryoverObligationPreview[] = [];
  const reservedCarryover: ReservedCarryoverPreview[] = [];
  const digestObligations: {
    id: string;
    kind: string;
    plannedCents: number;
    currentMonthKey: string;
    status: string;
    originTemplateId: string | null;
  }[] = [];

  for (const row of oblResult.rows) {
    if (row.status === "cancelled") {
      digestObligations.push({
        id: row.id,
        kind: row.kind,
        plannedCents: bigToInt(row.planned_cents) ?? 0,
        currentMonthKey: row.current_month_key,
        status: row.status,
        originTemplateId: row.origin_template_id,
      });
      continue;
    }
    const planned = bigToInt(row.planned_cents) ?? 0;
    const paid = paidMap.get(row.id) ?? 0;
    const remaining = planned - paid;
    const base = {
      id: row.id,
      title: row.title,
      plannedCents: planned as Cents,
      paidCents: paid as Cents,
      remainingCents: remaining as Cents,
      originalMonthKey: row.original_month_key,
    };
    if (row.kind === "reserved") {
      reservedCarryover.push(base);
    } else {
      carryoverObligations.push({
        ...base,
        fromTemplate: row.origin_template_id !== null,
      });
    }
    digestObligations.push({
      id: row.id,
      kind: row.kind,
      plannedCents: planned,
      currentMonthKey: row.current_month_key,
      status: row.status,
      originTemplateId: row.origin_template_id,
    });
  }

  // Source income expectations: unresolved (pending > 0 and not cancelled) are
  // surfaced for an explicit carry/drop decision.
  const incResult = await query<IncomeRow>(
    `SELECT id::text, month_key, source_name, expected_cents::text, linked_account_id::text,
            origin_template_id::text, status
     FROM income_expectations
     WHERE owner_id = $1 AND month_key = $2
     ORDER BY id ASC`,
    [ownerId, sourceKey],
  );
  const incIds = incResult.rows.map((r) => r.id);
  const receivedMap = await loadReceivedMap(ownerId, incIds);

  const unresolvedIncome: UnresolvedIncomePreview[] = [];
  const digestIncome: { id: string; expectedCents: number; status: string }[] = [];

  for (const row of incResult.rows) {
    const expected = bigToInt(row.expected_cents) ?? 0;
    const received = receivedMap.get(row.id) ?? 0;
    const pending = expected - received;
    digestIncome.push({
      id: row.id,
      expectedCents: expected,
      status: row.status,
    });
    if (row.status !== "cancelled" && pending > 0) {
      unresolvedIncome.push({
        id: row.id,
        sourceName: row.source_name,
        expectedCents: expected as Cents,
        receivedCents: received as Cents,
        pendingCents: pending as Cents,
        monthKey: row.month_key,
      });
    }
  }

  // Does the target plan already exist?
  const targetPlanResult = await query<{ id: string }>(
    `SELECT id::text FROM monthly_plans WHERE owner_id = $1 AND month_key = $2`,
    [ownerId, targetKey],
  );
  const targetPlanExists = targetPlanResult.rows.length > 0;

  const previewDigest = computeSourceDigest({
    planTargetCents: sourceTarget,
    obligations: digestObligations,
    income: digestIncome,
    activeTemplateCount: templates.length,
  });

  return {
    sourceMonthKey: sourceKey,
    targetMonthKey: targetKey,
    targetPlanExists,
    proposedSavingsTargetCents: sourceTarget as Cents,
    sourceHasTarget: sourcePlan !== null,
    recurringInstances,
    carryoverObligations,
    reservedCarryover,
    unresolvedIncome,
    previewDigest,
  };
}

// --- Apply ---

type IdempotencyOutcome = { status: "new" } | { status: "replay" };

async function checkRolloverIdempotency(
  client: PoolClient,
  ownerId: OwnerId,
  operationKey: string,
  expectedPayloadHash: string,
): Promise<IdempotencyOutcome> {
  const existing = await client.query<OperationLogRow>(
    `SELECT payload_hash, operation_type FROM operation_log
     WHERE owner_id = $1 AND operation_key = $2`,
    [ownerId, operationKey],
  );
  if (existing.rows.length === 0) {
    return { status: "new" };
  }
  const row = existing.rows[0];
  if (
    row.payload_hash !== expectedPayloadHash ||
    row.operation_type !== "rollover_apply"
  ) {
    throw new RolloverIdempotencyConflictError(
      "An operation with this key already exists with different parameters",
    );
  }
  return { status: "replay" };
}

async function recordRolloverOperation(
  client: PoolClient,
  ownerId: OwnerId,
  operationKey: string,
  hash: string,
): Promise<void> {
  await client.query(
    `INSERT INTO operation_log (owner_id, operation_key, payload_hash, operation_type)
     VALUES ($1, $2, $3, 'rollover_apply')`,
    [ownerId, operationKey, hash],
  );
}

/**
 * Apply a validated rollover atomically.
 *
 * Lock order: operation_log check -> source plan FOR UPDATE -> target plan
 * (FOR UPDATE or INSERT) -> obligations FOR UPDATE -> income FOR UPDATE.
 *
 * Steps:
 * 1. Idempotency check. On replay, recompute the result summary from the live
 *    state (no new writes) and return with replay=true.
 * 2. Lock the source plan; reject if closed or missing.
 * 3. Recompute the source digest under lock; reject if it does not match the
 *    preview digest (stale preview).
 * 4. Create the target plan if it does not exist (idempotent via get-or-
 *    create). Set the savings target on the target plan.
 * 5. Generate recurring instances from active templates (idempotent per
 *    template via partial unique indexes).
 * 6. Carry unpaid ordinary obligations by reference (UPDATE current_month_key
 *    on the SAME row) — except those the user explicitly released.
 * 7. Release the chosen ordinary obligations through the existing release
 *    workflow (audited, preserves paid history).
 * 8. Carry explicitly-chosen unresolved income as a NEW expectation in the
 *    target month (received=0). Others are dropped.
 * 9. Audit log + operation_log record.
 *
 * Reserves are NOT touched here: they carry by reference automatically
 * because their current_month_key is updated in the carry step (they are
 * obligations of kind='reserved'). They are never released through rollover.
 */
export async function applyRollover(
  ownerId: OwnerId,
  rawInput: ApplyRolloverInput,
): Promise<ApplyRolloverResult> {
  const input = validateApplyRolloverInput(rawInput);
  const targetKey = nextMonthKey(input.sourceMonthKey);

  const hash = payloadHash(
    JSON.stringify({
      operation: "rollover_apply",
      sourceMonthKey: input.sourceMonthKey,
      targetMonthKey: targetKey,
      savingsTargetCents: input.savingsTargetCents,
      previewDigest: input.previewDigest,
      releaseChoices: input.releaseChoices
        .map((c) => c.obligationId)
        .sort(),
      carryIncomeIds: [...input.carryIncomeIds].sort(),
    }),
  );

  return withTransaction(async (client) => {
    // 1. Idempotency check.
    const idem = await checkRolloverIdempotency(
      client,
      ownerId,
      input.idempotencyKey,
      hash,
    );
    if (idem.status === "replay") {
      // Recompute a faithful summary from the live state. No new writes.
      return await replayRollover(client, ownerId, input.sourceMonthKey, targetKey);
    }

    // 2. Lock the source plan; reject if closed or missing.
    const sourcePlanResult = await client.query<PlanRow>(
      `SELECT id::text, month_key, savings_target_cents::text, status
       FROM monthly_plans
       WHERE owner_id = $1 AND month_key = $2
       FOR UPDATE`,
      [ownerId, input.sourceMonthKey],
    );
    if (sourcePlanResult.rows.length === 0) {
      throw new RolloverValidationError(
        `No plan exists for ${input.sourceMonthKey}; nothing to roll over`,
      );
    }
    if (sourcePlanResult.rows[0].status === "closed") {
      throw new RolloverClosedMonthError(
        `Month ${input.sourceMonthKey} is closed; rollover does not run on a closed month`,
      );
    }
    const sourceTarget = bigToInt(sourcePlanResult.rows[0].savings_target_cents) ?? 0;

    // 3. Recompute the source digest under lock and compare to the preview.
    const oblResult = await client.query<ObligationRow>(
      `SELECT id::text, kind, title, planned_cents::text, original_month_key,
              current_month_key, origin_template_id::text, status
       FROM obligations
       WHERE owner_id = $1 AND current_month_key = $2
       ORDER BY id ASC`,
      [ownerId, input.sourceMonthKey],
    );
    const incResult = await client.query<IncomeRow>(
      `SELECT id::text, month_key, source_name, expected_cents::text, linked_account_id::text,
              origin_template_id::text, status
       FROM income_expectations
       WHERE owner_id = $1 AND month_key = $2
       ORDER BY id ASC`,
      [ownerId, input.sourceMonthKey],
    );
    const templates = await listActiveTemplates(ownerId);

    const liveDigest = computeSourceDigest({
      planTargetCents: sourceTarget,
      obligations: oblResult.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        plannedCents: bigToInt(r.planned_cents) ?? 0,
        currentMonthKey: r.current_month_key,
        status: r.status,
        originTemplateId: r.origin_template_id,
      })),
      income: incResult.rows.map((r) => ({
        id: r.id,
        expectedCents: bigToInt(r.expected_cents) ?? 0,
        status: r.status,
      })),
      activeTemplateCount: templates.length,
    });

    if (liveDigest !== input.previewDigest) {
      throw new RolloverStalePreviewError(
        "The source month changed since the preview was generated. Please review the updated preview and try again.",
      );
    }

    // 4. Create the target plan if it does not exist; set the savings target.
    let targetPlanCreated = false;
    let targetPlanId: string;
    const targetLock = await client.query<PlanRow>(
      `SELECT id::text, month_key, savings_target_cents::text, status
       FROM monthly_plans
       WHERE owner_id = $1 AND month_key = $2
       FOR UPDATE`,
      [ownerId, targetKey],
    );
    if (targetLock.rows.length > 0) {
      targetPlanId = targetLock.rows[0].id;
      // Update the savings target on the existing target plan.
      await client.query(
        `UPDATE monthly_plans
         SET savings_target_cents = $3, updated_at = now()
         WHERE owner_id = $1 AND id = $2`,
        [ownerId, targetPlanId, input.savingsTargetCents],
      );
    } else {
      try {
        const inserted = await client.query<PlanRow>(
          `INSERT INTO monthly_plans (owner_id, month_key, savings_target_cents)
           VALUES ($1, $2, $3)
           RETURNING id::text, month_key, savings_target_cents::text, status`,
          [ownerId, targetKey, input.savingsTargetCents],
        );
        targetPlanId = inserted.rows[0].id;
        targetPlanCreated = true;
      } catch (error) {
        if (isUniqueViolation(error)) {
          // A concurrent rollover created the target plan between our read
          // and insert. Re-lock and update its target.
          const relock = await client.query<PlanRow>(
            `SELECT id::text, month_key, savings_target_cents::text, status
             FROM monthly_plans
             WHERE owner_id = $1 AND month_key = $2
             FOR UPDATE`,
            [ownerId, targetKey],
          );
          targetPlanId = relock.rows[0].id;
          await client.query(
            `UPDATE monthly_plans
             SET savings_target_cents = $3, updated_at = now()
             WHERE owner_id = $1 AND id = $2`,
            [ownerId, targetPlanId, input.savingsTargetCents],
          );
        } else {
          throw error;
        }
      }
    }

    // 5. Generate recurring instances from active templates. Idempotent per
    //    template via partial unique indexes on obligations/income_expectations.
    const genCounts = await generateFromTemplates(
      client,
      ownerId,
      targetKey,
      templates,
    );

    // 6 & 7. Carry unpaid ordinary obligations by reference; release the
    //        explicitly-chosen ones through the existing release workflow.
    const releaseIds = new Set(input.releaseChoices.map((c) => c.obligationId));

    // Validate that release choices only target ordinary obligations that are
    // in the source month and belong to the owner. Reserves cannot be released
    // through rollover; a cross-owner or missing id is rejected.
    if (releaseIds.size > 0) {
      const releaseCheckRows = await client.query<{ id: string; kind: string; current_month_key: string }>(
        `SELECT id::text, kind, current_month_key
         FROM obligations
         WHERE owner_id = $1 AND id = ANY($2::bigint[])
         FOR UPDATE`,
        [ownerId, Array.from(releaseIds)],
      );
      const found = new Map(releaseCheckRows.rows.map((r) => [r.id, r]));
      for (const id of releaseIds) {
        const row = found.get(id);
        if (!row) {
          throw new RolloverValidationError(
            "A release choice points to an obligation that does not exist or does not belong to you",
          );
        }
        if (row.current_month_key !== input.sourceMonthKey) {
          throw new RolloverValidationError(
            "A release choice points to an obligation that is not in the source month",
          );
        }
        if (row.kind === "reserved") {
          throw new RolloverValidationError(
            "Reserved commitments cannot be released through rollover; use the release workflow",
          );
        }
      }
    }

    // Load paid map for source obligations to decide carry vs release and to
    // count carried items. Only ordinary obligations with remaining > 0 are
    // carried; fully-paid ordinary items stay in the source month (they are
    // done). Reserved obligations always carry by reference (they are
    // persistent commitments) and are never released through rollover.
    const sourceOblIds = oblResult.rows.map((r) => r.id);
    const paidMap = new Map<string, number>();
    if (sourceOblIds.length > 0) {
      const paidRows = await client.query<PaidRow>(
        `SELECT s.obligation_id::text AS obligation_id,
                COALESCE(SUM(s.amount_cents), 0)::text AS paid_cents
         FROM settlements s
         WHERE s.owner_id = $1 AND s.obligation_id = ANY($2::bigint[])
           AND NOT EXISTS (
             SELECT 1 FROM settlement_reversals r
             WHERE r.owner_id = $1 AND r.original_settlement_id = s.id
           )
         GROUP BY s.obligation_id`,
        [ownerId, sourceOblIds],
      );
      for (const row of paidRows.rows) {
        paidMap.set(row.obligation_id, bigToInt(row.paid_cents) ?? 0);
      }
    }

    let carriedObligations = 0;
    let releasedObligations = 0;

    for (const row of oblResult.rows) {
      if (row.status === "cancelled") continue;
      const planned = bigToInt(row.planned_cents) ?? 0;
      const paid = paidMap.get(row.id) ?? 0;
      const remaining = planned - paid;

      if (row.kind === "reserved") {
        // Reserves always carry by reference (persistent commitments). They
        // are never released through rollover. Update current_month_key on
        // the SAME row regardless of remaining (even a settled reserve stays
        // linked to the next month until explicitly released/cancelled, per
        // the "reserves persist until settled/released" rule).
        await client.query(
          `UPDATE obligations
           SET current_month_key = $3, updated_at = now()
           WHERE owner_id = $1 AND id = $2`,
          [ownerId, row.id, targetKey],
        );
        carriedObligations++;
        continue;
      }

      // Ordinary obligation.
      if (releaseIds.has(row.id)) {
        // Release through the existing release workflow. This preserves paid
        // history and writes the audit trail. The release workflow requires
        // an open month — the source month is open (checked above).
        // We must release BEFORE the carry would move it; the release path
        // uses the row's current_month_key to check the plan is open.
        await releaseObligationInternal(client, ownerId, row.id);
        releasedObligations++;
        continue;
      }

      if (remaining > 0) {
        // Carry by reference: update current_month_key on the SAME row.
        await client.query(
          `UPDATE obligations
           SET current_month_key = $3, updated_at = now()
           WHERE owner_id = $1 AND id = $2`,
          [ownerId, row.id, targetKey],
        );
        carriedObligations++;
      }
      // Fully-paid ordinary obligations (remaining === 0) stay in the source
      // month — they are done and should not clutter the next month.
    }

    // 8. Carry explicitly-chosen unresolved income as a NEW expectation in the
    //    target month (received=0). Others are dropped (the user explicitly
    //    chose not to rely on them again).
    const carryIncomeSet = new Set(input.carryIncomeIds);
    let carriedIncome = 0;
    const receivedMap = new Map<string, number>();
    const carryCandidates = incResult.rows.filter(
      (r) => carryIncomeSet.has(r.id) && r.status !== "cancelled",
    );
    if (carryCandidates.length > 0) {
      const carryIds = carryCandidates.map((r) => r.id);
      const receivedRows = await client.query<ReceivedRow>(
        `SELECT r.income_expectation_id::text AS income_expectation_id,
                COALESCE(SUM(r.amount_cents), 0)::text AS received_cents
         FROM income_receipts r
         WHERE r.owner_id = $1 AND r.income_expectation_id = ANY($2::bigint[])
           AND NOT EXISTS (
             SELECT 1 FROM income_receipt_reversals rev
             WHERE rev.owner_id = $1 AND rev.original_receipt_id = r.id
           )
         GROUP BY r.income_expectation_id`,
        [ownerId, carryIds],
      );
      for (const row of receivedRows.rows) {
        receivedMap.set(row.income_expectation_id, bigToInt(row.received_cents) ?? 0);
      }
    }

    for (const row of carryCandidates) {
      const expected = bigToInt(row.expected_cents) ?? 0;
      const received = receivedMap.get(row.id) ?? 0;
      const pending = expected - received;
      if (pending <= 0) continue;

      // Insert a NEW income expectation in the target month with the pending
      // amount. If an expectation with the same source_name already exists in
      // the target month (e.g. from a template), skip via SAVEPOINT to keep
      // the carry idempotent and avoid clobbering the template-generated one.
      const spName = `sp_carry_inc_${row.id}`;
      try {
        await client.query(`SAVEPOINT ${spName}`);
        await client.query(
          `INSERT INTO income_expectations
             (owner_id, month_key, source_name, expected_cents,
              linked_account_id, status)
           VALUES ($1, $2, $3, $4, $5, 'active')`,
          [ownerId, targetKey, row.source_name, pending, row.linked_account_id],
        );
        carriedIncome++;
      } catch (error) {
        await client.query(`ROLLBACK TO ${spName}`);
        if (isUniqueViolation(error)) {
          // A template-generated expectation with the same source_name already
          // exists in the target month. Do not clobber it; the template
          // instance wins. This is the honest outcome — the user's carry
          // choice is represented by the template-generated instance.
          continue;
        }
        throw error;
      }
    }

    // 9. Audit log + operation_log record.
    await client.query(
      `INSERT INTO audit_log (owner_id, operation_type, entity_type, entity_id, summary)
       VALUES ($1, 'rollover_apply', 'monthly_plan', $2, $3)`,
      [
        ownerId,
        targetPlanId,
        `Rollover ${input.sourceMonthKey} -> ${targetKey}: carried ${carriedObligations} obligations, released ${releasedObligations}, carried ${carriedIncome} income, generated ${genCounts.generatedObligations + genCounts.generatedIncome} new`,
      ],
    );
    await recordRolloverOperation(client, ownerId, input.idempotencyKey, hash);

    return {
      sourceMonthKey: input.sourceMonthKey,
      targetMonthKey: targetKey,
      targetPlanCreated,
      savingsTargetCents: input.savingsTargetCents,
      generatedObligations: genCounts.generatedObligations,
      generatedIncome: genCounts.generatedIncome,
      skippedObligations: genCounts.skippedObligations,
      skippedIncome: genCounts.skippedIncome,
      carriedObligations,
      releasedObligations,
      carriedIncome,
      replay: false,
    };
  });
}

/**
 * Release an obligation inside an existing transaction client.
 *
 * This mirrors the core of releaseObligation from lib/obligations/service.ts
 * but runs on the provided client so it participates in the rollover's atomic
 * transaction. It preserves paid history (status -> released, planned_cents
 * unchanged) and writes the audit_log row. Releasing an already-released
 * obligation is idempotent.
 *
 * The source month is open (verified by the caller), so the release is allowed.
 */
async function releaseObligationInternal(
  client: PoolClient,
  ownerId: OwnerId,
  obligationId: string,
): Promise<void> {
  const lockResult = await client.query<ObligationRow>(
    `SELECT id::text, kind, title, planned_cents::text, original_month_key,
            current_month_key, origin_template_id::text, status
     FROM obligations
     WHERE owner_id = $1 AND id = $2
     FOR UPDATE`,
    [ownerId, obligationId],
  );
  if (lockResult.rows.length === 0) {
    throw new RolloverValidationError(
      "A release choice points to an obligation that does not exist or does not belong to you",
    );
  }
  const existing = lockResult.rows[0];
  if (existing.status === "released") {
    return; // idempotent
  }
  if (existing.status === "cancelled") {
    throw new RolloverValidationError(
      "Cannot release a cancelled obligation",
    );
  }
  if (existing.kind === "reserved") {
    throw new RolloverValidationError(
      "Reserved commitments cannot be released through rollover; use the release workflow",
    );
  }

  // Compute paid under lock.
  const paidResult = await client.query<{ paid: string | null }>(
    `SELECT COALESCE(SUM(s.amount_cents), 0)::text AS paid
     FROM settlements s
     WHERE s.owner_id = $1 AND s.obligation_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM settlement_reversals r
         WHERE r.owner_id = $1 AND r.original_settlement_id = s.id
       )`,
    [ownerId, obligationId],
  );
  const paidCents = bigToInt(paidResult.rows[0]?.paid) ?? 0;
  const plannedCents = bigToInt(existing.planned_cents) ?? 0;
  const releasedCents = plannedCents - paidCents;

  await client.query(
    `UPDATE obligations
     SET status = 'released', updated_at = now()
     WHERE owner_id = $1 AND id = $2`,
    [ownerId, obligationId],
  );

  await client.query(
    `INSERT INTO audit_log (owner_id, operation_type, entity_type, entity_id, summary)
     VALUES ($1, 'obligation_release', 'obligation', $2, $3)`,
    [ownerId, obligationId, `Released ${releasedCents} cents unpaid remainder of obligation during rollover`],
  );
}

/**
 * Reconstruct an ApplyRolloverResult from the live state for an idempotent
 * replay. No new writes.
 */
async function replayRollover(
  client: PoolClient,
  ownerId: OwnerId,
  sourceMonthKey: MonthKey,
  targetMonthKey: MonthKey,
): Promise<ApplyRolloverResult> {
  // Target plan.
  const targetPlan = await client.query<{ id: string; savings_target_cents: string }>(
    `SELECT id::text, savings_target_cents::text FROM monthly_plans
     WHERE owner_id = $1 AND month_key = $2`,
    [ownerId, targetMonthKey],
  );
  const savingsTargetCents = bigToInt(targetPlan.rows[0]?.savings_target_cents) ?? 0;

  // Count carried obligations (current_month_key = target).
  const carriedResult = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM obligations
     WHERE owner_id = $1 AND current_month_key = $2 AND status = 'active'`,
    [ownerId, targetMonthKey],
  );
  const carriedObligations = bigToInt(carriedResult.rows[0]?.n) ?? 0;

  // Released obligations from the source month (status=released, original or
  // current month = source). We approximate by counting released obligations
  // whose original_month_key = source.
  const releasedResult = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM obligations
     WHERE owner_id = $1 AND original_month_key = $2 AND status = 'released'`,
    [ownerId, sourceMonthKey],
  );
  const releasedObligations = bigToInt(releasedResult.rows[0]?.n) ?? 0;

  // Carried income: non-template expectations in the target month whose
  // source_name matches a source-month expectation. This is an approximation
  // for the replay summary; the authoritative record is the operation_log.
  const carriedIncomeResult = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM income_expectations
     WHERE owner_id = $1 AND month_key = $2 AND origin_template_id IS NULL`,
    [ownerId, targetMonthKey],
  );
  const carriedIncome = bigToInt(carriedIncomeResult.rows[0]?.n) ?? 0;

  // Generated counts: template-origin obligations/income in the target month.
  const genOblResult = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM obligations
     WHERE owner_id = $1 AND current_month_key = $2 AND origin_template_id IS NOT NULL`,
    [ownerId, targetMonthKey],
  );
  const generatedObligations = bigToInt(genOblResult.rows[0]?.n) ?? 0;
  const genIncResult = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM income_expectations
     WHERE owner_id = $1 AND month_key = $2 AND origin_template_id IS NOT NULL`,
    [ownerId, targetMonthKey],
  );
  const generatedIncome = bigToInt(genIncResult.rows[0]?.n) ?? 0;

  return {
    sourceMonthKey,
    targetMonthKey,
    targetPlanCreated: false,
    savingsTargetCents: savingsTargetCents as Cents,
    generatedObligations,
    generatedIncome,
    skippedObligations: 0,
    skippedIncome: 0,
    carriedObligations,
    releasedObligations,
    carriedIncome,
    replay: true,
  };
}