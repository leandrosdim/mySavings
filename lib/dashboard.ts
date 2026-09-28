// Savings-first overview dashboard service.
//
// Wires the tested pure forecast core (lib/finance/forecast.ts) to live
// owner-scoped PostgreSQL queries. Produces the forecast plus the drilldown
// input lists (B/I/E/R/S) used by the overview UI, plus freshness/staleness
// signals and an explicit current/open-month semantic.
//
// Invariants enforced here:
// - Owner is derived from the verified server session (passed in as ownerId
//   by the trusted route/server-component boundary). No client input is used
//   to scope reads.
// - Settlement/receipt totals are aggregated per obligation/income in a single
//   grouped query (no fan-out join multiplication). Paid/received are sums of
//   non-reversed settlements/receipts.
// - Ordinary expenses and reserved commitments are distinguished by kind. An
//   ordinary expense carrying a linked_reserve_id is passed to the pure
//   forecast with its `linkedReserveId` so the core counts it once in R and
//   excludes it from E. Same-identity carried obligations appear once because
//   there is one row per obligation (carryover updates current_month_key on
//   the SAME row).
// - Only obligations whose current_month_key matches the selected open month
//   are included. Historical/closed months are NOT reconstructed using today's
//   live B; the overview refuses to render a closed-month comparison until
//   Step15 snapshots exist.
// - The selected month must be an OPEN plan. A missing plan, or a closed plan,
//   yields an explicit `monthNotOpen` state — the UI shows an honest empty
//   state, never a confident zero.
// - Internal transfers are net-zero by construction and passed as metadata
//   only; they do not affect totals but are validated by the pure core.
// - Negative projected free-to-spend is preserved (shortfall); never clamped.
//   Pending income caveat is surfaced when any expected income remains
//   unreceived.
// - Never exposes internal DB IDs beyond what the UI already links to. No
//   secrets, real workbook data, or tokenized URLs are logged.

import "server-only";
import { query } from "./db";
import type { OwnerId, MonthKey } from "./months/types";
import {
  computeForecast,
  type BalanceEntry,
  type ForecastInput,
  type ForecastResult,
  type InternalTransfer,
  type OrdinaryExpense,
  type PendingIncome,
  type ReservedCommitment,
} from "./finance/forecast";
import type { Cents } from "./finance/money";

// --- Raw DB row shapes (snake_case) ---

type AccountRow = {
  id: string;
  current_balance_cents: string | null;
  balance_as_of: Date | null;
  track_balance: boolean;
  archived: boolean;
};

type ObligationRow = {
  id: string;
  kind: string;
  title: string;
  planned_cents: string;
  due_date: Date | null;
  linked_account_id: string | null;
  linked_reserve_id: string | null;
  status: string;
};

type ObligationTotalsRow = {
  obligation_id: string;
  paid_cents: string;
};

type IncomeRow = {
  id: string;
  source_name: string;
  expected_cents: string;
  linked_account_id: string | null;
  status: string;
};

type IncomeTotalsRow = {
  income_expectation_id: string;
  received_cents: string;
};

type PlanRow = {
  id: string;
  month_key: string;
  savings_target_cents: string;
  status: string;
};

type TransferRow = {
  id: string;
  from_account_id: string;
  to_account_id: string;
  amount_cents: string;
};

// --- Drilldown list shapes returned to the UI ---

export type DashboardAccount = {
  id: string;
  balanceCents: number | null;
  balanceAsOf: string | null;
  stale: boolean;
};

export type DashboardObligation = {
  id: string;
  title: string;
  plannedCents: number;
  paidCents: number;
  remainingCents: number;
  dueDate: string | null;
  status: string;
  linkedReserveId: string | null;
};

export type DashboardIncome = {
  id: string;
  sourceName: string;
  expectedCents: number;
  receivedCents: number;
  pendingCents: number;
  status: string;
};

export type DashboardTransfer = {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
};

