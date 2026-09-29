// Month closing and history service.
//
// Closes a month transactionally by locking the plan row, computing a
// consistent owner-scoped snapshot of balances/forecast/settlement totals and
// provenance, marking the plan closed and inserting an immutable
// closing_snapshots row — all on one checked-out client. Later account
// refreshes, payments, reserve releases or target changes cannot alter a
// closed snapshot; v1 has no reopening.
//
// The historical list/detail/comparison view reads snapshots for closed months
// and the live forecast is only used for the open/current month. Closed-period
// writes are enforced at the server boundary (existing obligations/income/
// settlements services already reject edits to a closed plan); this service
// adds the close operation and the history reads.
//
// Paid totals come from business-dated settlements/reversals per the agreed
// policy (paid = sum of non-reversed settlements), not from account balance
// differences. Manual bank adjustments are NOT counted as payments; the
// settlement_total_cents column on the snapshot is the sum of non-reversed
// settlement amounts for the month's obligations, separate from balance
// adjustments.
//
// Invariants:
// - Owner derived from the verified server session (passed in as ownerId).
// - One snapshot per owner per month (UNIQUE(owner_id, month_key)).
// - Closing is idempotent on the plan status but NOT on the snapshot: a second
//   close attempt on an already-closed month is rejected (no silent overwrite).
//   Repeated/concurrent close on an open month serializes via the plan row lock;
//   the first commit wins and the second sees status='closed' and is rejected.
// - The snapshot is built from a consistent read inside the transaction so a
//   concurrent payment cannot produce a half-updated snapshot.

import "server-only";
import { withTransaction, query, type PoolClient } from "../db";
import type { OwnerId, MonthKey, PlanId } from "../months/types";
import {
  computeForecast,
  type BalanceEntry,
  type ForecastInput,
  type ForecastResult,
  type InternalTransfer,
  type OrdinaryExpense,
  type PendingIncome,
  type ReservedCommitment,
} from "../finance/forecast";
import type { Cents } from "../finance/money";
import {
  HistoryServiceError,
  HistoryNotFoundError,
  HistoryConflictError,
  ClosedMonthError,
  type ClosingSnapshot,
  type CloseMonthResult,
  type HistorySummary,
  type ProvenanceAccount,
  type ProvenanceIncome,
  type ProvenanceObligation,
  type SnapshotProvenance,
} from "./types";
import { validateMonthKey, validateOwnerId } from "./validation";

export {
  HistoryServiceError,
  HistoryNotFoundError,
  HistoryConflictError,
  ClosedMonthError,
};

// --- Raw DB row shapes (snake_case) ---

type PlanRow = {
  id: string;
  month_key: string;
  savings_target_cents: string;
  status: string;
};

type AccountRow = {
  id: string;
  name: string;
  current_balance_cents: string | null;
  balance_as_of: Date | null;
  archived: boolean;
};

type ObligationRow = {
  id: string;
  kind: string;
  title: string;
  planned_cents: string;
  due_date: Date | null;
  linked_reserve_id: string | null;
  status: string;
};

type IncomeRow = {
  id: string;
  source_name: string;
  expected_cents: string;
  status: string;
};

type PaidRow = { obligation_id: string; paid_cents: string };
type ReceivedRow = { income_expectation_id: string; received_cents: string };
type SettlementTotalRow = { total_cents: string };
type SnapshotRow = {
  id: string;
  month_key: string;
  balances_total_cents: string;
  balances_as_of: Date | null;
  pending_income_remaining_cents: string;
  ordinary_unpaid_cents: string;
  reserved_outstanding_cents: string;
  savings_target_cents: string;
  projected_free_to_spend_cents: string | null;
  cash_backed_free_to_spend_cents: string | null;
  settlement_total_cents: string;
  closed_at: Date;
  provenance: SnapshotProvenance | null;
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

function isUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "23505";
  }
  return false;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// --- Snapshot input loaders (run inside the close transaction) ---

async function loadAccountsForSnapshot(
  client: PoolClient,
  ownerId: OwnerId,
): Promise<{ accounts: ProvenanceAccount[]; rows: AccountRow[] }> {
  const result = await client.query<AccountRow>(
    `SELECT id::text, name, current_balance_cents::text, balance_as_of,
            archived
     FROM accounts
     WHERE owner_id = $1 AND archived = false
     ORDER BY created_at ASC, id ASC`,
    [ownerId],
  );
  const accounts: ProvenanceAccount[] = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    balanceCents: bigToInt(row.current_balance_cents),
    balanceAsOf: row.balance_as_of ? row.balance_as_of.toISOString() : null,
  }));
  return { accounts, rows: result.rows };
}

