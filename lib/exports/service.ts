// Private owner-filtered export service.
//
// Produces a CSV and a JSON backup of an owner's financial data for a selected
// month (or all months for JSON). All reads are owner-scoped from the verified
// server session; no cross-owner data is ever included. No secret auth/session
// columns are exported.
//
// CSV export:
// - Owner-filtered: every row belongs to the owner.
// - UTF-8 Greek content with RFC 4180 quoting and formula-injection
//   neutralization on every text cell (account names, titles, source names).
// - No-store headers set by the route.
// - Sane limits: a single month per CSV request to bound the payload.
// - No public share links; the route is authenticated and origin-checked.
//
// JSON backup:
// - Owner-scoped snapshot of plans, accounts, obligations, income, settlements
//   and receipts for the selected month. Intended for personal backup; restore
//   /import is NOT automatic and is out of v1 scope.
// - No secrets, no session/auth columns, no tokenized URLs.
//
// Paid totals come from non-reversed settlements/receipts, same as the live
// services. Manual balance adjustments are exported separately as audit rows,
// not counted as payments.

import "server-only";
import { query } from "../db";
import type { OwnerId, MonthKey } from "../months/types";
import { validateOwnerId, validateMonthKey } from "../history/validation";
import {
  renderCsv,
  type CsvRow,
} from "./csv";
import { formatEur, type Cents } from "../finance/money";

export { renderCsv, neutralizeFormulaCell } from "./csv";
export type { CsvRow, CsvCell } from "./csv";

// --- Raw DB row shapes ---

type AccountRow = {
  id: string;
  name: string;
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
  original_month_key: string;
  current_month_key: string;
  due_date: Date | null;
  linked_account_id: string | null;
  linked_reserve_id: string | null;
  status: string;
};

type IncomeRow = {
  id: string;
  month_key: string;
  source_name: string;
  expected_cents: string;
  linked_account_id: string | null;
  status: string;
};

type SettlementRow = {
  id: string;
  obligation_id: string;
  obligation_title: string;
  amount_cents: string;
  mode: string;
  account_id: string | null;
  business_date: Date;
  recorded_at: Date;
  reversed: boolean;
};

type ReceiptRow = {
  id: string;
  income_expectation_id: string;
  income_source_name: string;
  amount_cents: string;
  mode: string;
  account_id: string | null;
  business_date: Date;
  recorded_at: Date;
  reversed: boolean;
};

type AdjustmentRow = {
  id: string;
  account_id: string;
  account_name: string;
  old_balance_cents: string | null;
  new_balance_cents: string;
  difference_cents: string;
  as_of: Date;
  recorded_at: Date;
};