export type DashboardOverview = {
  monthKey: MonthKey;
  monthOpen: boolean;
  hasPlan: boolean;
  forecast: ForecastResult;
  savingsTargetCents: Cents | null;
  accounts: DashboardAccount[];
  ordinaryExpenses: DashboardObligation[];
  reservedCommitments: DashboardObligation[];
  income: DashboardIncome[];
  transfers: DashboardTransfer[];
  hasUnenteredBalance: boolean;
  hasStaleBalance: boolean;
  anyAccountTracked: boolean;
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

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * A balance is considered stale when it was entered more than
 * STALE_BALANCE_DAYS ago (or never entered). Stale is a UI hint, not a
 * hard exclusion: the forecast still uses the entered balance, but the UI
 * warns the user that the figure may be out of date.
 */
const STALE_BALANCE_MS = 7 * 24 * 60 * 60 * 1000;

function isStale(asOf: Date | null, now: Date = new Date()): boolean {
  if (asOf === null) return true;
  return now.getTime() - asOf.getTime() > STALE_BALANCE_MS;
}

// --- Queries ---

async function loadPlan(
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<PlanRow | null> {
  const result = await query<PlanRow>(
    `SELECT id::text, month_key, savings_target_cents::text, status
     FROM monthly_plans
     WHERE owner_id = $1 AND month_key = $2`,
    [ownerId, monthKey],
  );
  return result.rows[0] ?? null;
}

async function loadAccounts(ownerId: OwnerId): Promise<DashboardAccount[]> {
  const result = await query<AccountRow>(
    `SELECT id::text, current_balance_cents::text, balance_as_of,
            track_balance, archived
     FROM accounts
     WHERE owner_id = $1 AND archived = false
     ORDER BY created_at ASC, id ASC`,
    [ownerId],
  );
  const now = new Date();
  return result.rows.map((row) => {
    const balance = bigToInt(row.current_balance_cents);
    return {
      id: row.id,
      balanceCents: balance,
      balanceAsOf: row.balance_as_of ? row.balance_as_of.toISOString() : null,
      stale: isStale(row.balance_as_of, now),
    };
  });
}

async function loadObligationsForMonth(
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<{
  ordinary: DashboardObligation[];
  reserved: DashboardObligation[];
}> {
  const result = await query<ObligationRow>(
    `SELECT id::text, kind, title, planned_cents::text, due_date,
            linked_account_id::text, linked_reserve_id::text, status
     FROM obligations
     WHERE owner_id = $1 AND current_month_key = $2
     ORDER BY due_date NULLS LAST, id ASC`,
    [ownerId, monthKey],
  );
  const ids = result.rows.map((r) => r.id);
  const totals = await loadObligationTotals(ownerId, ids);
  const ordinary: DashboardObligation[] = [];
  const reserved: DashboardObligation[] = [];
  for (const row of result.rows) {
    if (row.status === "cancelled") continue;
    const planned = bigToInt(row.planned_cents) ?? 0;
    const paid = totals.get(row.id) ?? 0;
    const item: DashboardObligation = {
      id: row.id,
      title: row.title,
      plannedCents: planned,
      paidCents: paid,
      remainingCents: planned - paid,
      dueDate: row.due_date ? formatDate(row.due_date) : null,
      status: row.status,
      linkedReserveId: row.linked_reserve_id,
    };
    if (row.kind === "reserved") {
      reserved.push(item);
    } else {
      ordinary.push(item);
    }
  }
  return { ordinary, reserved };
}

async function loadObligationTotals(
  ownerId: OwnerId,
  obligationIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (obligationIds.length === 0) return map;
  const result = await query<ObligationTotalsRow>(
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

async function loadIncomeForMonth(
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<DashboardIncome[]> {
  const result = await query<IncomeRow>(
    `SELECT id::text, source_name, expected_cents::text,
            linked_account_id::text, status
     FROM income_expectations
     WHERE owner_id = $1 AND month_key = $2
     ORDER BY id ASC`,
    [ownerId, monthKey],
  );
  const ids = result.rows.map((r) => r.id);
  const totals = await loadIncomeTotals(ownerId, ids);
  const items: DashboardIncome[] = [];
  for (const row of result.rows) {
    if (row.status === "cancelled") continue;
    const expected = bigToInt(row.expected_cents) ?? 0;
    const received = totals.get(row.id) ?? 0;
    items.push({
      id: row.id,
      sourceName: row.source_name,
      expectedCents: expected,
      receivedCents: received,
      pendingCents: expected - received,
      status: row.status,
    });
  }
  return items;
}

async function loadIncomeTotals(
  ownerId: OwnerId,
  incomeIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (incomeIds.length === 0) return map;
  const result = await query<IncomeTotalsRow>(
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

async function loadTransfers(
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<DashboardTransfer[]> {
  // Internal transfers are net-zero and metadata-only for the forecast. We
  // load the current-month ones for the drilldown so the user can see what
  // moves they already made between their own accounts this month. We filter
  // by the business_date falling inside the month_key's calendar month
  // (Europe/Athens boundary is already encoded in month_key as YYYY-MM).
  const year = Number.parseInt(monthKey.slice(0, 4), 10);
  const month = Number.parseInt(monthKey.slice(5, 7), 10);
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const result = await query<TransferRow>(
    `SELECT id::text, from_account_id::text, to_account_id::text,
            amount_cents::text
     FROM internal_transfers
     WHERE owner_id = $1 AND business_date >= $2 AND business_date < $3
     ORDER BY business_date ASC, id ASC`,
    [ownerId, start, end],
  );
  return result.rows.map((row) => ({
    id: row.id,
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    amountCents: bigToInt(row.amount_cents) ?? 0,
  }));
}

// --- Public API ---

/**
 * Build the savings-first overview for the given owner and month.
 *
 * The month must correspond to an OPEN plan. When the plan is missing or
 * closed, `monthOpen` is false and the forecast is setup-incomplete (no
 * confident spendable figure is produced). This enforces the
 * current/open-month semantic: historical months are not reconstructed using
 * today's live B, and a closed-month comparison stays unavailable until Step15
 * snapshots exist.
 */
export async function getDashboardOverview(
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<DashboardOverview> {
  const plan = await loadPlan(ownerId, monthKey);
  const hasPlan = plan !== null;
  const monthOpen = plan !== null && plan.status === "open";

  const accounts = await loadAccounts(ownerId);
  const { ordinary, reserved } = monthOpen
    ? await loadObligationsForMonth(ownerId, monthKey)
    : { ordinary: [], reserved: [] };
  const income = monthOpen ? await loadIncomeForMonth(ownerId, monthKey) : [];
  const transfers = monthOpen ? await loadTransfers(ownerId, monthKey) : [];

  // Build forecast inputs for the pure core.
  const balances: BalanceEntry[] = accounts.map((a) => ({
    id: a.id,
    amount: a.balanceCents === null ? null : (a.balanceCents as Cents),
  }));

  const pendingIncome: PendingIncome[] = income.map((i) => ({
    id: i.id,
    expected: i.expectedCents as Cents,
    receivedCents: i.receivedCents as Cents,
  }));

  const ordinaryExpenses: OrdinaryExpense[] = ordinary.map((o) => ({
    id: o.id,
    planned: o.plannedCents as Cents,
    paidCents: o.paidCents as Cents,
    linkedReserveId: o.linkedReserveId ?? undefined,
  }));

  const reservedCommitments: ReservedCommitment[] = reserved.map((r) => ({
    id: r.id,
    planned: r.plannedCents as Cents,
    paidCents: r.paidCents as Cents,
  }));

  const internalTransfers: InternalTransfer[] = transfers.map((t) => ({
    fromAccountId: t.fromAccountId,
    toAccountId: t.toAccountId,
    amount: t.amountCents as Cents,
  }));

  // A closed plan never exposes a savings target to the live forecast (it
  // would be a historical snapshot, not the current live figure). The live
  // overview only produces a forecast for an open plan.
  const savingsTargetCents: Cents | null =
    monthOpen && plan !== null
      ? (bigToInt(plan.savings_target_cents) as Cents | null)
      : null;

  const forecastInput: ForecastInput = {
    balances,
    pendingIncome,
    ordinaryExpenses,
    reservedCommitments,
    internalTransfers,
    savingsTarget: savingsTargetCents,
  };

  const forecast = computeForecast(forecastInput);

  const hasUnenteredBalance = accounts.some((a) => a.balanceCents === null);
  const hasStaleBalance = accounts.some((a) => a.stale);
  const anyAccountTracked = accounts.length > 0;

  return {
    monthKey,
    monthOpen,
    hasPlan,
    forecast,
    savingsTargetCents,
    accounts,
    ordinaryExpenses: ordinary,
    reservedCommitments: reserved,
    income,
    transfers,
    hasUnenteredBalance,
    hasStaleBalance,
    anyAccountTracked,
  };
}