async function loadObligationsForSnapshot(
  client: PoolClient,
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<{
  ordinary: ProvenanceObligation[];
  reserved: ProvenanceObligation[];
  forecastOrdinary: OrdinaryExpense[];
  forecastReserved: ReservedCommitment[];
}> {
  const result = await client.query<ObligationRow>(
    `SELECT id::text, kind, title, planned_cents::text, due_date,
            linked_reserve_id::text, status
     FROM obligations
     WHERE owner_id = $1 AND current_month_key = $2
     ORDER BY due_date NULLS LAST, id ASC`,
    [ownerId, monthKey],
  );
  const ids = result.rows.map((r) => r.id);
  const paidMap = await loadPaidMapInTx(client, ownerId, ids);

  const ordinary: ProvenanceObligation[] = [];
  const reserved: ProvenanceObligation[] = [];
  const forecastOrdinary: OrdinaryExpense[] = [];
  const forecastReserved: ReservedCommitment[] = [];

  for (const row of result.rows) {
    if (row.status === "cancelled") continue;
    const planned = bigToInt(row.planned_cents) ?? 0;
    const paid = paidMap.get(row.id) ?? 0;
    const remaining = planned - paid;
    const item: ProvenanceObligation = {
      id: row.id,
      kind: row.kind as "ordinary" | "reserved",
      title: row.title,
      plannedCents: planned,
      paidCents: paid,
      remainingCents: remaining,
      status: row.status,
      dueDate: row.due_date ? formatDate(row.due_date) : null,
      linkedReserveId: row.linked_reserve_id,
    };
    if (row.kind === "reserved") {
      reserved.push(item);
      forecastReserved.push({
        id: row.id,
        planned: planned as Cents,
        paidCents: paid as Cents,
      });
    } else {
      ordinary.push(item);
      forecastOrdinary.push({
        id: row.id,
        planned: planned as Cents,
        paidCents: paid as Cents,
        linkedReserveId: row.linked_reserve_id ?? undefined,
      });
    }
  }
  return { ordinary, reserved, forecastOrdinary, forecastReserved };
}

async function loadPaidMapInTx(
  client: PoolClient,
  ownerId: OwnerId,
  obligationIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (obligationIds.length === 0) return map;
  const result = await client.query<PaidRow>(
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

async function loadIncomeForSnapshot(
  client: PoolClient,
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<{
  income: ProvenanceIncome[];
  forecastIncome: PendingIncome[];
}> {
  const result = await client.query<IncomeRow>(
    `SELECT id::text, source_name, expected_cents::text, status
     FROM income_expectations
     WHERE owner_id = $1 AND month_key = $2
     ORDER BY id ASC`,
    [ownerId, monthKey],
  );
  const ids = result.rows.map((r) => r.id);
  const receivedMap = await loadReceivedMapInTx(client, ownerId, ids);

  const income: ProvenanceIncome[] = [];
  const forecastIncome: PendingIncome[] = [];

  for (const row of result.rows) {
    if (row.status === "cancelled") continue;
    const expected = bigToInt(row.expected_cents) ?? 0;
    const received = receivedMap.get(row.id) ?? 0;
    const pending = expected - received;
    income.push({
      id: row.id,
      sourceName: row.source_name,
      expectedCents: expected,
      receivedCents: received,
      pendingCents: pending,
      status: row.status,
    });
    forecastIncome.push({
      id: row.id,
      expected: expected as Cents,
      receivedCents: received as Cents,
    });
  }
  return { income, forecastIncome };
}

async function loadReceivedMapInTx(
  client: PoolClient,
  ownerId: OwnerId,
  incomeIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (incomeIds.length === 0) return map;
  const result = await client.query<ReceivedRow>(
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

/** Sum of non-reversed settlement amounts for the month's obligations. */
async function loadSettlementTotalForMonth(
  client: PoolClient,
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<number> {
  const result = await client.query<SettlementTotalRow>(
    `SELECT COALESCE(SUM(s.amount_cents), 0)::text AS total_cents
     FROM settlements s
     JOIN obligations o
       ON o.owner_id = s.owner_id AND o.id = s.obligation_id
     WHERE s.owner_id = $1
       AND o.current_month_key = $2
       AND NOT EXISTS (
         SELECT 1 FROM settlement_reversals r
         WHERE r.owner_id = $1 AND r.original_settlement_id = s.id
       )`,
    [ownerId, monthKey],
  );
  return bigToInt(result.rows[0]?.total_cents) ?? 0;
}

// --- Snapshot row mapping ---

function mapSnapshot(row: SnapshotRow): ClosingSnapshot {
  return {
    id: row.id,
    ownerId: "",
    monthKey: row.month_key,
    balancesTotalCents: bigToInt(row.balances_total_cents) ?? 0,
    balancesAsOf: row.balances_as_of ? row.balances_as_of.toISOString() : null,
    pendingIncomeRemainingCents: bigToInt(row.pending_income_remaining_cents) ?? 0,
    ordinaryUnpaidCents: bigToInt(row.ordinary_unpaid_cents) ?? 0,
    reservedOutstandingCents: bigToInt(row.reserved_outstanding_cents) ?? 0,
    savingsTargetCents: bigToInt(row.savings_target_cents) ?? 0,
    projectedFreeToSpendCents: bigToInt(row.projected_free_to_spend_cents),
    cashBackedFreeToSpendCents: bigToInt(row.cash_backed_free_to_spend_cents),
    settlementTotalCents: bigToInt(row.settlement_total_cents) ?? 0,
    closedAt: row.closed_at.toISOString(),
    provenance: row.provenance,
  };
}

// --- Public API: close month ---

/**
 * Close a month: lock the plan, build a consistent snapshot, mark closed and
 * insert the immutable closing_snapshots row atomically.
 *
 * The plan must exist and be open. A second close on an already-closed month is
 * rejected (no silent overwrite of the snapshot). Concurrent closes serialize
 * via the plan row FOR UPDATE lock; the first commit wins.
 *
 * The snapshot is built from a consistent read inside the transaction. The
 * forecast is computed via the same pure `computeForecast` core used by the
 * live dashboard so the snapshot aggregates match the live forecast formulas.
 */
export async function closeMonth(
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<CloseMonthResult> {
  const oid = validateOwnerId(ownerId);
  const key = validateMonthKey(monthKey);

  return withTransaction(async (client) => {
    // Lock the plan row. A concurrent close waits here; the first commit wins
    // and the second sees status='closed'.
    const planResult = await client.query<PlanRow>(
      `SELECT id::text, month_key, savings_target_cents::text, status
       FROM monthly_plans
       WHERE owner_id = $1 AND month_key = $2
       FOR UPDATE`,
      [oid, key],
    );
    if (planResult.rows.length === 0) {
      throw new HistoryNotFoundError(
        `No plan exists for ${key}; nothing to close`,
      );
    }
    const plan = planResult.rows[0];
    if (plan.status === "closed") {
      throw new ClosedMonthError(
        `Month ${key} is already closed; v1 does not reopen closed months`,
      );
    }
    const planId = plan.id;
    const savingsTarget = bigToInt(plan.savings_target_cents) ?? 0;

    // Build a consistent snapshot of balances/obligations/income.
    const { accounts, rows: accountRows } = await loadAccountsForSnapshot(
      client,
      oid,
    );
    const {
      ordinary,
      reserved,
      forecastOrdinary,
      forecastReserved,
    } = await loadObligationsForSnapshot(client, oid, key);
    const { income, forecastIncome } = await loadIncomeForSnapshot(
      client,
      oid,
      key,
    );

    // Balances for the forecast core: null marks never-entered (setup-incomplete).
    const balances: BalanceEntry[] = accountRows.map((r) => ({
      id: r.id,
      amount:
        r.current_balance_cents === null
          ? null
          : (bigToInt(r.current_balance_cents) as Cents),
    }));

    // Freshness: use the most recent balance_as_of among entered, non-archived
    // accounts. NULL when no account was ever entered (setup-incomplete).
    let balancesAsOf: Date | null = null;
    for (const r of accountRows) {
      if (r.balance_as_of !== null) {
        if (balancesAsOf === null || r.balance_as_of > balancesAsOf) {
          balancesAsOf = r.balance_as_of;
        }
      }
    }

    const internalTransfers: InternalTransfer[] = [];
    const forecastInput: ForecastInput = {
      balances,
      pendingIncome: forecastIncome,
      ordinaryExpenses: forecastOrdinary,
      reservedCommitments: forecastReserved,
      internalTransfers,
      savingsTarget: savingsTarget as Cents,
    };
    const forecast: ForecastResult = computeForecast(forecastInput);

    const settlementTotal = await loadSettlementTotalForMonth(client, oid, key);

    const provenance: SnapshotProvenance = {
      accounts,
      ordinaryExpenses: ordinary,
      reservedCommitments: reserved,
      income,
    };

    // Mark the plan closed and insert the immutable snapshot. The snapshot
    // insert is guarded by UNIQUE(owner_id, month_key); a race that somehow
    // bypassed the plan lock would surface as a unique violation.
    await client.query(
      `UPDATE monthly_plans
       SET status = 'closed', closed_at = now(), updated_at = now()
       WHERE owner_id = $1 AND id = $2`,
      [oid, planId],
    );

    let snapshotRow: SnapshotRow;
    try {
      const inserted = await client.query<SnapshotRow>(
        `INSERT INTO closing_snapshots
           (owner_id, month_key, balances_total_cents, balances_as_of,
            pending_income_remaining_cents, ordinary_unpaid_cents,
            reserved_outstanding_cents, savings_target_cents,
            projected_free_to_spend_cents, cash_backed_free_to_spend_cents,
            settlement_total_cents, closed_at, provenance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12)
         RETURNING id::text, month_key, balances_total_cents::text,
                   balances_as_of, pending_income_remaining_cents::text,
                   ordinary_unpaid_cents::text, reserved_outstanding_cents::text,
                   savings_target_cents::text, projected_free_to_spend_cents::text,
                   cash_backed_free_to_spend_cents::text,
                   settlement_total_cents::text, closed_at, provenance`,
        [
          oid,
          key,
          forecast.balancesTotal,
          balancesAsOf,
          forecast.pendingIncomeRemaining,
          forecast.ordinaryUnpaid,
          forecast.reservedOutstanding,
          savingsTarget,
          forecast.projectedFreeToSpend,
          forecast.cashBackedFreeToSpend,
          settlementTotal,
          JSON.stringify(provenance),
        ],
      );
      snapshotRow = inserted.rows[0];
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HistoryConflictError(
          `A snapshot for ${key} already exists; v1 does not overwrite closed snapshots`,
        );
      }
      throw error;
    }

    await client.query(
      `INSERT INTO audit_log (owner_id, operation_type, entity_type, entity_id, summary)
       VALUES ($1, 'month_close', 'monthly_plan', $2, $3)`,
      [
        oid,
        planId,
        `Closed month ${key}: balances ${forecast.balancesTotal}c, ordinary unpaid ${forecast.ordinaryUnpaid}c, reserved ${forecast.reservedOutstanding}c, settlement total ${settlementTotal}c`,
      ],
    );

    const snapshot = mapSnapshot(snapshotRow);
    snapshot.ownerId = oid;
    return { snapshot, planId };
  });
}

// --- Public API: history reads ---

/** List history summaries for the owner (all plans, newest month first). */
export async function listHistorySummaries(
  ownerId: OwnerId,
): Promise<HistorySummary[]> {
  const oid = validateOwnerId(ownerId);
  const result = await query<{
    id: string;
    month_key: string;
    status: string;
    closed_at: Date | null;
    savings_target_cents: string;
    balances_total_cents: string | null;
    projected_free_to_spend_cents: string | null;
  }>(
    `SELECT p.id::text, p.month_key, p.status, p.closed_at,
            p.savings_target_cents::text,
            cs.balances_total_cents::text AS balances_total_cents,
            cs.projected_free_to_spend_cents::text AS projected_free_to_spend_cents
     FROM monthly_plans p
     LEFT JOIN closing_snapshots cs
       ON cs.owner_id = p.owner_id AND cs.month_key = p.month_key
     WHERE p.owner_id = $1
     ORDER BY p.month_key DESC, p.id DESC`,
    [oid],
  );
  return result.rows.map((row) => ({
    id: row.id,
    monthKey: row.month_key,
    status: row.status as "open" | "closed",
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    savingsTargetCents: bigToInt(row.savings_target_cents) ?? 0,
    balancesTotalCents: bigToInt(row.balances_total_cents),
    projectedFreeToSpendCents: bigToInt(row.projected_free_to_spend_cents),
  }));
}

/** Fetch the immutable snapshot for a closed month. Throws if missing/cross-owner. */
export async function getClosingSnapshot(
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<ClosingSnapshot> {
  const oid = validateOwnerId(ownerId);
  const key = validateMonthKey(monthKey);
  const result = await query<SnapshotRow>(
    `SELECT id::text, month_key, balances_total_cents::text, balances_as_of,
            pending_income_remaining_cents::text, ordinary_unpaid_cents::text,
            reserved_outstanding_cents::text, savings_target_cents::text,
            projected_free_to_spend_cents::text,
            cash_backed_free_to_spend_cents::text,
            settlement_total_cents::text, closed_at, provenance
     FROM closing_snapshots
     WHERE owner_id = $1 AND month_key = $2`,
    [oid, key],
  );
  if (result.rows.length === 0) {
    throw new HistoryNotFoundError(`No closed snapshot for ${key}`);
  }
  const snapshot = mapSnapshot(result.rows[0]);
  snapshot.ownerId = oid;
  return snapshot;
}

/** Fetch the provenance breakdown for a closed month (or null if none stored). */
export async function getSnapshotProvenance(
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<SnapshotProvenance | null> {
  const oid = validateOwnerId(ownerId);
  const key = validateMonthKey(monthKey);
  const result = await query<{ provenance: SnapshotProvenance | null }>(
    `SELECT provenance FROM closing_snapshots
     WHERE owner_id = $1 AND month_key = $2`,
    [oid, key],
  );
  if (result.rows.length === 0) {
    throw new HistoryNotFoundError(`No closed snapshot for ${key}`);
  }
  return result.rows[0].provenance;
}