type TransferRow = {
  id: string;
  from_account_id: string;
  from_account_name: string;
  to_account_id: string;
  to_account_name: string;
  amount_cents: string;
  business_date: Date;
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

function formatDateTime(date: Date): string {
  return date.toISOString();
}

function centsCell(value: number | null): CsvRow[number] {
  return { kind: "cents", value: value ?? 0 };
}

// --- CSV export ---

/**
 * Build the CSV content for a single month's owner-scoped data.
 *
 * Sections: accounts, ordinary expenses, reserved commitments, income,
 * settlements, receipts, balance adjustments, internal transfers. Each section
 * is preceded by a header row. Every text cell is formula-neutralized.
 */
export async function exportMonthCsv(
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<string> {
  const oid = validateOwnerId(ownerId);
  const key = validateMonthKey(monthKey);
  const rows: CsvRow[] = [];

  // --- Accounts ---
  rows.push(
    [
      { kind: "text", value: "Λογαριασμοί" },
      { kind: "raw", value: "" },
      { kind: "raw", value: "" },
      { kind: "raw", value: "" },
      { kind: "raw", value: "" },
    ],
  );
  rows.push([
    { kind: "text", value: "Όνομα" },
    { kind: "text", value: "Υπόλοιπο" },
    { kind: "text", value: "Ενημερώθηκε" },
    { kind: "text", value: "Ιχνηλατείται" },
    { kind: "text", value: "Αρχειοθετημένο" },
  ]);
  const accounts = await query<AccountRow>(
    `SELECT id::text, name, current_balance_cents::text, balance_as_of,
            track_balance, archived
     FROM accounts
     WHERE owner_id = $1
     ORDER BY created_at ASC, id ASC`,
    [oid],
  );
  for (const a of accounts.rows) {
    rows.push([
      { kind: "text", value: a.name },
      centsCell(bigToInt(a.current_balance_cents)),
      { kind: "raw", value: a.balance_as_of ? formatDateTime(a.balance_as_of) : "" },
      { kind: "raw", value: a.track_balance ? "ναι" : "όχι" },
      { kind: "raw", value: a.archived ? "ναι" : "όχι" },
    ]);
  }

  rows.push([{ kind: "raw", value: "" }]);

  // --- Ordinary expenses ---
  rows.push([{ kind: "text", value: `Έξοδα — ${key}` }]);
  rows.push([
    { kind: "text", value: "Τίτλος" },
    { kind: "text", value: "Σχεδιασμένο" },
    { kind: "text", value: "Πληρωμένο" },
    { kind: "text", value: "Υπόλοιπο" },
    { kind: "text", value: "Λήξη" },
    { kind: "text", value: "Κατάσταση" },
  ]);
  const oblRows = await query<ObligationRow>(
    `SELECT id::text, kind, title, planned_cents::text, original_month_key,
            current_month_key, due_date, linked_account_id::text,
            linked_reserve_id::text, status
     FROM obligations
     WHERE owner_id = $1 AND current_month_key = $2 AND kind = 'ordinary'
     ORDER BY due_date NULLS LAST, id ASC`,
    [oid, key],
  );
  const oblIds = oblRows.rows.map((r) => r.id);
  const paidMap = await loadPaidMap(oid, oblIds);
  for (const o of oblRows.rows) {
    const planned = bigToInt(o.planned_cents) ?? 0;
    const paid = paidMap.get(o.id) ?? 0;
    rows.push([
      { kind: "text", value: o.title },
      centsCell(planned),
      centsCell(paid),
      centsCell(planned - paid),
      { kind: "raw", value: o.due_date ? formatDate(o.due_date) : "" },
      { kind: "raw", value: o.status },
    ]);
  }

  rows.push([{ kind: "raw", value: "" }]);

  // --- Reserved commitments ---
  rows.push([{ kind: "text", value: `Δεσμεύσεις — ${key}` }]);
  rows.push([
    { kind: "text", value: "Τίτλος" },
    { kind: "text", value: "Σχεδιασμένο" },
    { kind: "text", value: "Πληρωμένο" },
    { kind: "text", value: "Υπόλοιπο" },
    { kind: "text", value: "Κατάσταση" },
  ]);
  const resRows = await query<ObligationRow>(
    `SELECT id::text, kind, title, planned_cents::text, original_month_key,
            current_month_key, due_date, linked_account_id::text,
            linked_reserve_id::text, status
     FROM obligations
     WHERE owner_id = $1 AND current_month_key = $2 AND kind = 'reserved'
     ORDER BY due_date NULLS LAST, id ASC`,
    [oid, key],
  );
  const resIds = resRows.rows.map((r) => r.id);
  const resPaidMap = await loadPaidMap(oid, resIds);
  for (const o of resRows.rows) {
    const planned = bigToInt(o.planned_cents) ?? 0;
    const paid = resPaidMap.get(o.id) ?? 0;
    rows.push([
      { kind: "text", value: o.title },
      centsCell(planned),
      centsCell(paid),
      centsCell(planned - paid),
      { kind: "raw", value: o.status },
    ]);
  }

  rows.push([{ kind: "raw", value: "" }]);

  // --- Income ---
  rows.push([{ kind: "text", value: `Έσοδα — ${key}` }]);
  rows.push([
    { kind: "text", value: "Πηγή" },
    { kind: "text", value: "Αναμενόμενο" },
    { kind: "text", value: "Ελημμένο" },
    { kind: "text", value: "Εκκρεμές" },
    { kind: "text", value: "Κατάσταση" },
  ]);
  const incRows = await query<IncomeRow>(
    `SELECT id::text, month_key, source_name, expected_cents::text,
            linked_account_id::text, status
     FROM income_expectations
     WHERE owner_id = $1 AND month_key = $2
     ORDER BY id ASC`,
    [oid, key],
  );
  const incIds = incRows.rows.map((r) => r.id);
  const receivedMap = await loadReceivedMap(oid, incIds);
  for (const i of incRows.rows) {
    const expected = bigToInt(i.expected_cents) ?? 0;
    const received = receivedMap.get(i.id) ?? 0;
    rows.push([
      { kind: "text", value: i.source_name },
      centsCell(expected),
      centsCell(received),
      centsCell(expected - received),
      { kind: "raw", value: i.status },
    ]);
  }

  rows.push([{ kind: "raw", value: "" }]);

  // --- Settlements (actual payments) ---
  rows.push([{ kind: "text", value: `Πληρωμές — ${key}` }]);
  rows.push([
    { kind: "text", value: "Έξοδο" },
    { kind: "text", value: "Ποσό" },
    { kind: "text", value: "Τρόπος" },
    { kind: "text", value: "Λογαριασμός" },
    { kind: "text", value: "Ημ/νία" },
    { kind: "text", value: "Καταγράφηκε" },
    { kind: "text", value: "Αντίστροφη" },
  ]);
  const settlements = await query<SettlementRow>(
    `SELECT s.id::text, s.obligation_id::text, o.title AS obligation_title,
            s.amount_cents::text, s.mode, s.account_id::text,
            s.business_date, s.recorded_at,
            EXISTS(SELECT 1 FROM settlement_reversals r
                   WHERE r.owner_id = $1 AND r.original_settlement_id = s.id) AS reversed
     FROM settlements s
     JOIN obligations o ON o.owner_id = s.owner_id AND o.id = s.obligation_id
     WHERE s.owner_id = $1 AND o.current_month_key = $2
     ORDER BY s.business_date ASC, s.id ASC`,
    [oid, key],
  );
  const accountNameMap = await loadAccountNameMap(oid);
  for (const s of settlements.rows) {
    rows.push([
      { kind: "text", value: s.obligation_title },
      centsCell(bigToInt(s.amount_cents)),
      { kind: "raw", value: s.mode },
      { kind: "text", value: s.account_id ? (accountNameMap.get(s.account_id) ?? "") : "" },
      { kind: "raw", value: formatDate(s.business_date) },
      { kind: "raw", value: formatDateTime(s.recorded_at) },
      { kind: "raw", value: s.reversed ? "ναι" : "όχι" },
    ]);
  }

  rows.push([{ kind: "raw", value: "" }]);

  // --- Receipts ---
  rows.push([{ kind: "text", value: `Εισπράξεις — ${key}` }]);
  rows.push([
    { kind: "text", value: "Έσοδο" },
    { kind: "text", value: "Ποσό" },
    { kind: "text", value: "Τρόπος" },
    { kind: "text", value: "Λογαριασμός" },
    { kind: "text", value: "Ημ/νία" },
    { kind: "text", value: "Καταγράφηκε" },
    { kind: "text", value: "Αντίστροφη" },
  ]);
  const receipts = await query<ReceiptRow>(
    `SELECT r.id::text, r.income_expectation_id::text, i.source_name AS income_source_name,
            r.amount_cents::text, r.mode, r.account_id::text,
            r.business_date, r.recorded_at,
            EXISTS(SELECT 1 FROM income_receipt_reversals rev
                   WHERE rev.owner_id = $1 AND rev.original_receipt_id = r.id) AS reversed
     FROM income_receipts r
     JOIN income_expectations i ON i.owner_id = r.owner_id AND i.id = r.income_expectation_id
     WHERE r.owner_id = $1 AND i.month_key = $2
     ORDER BY r.business_date ASC, r.id ASC`,
    [oid, key],
  );
  for (const r of receipts.rows) {
    rows.push([
      { kind: "text", value: r.income_source_name },
      centsCell(bigToInt(r.amount_cents)),
      { kind: "raw", value: r.mode },
      { kind: "text", value: r.account_id ? (accountNameMap.get(r.account_id) ?? "") : "" },
      { kind: "raw", value: formatDate(r.business_date) },
      { kind: "raw", value: formatDateTime(r.recorded_at) },
      { kind: "raw", value: r.reversed ? "ναι" : "όχι" },
    ]);
  }

  rows.push([{ kind: "raw", value: "" }]);

  // --- Balance adjustments (manual refreshes, NOT payments) ---
  rows.push([{ kind: "text", value: `Προσαρμογές υπολοίπου — ${key}` }]);
  rows.push([
    { kind: "text", value: "Λογαριασμός" },
    { kind: "text", value: "Παλαιό υπόλοιπο" },
    { kind: "text", value: "Νέο υπόλοιπο" },
    { kind: "text", value: "Διαφορά" },
    { kind: "text", value: "Ενημερώθηκε" },
    { kind: "text", value: "Καταγράφηκε" },
  ]);
  const adjustments = await query<AdjustmentRow>(
    `SELECT ba.id::text, ba.account_id::text, a.name AS account_name,
            ba.old_balance_cents::text, ba.new_balance_cents::text,
            ba.difference_cents::text, ba.as_of, ba.recorded_at
     FROM balance_adjustments ba
     JOIN accounts a ON a.owner_id = ba.owner_id AND a.id = ba.account_id
     WHERE ba.owner_id = $1
       AND ba.recorded_at >= date_trunc('month', ($2 || '-01')::date::timestamptz)
       AND ba.recorded_at < date_trunc('month', ($2 || '-01')::date::timestamptz + interval '1 month')
     ORDER BY ba.recorded_at ASC, ba.id ASC`,
    [oid, key],
  );
  for (const a of adjustments.rows) {
    rows.push([
      { kind: "text", value: a.account_name },
      centsCell(bigToInt(a.old_balance_cents)),
      centsCell(bigToInt(a.new_balance_cents)),
      centsCell(bigToInt(a.difference_cents)),
      { kind: "raw", value: formatDateTime(a.as_of) },
      { kind: "raw", value: formatDateTime(a.recorded_at) },
    ]);
  }

  rows.push([{ kind: "raw", value: "" }]);

  // --- Internal transfers ---
  rows.push([{ kind: "text", value: `Εσωτερικές μεταφορές — ${key}` }]);
  rows.push([
    { kind: "text", value: "Από λογαριασμό" },
    { kind: "text", value: "Προς λογαριασμό" },
    { kind: "text", value: "Ποσό" },
    { kind: "text", value: "Ημ/νία" },
  ]);
  const transfers = await query<TransferRow>(
    `SELECT t.id::text, t.from_account_id::text, fa.name AS from_account_name,
            t.to_account_id::text, ta.name AS to_account_name,
            t.amount_cents::text, t.business_date
     FROM internal_transfers t
     JOIN accounts fa ON fa.owner_id = t.owner_id AND fa.id = t.from_account_id
     JOIN accounts ta ON ta.owner_id = t.owner_id AND ta.id = t.to_account_id
     WHERE t.owner_id = $1
       AND t.business_date >= date_trunc('month', ($2 || '-01')::date)::date
       AND t.business_date < date_trunc('month', ($2 || '-01')::date + interval '1 month')::date
     ORDER BY t.business_date ASC, t.id ASC`,
    [oid, key],
  );
  for (const t of transfers.rows) {
    rows.push([
      { kind: "text", value: t.from_account_name },
      { kind: "text", value: t.to_account_name },
      centsCell(bigToInt(t.amount_cents)),
      { kind: "raw", value: formatDate(t.business_date) },
    ]);
  }

  return renderCsv(rows);
}

// --- JSON backup ---

/**
 * Build a JSON backup payload for a single month's owner-scoped data.
 * Restore/import is NOT automatic and is out of v1 scope. No secrets or auth
 * columns are included.
 */
export async function exportMonthJson(
  ownerId: OwnerId,
  monthKey: MonthKey,
): Promise<string> {
  const oid = validateOwnerId(ownerId);
  const key = validateMonthKey(monthKey);

  const accounts = await query<AccountRow>(
    `SELECT id::text, name, current_balance_cents::text, balance_as_of,
            track_balance, archived
     FROM accounts
     WHERE owner_id = $1
     ORDER BY created_at ASC, id ASC`,
    [oid],
  );

  const oblRows = await query<ObligationRow>(
    `SELECT id::text, kind, title, planned_cents::text, original_month_key,
            current_month_key, due_date, linked_account_id::text,
            linked_reserve_id::text, status
     FROM obligations
     WHERE owner_id = $1 AND current_month_key = $2
     ORDER BY due_date NULLS LAST, id ASC`,
    [oid, key],
  );
  const oblIds = oblRows.rows.map((r) => r.id);
  const paidMap = await loadPaidMap(oid, oblIds);

  const incRows = await query<IncomeRow>(
    `SELECT id::text, month_key, source_name, expected_cents::text,
            linked_account_id::text, status
     FROM income_expectations
     WHERE owner_id = $1 AND month_key = $2
     ORDER BY id ASC`,
    [oid, key],
  );
  const incIds = incRows.rows.map((r) => r.id);
  const receivedMap = await loadReceivedMap(oid, incIds);

  const settlements = await query<SettlementRow>(
    `SELECT s.id::text, s.obligation_id::text, o.title AS obligation_title,
            s.amount_cents::text, s.mode, s.account_id::text,
            s.business_date, s.recorded_at,
            EXISTS(SELECT 1 FROM settlement_reversals r
                   WHERE r.owner_id = $1 AND r.original_settlement_id = s.id) AS reversed
     FROM settlements s
     JOIN obligations o ON o.owner_id = s.owner_id AND o.id = s.obligation_id
     WHERE s.owner_id = $1 AND o.current_month_key = $2
     ORDER BY s.business_date ASC, s.id ASC`,
    [oid, key],
  );

  const receipts = await query<ReceiptRow>(
    `SELECT r.id::text, r.income_expectation_id::text, i.source_name AS income_source_name,
            r.amount_cents::text, r.mode, r.account_id::text,
            r.business_date, r.recorded_at,
            EXISTS(SELECT 1 FROM income_receipt_reversals rev
                   WHERE rev.owner_id = $1 AND rev.original_receipt_id = r.id) AS reversed
     FROM income_receipts r
     JOIN income_expectations i ON i.owner_id = r.owner_id AND i.id = r.income_expectation_id
     WHERE r.owner_id = $1 AND i.month_key = $2
     ORDER BY r.business_date ASC, r.id ASC`,
    [oid, key],
  );

  const planRow = await query<{
    id: string;
    savings_target_cents: string;
    status: string;
    closed_at: Date | null;
  }>(
    `SELECT id::text, savings_target_cents::text, status, closed_at
     FROM monthly_plans WHERE owner_id = $1 AND month_key = $2`,
    [oid, key],
  );

  const payload = {
    format: "mysavings-month-json-v1",
    exportedAt: new Date().toISOString(),
    monthKey: key,
    plan:
      planRow.rows.length > 0
        ? {
            id: planRow.rows[0].id,
            savingsTargetCents: bigToInt(planRow.rows[0].savings_target_cents) ?? 0,
            status: planRow.rows[0].status,
            closedAt: planRow.rows[0].closed_at
              ? planRow.rows[0].closed_at.toISOString()
              : null,
          }
        : null,
    accounts: accounts.rows.map((a) => ({
      id: a.id,
      name: a.name,
      balanceCents: bigToInt(a.current_balance_cents),
      balanceAsOf: a.balance_as_of ? a.balance_as_of.toISOString() : null,
      trackBalance: a.track_balance,
      archived: a.archived,
    })),
    obligations: oblRows.rows.map((o) => ({
      id: o.id,
      kind: o.kind,
      title: o.title,
      plannedCents: bigToInt(o.planned_cents) ?? 0,
      paidCents: paidMap.get(o.id) ?? 0,
      remainingCents: (bigToInt(o.planned_cents) ?? 0) - (paidMap.get(o.id) ?? 0),
      originalMonthKey: o.original_month_key,
      currentMonthKey: o.current_month_key,
      dueDate: o.due_date ? formatDate(o.due_date) : null,
      linkedAccountId: o.linked_account_id,
      linkedReserveId: o.linked_reserve_id,
      status: o.status,
    })),
    income: incRows.rows.map((i) => ({
      id: i.id,
      sourceName: i.source_name,
      expectedCents: bigToInt(i.expected_cents) ?? 0,
      receivedCents: receivedMap.get(i.id) ?? 0,
      pendingCents: (bigToInt(i.expected_cents) ?? 0) - (receivedMap.get(i.id) ?? 0),
      status: i.status,
    })),
    settlements: settlements.rows.map((s) => ({
      id: s.id,
      obligationId: s.obligation_id,
      obligationTitle: s.obligation_title,
      amountCents: bigToInt(s.amount_cents) ?? 0,
      mode: s.mode,
      accountId: s.account_id,
      businessDate: formatDate(s.business_date),
      recordedAt: s.recorded_at.toISOString(),
      reversed: s.reversed,
    })),
    receipts: receipts.rows.map((r) => ({
      id: r.id,
      incomeExpectationId: r.income_expectation_id,
      incomeSourceName: r.income_source_name,
      amountCents: bigToInt(r.amount_cents) ?? 0,
      mode: r.mode,
      accountId: r.account_id,
      businessDate: formatDate(r.business_date),
      recordedAt: r.recorded_at.toISOString(),
      reversed: r.reversed,
    })),
  };

  // Avoid leaking owner ids in the backup file is unnecessary — the owner is
  // the only recipient. We do NOT include auth/session columns.
  return JSON.stringify(payload, null, 2);
}

// --- Shared batch helpers (pool query, read-only) ---

async function loadPaidMap(
  ownerId: OwnerId,
  obligationIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (obligationIds.length === 0) return map;
  const result = await query<{ obligation_id: string; paid_cents: string }>(
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
  const result = await query<{
    income_expectation_id: string;
    received_cents: string;
  }>(
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

async function loadAccountNameMap(
  ownerId: OwnerId,
): Promise<Map<string, string>> {
  const result = await query<{ id: string; name: string }>(
    `SELECT id::text, name FROM accounts WHERE owner_id = $1`,
    [ownerId],
  );
  return new Map(result.rows.map((r) => [r.id, r.name]));
}

// Re-export formatEur so the route can build the filename safely if needed.
export { formatEur };