// Settlement service: owner-scoped partial payments, income receipts and
// reversals.
//
// All functions take an ownerId derived from the verified server session.
// No function accepts arbitrary unvalidated owner input from clients. Every
// write uses withTransaction (explicit BEGIN/COMMIT/ROLLBACK on one
// checked-out client). Financial cents are exact integers bounded by
// lib/finance/money.
//
// Key invariants enforced here:
// - The planned_cents on the obligation and expected_cents on the income
//   expectation are NEVER mutated by settlements/receipts. Only settlements/
//   receipts grow. Paid/remaining and received/pending are derived from
//   non-reversed rows.
// - UPDATE_ACCOUNT: the account balance is changed atomically with an
//   immutable account_movements row. ALREADY_REFLECTED: no balance change
//   and no movement (the bank refresh already includes the amount).
// - Overpayment is rejected: the sum of non-reversed settlements must not
//   exceed planned_cents. Concurrent payments are prevented from exceeding
//   remaining by row-locking the obligation before the paid-sum query and
//   holding the lock until commit.
// - Owner+operation idempotency keys deduplicate retries. A retry with the
//   same key and a matching payload hash returns the original safe result.
//   A retry with the same key but a changed payload is rejected.
// - Reversals create compensating immutable rows linked to the original.
//   The original settlement/receipt is never UPDATEd. Double reversal is
//   prevented by a unique index on (owner_id, original_settlement_id).
// - Reversal after a later manual balance refresh: if the original
//   settlement used UPDATE_ACCOUNT and the account was refreshed after the
//   settlement was recorded, the reversal MUST NOT blindly credit/debit the
//   account. The caller must explicitly decide whether to adjust the balance
//   (adjustBalanceAfterRefresh). If the caller does not provide this flag,
//   a RefreshReconciliationRequiredError is thrown so the UI can prompt for
//   an explicit decision. If the account was NOT refreshed after the
//   settlement, the balance is always reversed with a compensating movement.
//
// Deterministic lock order (prevents deadlocks across concurrent operations):
//   1. operation_log row for (owner_id, idempotency_key) — via INSERT.
//   2. obligation/income row (FOR UPDATE) — the entity being settled.
//   3. account row (FOR UPDATE) — when mode is UPDATE_ACCOUNT.
//   4. monthly_plans row (read-only status check, no FOR UPDATE needed).
//
// All four row types are touched in a fixed sequence so two concurrent
// operations on the same obligation+account always lock in the same order
// and serialize rather than deadlock.

import "server-only";
import { createHash } from "node:crypto";
import { withTransaction, query, type PoolClient } from "../db";
import type { OwnerId } from "../months/types";
import {
  SettlementNotFoundError,
  SettlementConflictError,
  SettlementValidationError,
  SettlementServiceError,
  IdempotencyConflictError,
  OverpaymentError,
  ClosedMonthError,
  AlreadyReversedError,
  RefreshReconciliationRequiredError,
  type Settlement,
  type Receipt,
  type PayInput,
  type PayResult,
  type ReceiveInput,
  type ReceiveResult,
  type ReverseSettlementInput,
  type ReverseSettlementResult,
  type ReverseReceiptInput,
  type ReverseReceiptResult,
  type SettlementMode,
} from "./types";
import {
  validatePayInput,
  validateReceiveInput,
  validateReverseSettlementInput,
  validateReverseReceiptInput,
} from "./validation";

export {
  SettlementNotFoundError,
  SettlementConflictError,
  SettlementValidationError,
  SettlementServiceError,
  IdempotencyConflictError,
  OverpaymentError,
  ClosedMonthError,
  AlreadyReversedError,
  RefreshReconciliationRequiredError,
};

// --- Row types (raw DB shape, snake_case) ---

type ObligationRow = {
  id: string;
  kind: string;
  title: string;
  planned_cents: string;
  current_month_key: string;
  status: string;
  linked_account_id: string | null;
};

type IncomeRow = {
  id: string;
  month_key: string;
  source_name: string;
  expected_cents: string;
  status: string;
  linked_account_id: string | null;
};

type AccountRow = {
  id: string;
  current_balance_cents: string | null;
  archived: boolean;
  version: string;
};

type SettlementRow = {
  id: string;
  obligation_id: string;
  amount_cents: string;
  mode: string;
  account_id: string | null;
  business_date: Date;
  recorded_at: Date;
  idempotency_key: string;
};

type ReceiptRow = {
  id: string;
  income_expectation_id: string;
  amount_cents: string;
  mode: string;
  account_id: string | null;
  business_date: Date;
  recorded_at: Date;
  idempotency_key: string;
};

type PlanStatusRow = { status: string };

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

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDate(dateStr: string): Date {
  const parts = dateStr.split("-");
  const y = Number.parseInt(parts[0], 10);
  const m = Number.parseInt(parts[1], 10);
  const d = Number.parseInt(parts[2], 10);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

function payloadHash(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "23505";
  }
  return false;
}

function isForeignKeyViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "23503";
  }
  return false;
}

// --- Idempotency ---

type IdempotencyOutcome =
  | { status: "new" }
  | { status: "replay"; operationType: string };

async function checkIdempotency(
  client: PoolClient,
  ownerId: OwnerId,
  operationKey: string,
  expectedPayloadHash: string,
  operationType: string,
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
  if (row.payload_hash !== expectedPayloadHash || row.operation_type !== operationType) {
    throw new IdempotencyConflictError(
      "An operation with this key already exists with different parameters",
    );
  }
  return { status: "replay", operationType: row.operation_type };
}

async function recordOperation(
  client: PoolClient,
  ownerId: OwnerId,
  operationKey: string,
  hash: string,
  operationType: string,
): Promise<void> {
  await client.query(
    `INSERT INTO operation_log (owner_id, operation_key, payload_hash, operation_type)
     VALUES ($1, $2, $3, $4)`,
    [ownerId, operationKey, hash, operationType],
  );
}

// --- Paid / received computation (under lock) ---

async function computePaidCents(
  client: PoolClient,
  ownerId: OwnerId,
  obligationId: string,
): Promise<number> {
  const result = await client.query<{ paid: string | null }>(
    `SELECT COALESCE(SUM(s.amount_cents), 0)::text AS paid
     FROM settlements s
     WHERE s.owner_id = $1 AND s.obligation_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM settlement_reversals r
         WHERE r.owner_id = $1 AND r.original_settlement_id = s.id
       )`,
    [ownerId, obligationId],
  );
  return bigToInt(result.rows[0]?.paid) ?? 0;
}

async function computeReceivedCents(
  client: PoolClient,
  ownerId: OwnerId,
  incomeId: string,
): Promise<number> {
  const result = await client.query<{ received: string | null }>(
    `SELECT COALESCE(SUM(r.amount_cents), 0)::text AS received
     FROM income_receipts r
     WHERE r.owner_id = $1 AND r.income_expectation_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM income_receipt_reversals rev
         WHERE rev.owner_id = $1 AND rev.original_receipt_id = r.id
       )`,
    [ownerId, incomeId],
  );
  return bigToInt(result.rows[0]?.received) ?? 0;
}

// --- Plan status check ---

async function requireOpenMonth(
  client: PoolClient,
  ownerId: OwnerId,
  monthKey: string,
): Promise<void> {
  const result = await client.query<PlanStatusRow>(
    `SELECT status FROM monthly_plans
     WHERE owner_id = $1 AND month_key = $2`,
    [ownerId, monthKey],
  );
  if (result.rows.length === 0) {
    throw new SettlementValidationError(
      `No plan exists for ${monthKey}; create a plan first`,
    );
  }
  if (result.rows[0].status === "closed") {
    throw new ClosedMonthError(`Month ${monthKey} is closed and cannot be edited`);
  }
}

// --- Account locking helper ---

type LockedAccount = {
  id: string;
  currentBalanceCents: number | null;
  archived: boolean;
  version: number;
};

async function lockAccount(
  client: PoolClient,
  ownerId: OwnerId,
  accountId: string,
): Promise<LockedAccount> {
  const result = await client.query<AccountRow>(
    `SELECT id, current_balance_cents, archived, version
     FROM accounts
     WHERE owner_id = $1 AND id = $2
     FOR UPDATE`,
    [ownerId, accountId],
  );
  if (result.rows.length === 0) {
    throw new SettlementNotFoundError("Account not found");
  }
  const row = result.rows[0];
  return {
    id: row.id,
    currentBalanceCents: bigToInt(row.current_balance_cents),
    archived: row.archived,
    version: bigToInt(row.version) ?? 1,
  };
}

async function lockObligation(
  client: PoolClient,
  ownerId: OwnerId,
  obligationId: string,
): Promise<ObligationRow> {
  const result = await client.query<ObligationRow>(
    `SELECT id, kind, title, planned_cents, current_month_key, status,
            linked_account_id::text
     FROM obligations
     WHERE owner_id = $1 AND id = $2
     FOR UPDATE`,
    [ownerId, obligationId],
  );
  if (result.rows.length === 0) {
    throw new SettlementNotFoundError("Obligation not found");
  }
  return result.rows[0];
}

async function lockIncome(
  client: PoolClient,
  ownerId: OwnerId,
  incomeId: string,
): Promise<IncomeRow> {
  const result = await client.query<IncomeRow>(
    `SELECT id, month_key, source_name, expected_cents, status,
            linked_account_id::text
     FROM income_expectations
     WHERE owner_id = $1 AND id = $2
     FOR UPDATE`,
    [ownerId, incomeId],
  );
  if (result.rows.length === 0) {
    throw new SettlementNotFoundError("Income expectation not found");
  }
  return result.rows[0];
}

// --- Payment (expense settlement) ---

/**
 * Record a partial or full payment against an obligation.
 *
 * Lock order: operation_log INSERT -> obligation FOR UPDATE -> account FOR
 * UPDATE (when UPDATE_ACCOUNT). The obligation lock is held from the
 * paid-sum query through the settlement insert so two concurrent payments
 * cannot both read the same remaining and overpay.
 */
export async function payObligation(
  ownerId: OwnerId,
  rawInput: PayInput,
): Promise<PayResult> {
  const input = validatePayInput(rawInput);
  const hash = payloadHash(
    JSON.stringify({
      operation: "pay",
      obligationId: input.obligationId,
      amountCents: input.amountCents,
      mode: input.mode,
      accountId: input.accountId,
      businessDate: input.businessDate,
    }),
  );

  return withTransaction(async (client) => {
    // 1. Idempotency check.
    const idem = await checkIdempotency(
      client,
      ownerId,
      input.idempotencyKey,
      hash,
      "pay_obligation",
    );
    if (idem.status === "replay") {
      return await replayPayment(client, ownerId, input.idempotencyKey);
    }

    // 2. Lock the obligation row (prevents concurrent overpayment).
    const obligation = await lockObligation(client, ownerId, input.obligationId);

    // 3. Check the month is open.
    await requireOpenMonth(client, ownerId, obligation.current_month_key);

    // 4. Compute current paid under lock.
    const paidBefore = await computePaidCents(client, ownerId, obligation.id);
    const planned = bigToInt(obligation.planned_cents) ?? 0;
    const remaining = planned - paidBefore;

    // 5. Reject overpayment.
    if (input.amountCents > remaining) {
      throw new OverpaymentError(
        remaining > 0
          ? `Payment exceeds the remaining amount`
          : `The obligation is already fully paid`,
      );
    }

    // 6. Lock the account and update balance when UPDATE_ACCOUNT.
    let accountNewBalance: number | null = null;
    if (input.mode === "UPDATE_ACCOUNT" && input.accountId) {
      const account = await lockAccount(client, ownerId, input.accountId);
      if (account.archived) {
        throw new SettlementValidationError(
          "Cannot pay from an archived account",
        );
      }
      accountNewBalance =
        account.currentBalanceCents === null
          ? -input.amountCents
          : account.currentBalanceCents - input.amountCents;
      await client.query(
        `UPDATE accounts
         SET current_balance_cents = $3, balance_as_of = now(),
             version = version + 1, updated_at = now()
         WHERE owner_id = $1 AND id = $2`,
        [ownerId, account.id, accountNewBalance],
      );
    }

    // 7. Insert the immutable settlement row.
    let settlementRow: SettlementRow;
    try {
      const inserted = await client.query<SettlementRow>(
        `INSERT INTO settlements
           (owner_id, obligation_id, amount_cents, mode, account_id,
            business_date, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, obligation_id::text, amount_cents::text, mode,
                   account_id::text, business_date, recorded_at,
                   idempotency_key`,
        [
          ownerId,
          obligation.id,
          input.amountCents,
          input.mode,
          input.accountId,
          parseDate(input.businessDate),
          input.idempotencyKey,
        ],
      );
      settlementRow = inserted.rows[0];
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new IdempotencyConflictError(
          "A settlement with this idempotency key already exists with different parameters",
        );
      }
      if (isForeignKeyViolation(error)) {
        throw new SettlementValidationError(
          "The selected account does not exist or does not belong to you",
        );
      }
      throw error;
    }

    // 8. Create the account movement when UPDATE_ACCOUNT.
    if (input.mode === "UPDATE_ACCOUNT" && input.accountId) {
      await client.query(
        `INSERT INTO account_movements
           (owner_id, account_id, direction, amount_cents, source_type,
            source_id, business_date)
         VALUES ($1, $2, 'debit', $3, 'settlement', $4, $5)`,
        [
          ownerId,
          input.accountId,
          input.amountCents,
          settlementRow.id,
          parseDate(input.businessDate),
        ],
      );
    }

    // 9. Write audit log.
    await client.query(
      `INSERT INTO audit_log (owner_id, operation_type, entity_type, entity_id, summary)
       VALUES ($1, 'settlement_create', 'settlement', $2, $3)`,
      [
        ownerId,
        settlementRow.id,
        `Payment ${input.amountCents} cents recorded for obligation`,
      ],
    );

    // 10. Record the operation for idempotency.
    await recordOperation(
      client,
      ownerId,
      input.idempotencyKey,
      hash,
      "pay_obligation",
    );

    const paidAfter = paidBefore + input.amountCents;
    return {
      settlementId: settlementRow.id,
      obligationId: obligation.id,
      amountCents: input.amountCents,
      mode: input.mode,
      accountId: input.accountId,
      businessDate: input.businessDate,
      paidCents: paidAfter,
      remainingCents: planned - paidAfter,
      accountNewBalance,
      reversed: false,
    };
  });
}

/** Reconstruct a PayResult from the DB for an idempotent replay. */
async function replayPayment(
  client: PoolClient,
  ownerId: OwnerId,
  idempotencyKey: string,
): Promise<PayResult> {
  const result = await client.query<SettlementRow>(
    `SELECT id, obligation_id::text, amount_cents::text, mode,
            account_id::text, business_date, recorded_at, idempotency_key
     FROM settlements
     WHERE owner_id = $1 AND idempotency_key = $2`,
    [ownerId, idempotencyKey],
  );
  if (result.rows.length === 0) {
    throw new IdempotencyConflictError(
      "Idempotency key recorded but no settlement found",
    );
  }
  const row = result.rows[0];
  const amount = bigToInt(row.amount_cents) ?? 0;
  const paid = await computePaidCents(client, ownerId, row.obligation_id);
  const obligation = await client.query<{ planned_cents: string }>(
    `SELECT planned_cents::text FROM obligations WHERE owner_id = $1 AND id = $2`,
    [ownerId, row.obligation_id],
  );
  const planned = bigToInt(obligation.rows[0]?.planned_cents) ?? 0;
  let accountNewBalance: number | null = null;
  if (row.account_id) {
    const acct = await client.query<{ bal: string | null }>(
      `SELECT current_balance_cents::text AS bal FROM accounts WHERE owner_id = $1 AND id = $2`,
      [ownerId, row.account_id],
    );
    accountNewBalance = bigToInt(acct.rows[0]?.bal ?? null);
  }
  return {
    settlementId: row.id,
    obligationId: row.obligation_id,
    amountCents: amount,
    mode: row.mode as SettlementMode,
    accountId: row.account_id,
    businessDate: formatDate(row.business_date),
    paidCents: paid,
    remainingCents: planned - paid,
    accountNewBalance,
    reversed: false,
  };
}

// --- Receipt (income) ---

/**
 * Record a partial or full income receipt against an income expectation.
 * Mirrors payObligation but adds to the account balance instead of
 * subtracting.
 */
export async function receiveIncome(
  ownerId: OwnerId,
  rawInput: ReceiveInput,
): Promise<ReceiveResult> {
  const input = validateReceiveInput(rawInput);
  const hash = payloadHash(
    JSON.stringify({
      operation: "receive",
      incomeExpectationId: input.incomeExpectationId,
      amountCents: input.amountCents,
      mode: input.mode,
      accountId: input.accountId,
      businessDate: input.businessDate,
    }),
  );

  return withTransaction(async (client) => {
    // 1. Idempotency check.
    const idem = await checkIdempotency(
      client,
      ownerId,
      input.idempotencyKey,
      hash,
      "receive_income",
    );
    if (idem.status === "replay") {
      return await replayReceipt(client, ownerId, input.idempotencyKey);
    }

    // 2. Lock the income row.
    const income = await lockIncome(client, ownerId, input.incomeExpectationId);

    // 3. Check the month is open.
    await requireOpenMonth(client, ownerId, income.month_key);

    // 4. Compute current received under lock.
    const receivedBefore = await computeReceivedCents(client, ownerId, income.id);
    const expected = bigToInt(income.expected_cents) ?? 0;
    const pending = expected - receivedBefore;

    // 5. Reject over-receipt.
    if (input.amountCents > pending) {
      throw new OverpaymentError(
        pending > 0
          ? `Receipt exceeds the pending amount`
          : `The income expectation is already fully received`,
      );
    }

    // 6. Lock the account and update balance when UPDATE_ACCOUNT.
    let accountNewBalance: number | null = null;
    if (input.mode === "UPDATE_ACCOUNT" && input.accountId) {
      const account = await lockAccount(client, ownerId, input.accountId);
      if (account.archived) {
        throw new SettlementValidationError(
          "Cannot receive into an archived account",
        );
      }
      accountNewBalance =
        account.currentBalanceCents === null
          ? input.amountCents
          : account.currentBalanceCents + input.amountCents;
      await client.query(
        `UPDATE accounts
         SET current_balance_cents = $3, balance_as_of = now(),
             version = version + 1, updated_at = now()
         WHERE owner_id = $1 AND id = $2`,
        [ownerId, account.id, accountNewBalance],
      );
    }

    // 7. Insert the immutable receipt row.
    let receiptRow: ReceiptRow;
    try {
      const inserted = await client.query<ReceiptRow>(
        `INSERT INTO income_receipts
           (owner_id, income_expectation_id, amount_cents, mode, account_id,
            business_date, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, income_expectation_id::text, amount_cents::text, mode,
                   account_id::text, business_date, recorded_at,
                   idempotency_key`,
        [
          ownerId,
          income.id,
          input.amountCents,
          input.mode,
          input.accountId,
          parseDate(input.businessDate),
          input.idempotencyKey,
        ],
      );
      receiptRow = inserted.rows[0];
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new IdempotencyConflictError(
          "A receipt with this idempotency key already exists with different parameters",
        );
      }
      if (isForeignKeyViolation(error)) {
        throw new SettlementValidationError(
          "The selected account does not exist or does not belong to you",
        );
      }
      throw error;
    }

    // 8. Create the account movement when UPDATE_ACCOUNT.
    if (input.mode === "UPDATE_ACCOUNT" && input.accountId) {
      await client.query(
        `INSERT INTO account_movements
           (owner_id, account_id, direction, amount_cents, source_type,
            source_id, business_date)
         VALUES ($1, $2, 'credit', $3, 'receipt', $4, $5)`,
        [
          ownerId,
          input.accountId,
          input.amountCents,
          receiptRow.id,
          parseDate(input.businessDate),
        ],
      );
    }

    // 9. Write audit log.
    await client.query(
      `INSERT INTO audit_log (owner_id, operation_type, entity_type, entity_id, summary)
       VALUES ($1, 'receipt_create', 'receipt', $2, $3)`,
      [
        ownerId,
        receiptRow.id,
        `Receipt ${input.amountCents} cents recorded for income expectation`,
      ],
    );

    // 10. Record the operation for idempotency.
    await recordOperation(
      client,
      ownerId,
      input.idempotencyKey,
      hash,
      "receive_income",
    );

    const receivedAfter = receivedBefore + input.amountCents;
    return {
      receiptId: receiptRow.id,
      incomeExpectationId: income.id,
      amountCents: input.amountCents,
      mode: input.mode,
      accountId: input.accountId,
      businessDate: input.businessDate,
      receivedCents: receivedAfter,
      pendingCents: expected - receivedAfter,
      accountNewBalance,
      reversed: false,
    };
  });
}

/** Reconstruct a ReceiveResult from the DB for an idempotent replay. */
async function replayReceipt(
  client: PoolClient,
  ownerId: OwnerId,
  idempotencyKey: string,
): Promise<ReceiveResult> {
  const result = await client.query<ReceiptRow>(
    `SELECT id, income_expectation_id::text, amount_cents::text, mode,
            account_id::text, business_date, recorded_at, idempotency_key
     FROM income_receipts
     WHERE owner_id = $1 AND idempotency_key = $2`,
    [ownerId, idempotencyKey],
  );
  if (result.rows.length === 0) {
    throw new IdempotencyConflictError(
      "Idempotency key recorded but no receipt found",
    );
  }
  const row = result.rows[0];
  const amount = bigToInt(row.amount_cents) ?? 0;
  const received = await computeReceivedCents(client, ownerId, row.income_expectation_id);
  const income = await client.query<{ expected_cents: string }>(
    `SELECT expected_cents::text FROM income_expectations WHERE owner_id = $1 AND id = $2`,
    [ownerId, row.income_expectation_id],
  );
  const expected = bigToInt(income.rows[0]?.expected_cents) ?? 0;
  let accountNewBalance: number | null = null;
  if (row.account_id) {
    const acct = await client.query<{ bal: string | null }>(
      `SELECT current_balance_cents::text AS bal FROM accounts WHERE owner_id = $1 AND id = $2`,
      [ownerId, row.account_id],
    );
    accountNewBalance = bigToInt(acct.rows[0]?.bal ?? null);
  }
  return {
    receiptId: row.id,
    incomeExpectationId: row.income_expectation_id,
    amountCents: amount,
    mode: row.mode as SettlementMode,
    accountId: row.account_id,
    businessDate: formatDate(row.business_date),
    receivedCents: received,
    pendingCents: expected - received,
    accountNewBalance,
    reversed: false,
  };
}

// --- Reversal: settlement ---

/**
 * Check whether the account was manually refreshed after a settlement was
 * recorded. Returns true when a balance_adjustments row exists with
 * recorded_at > settlement.recorded_at for the same account.
 */
async function accountRefreshedAfterSettlement(
  client: PoolClient,
  ownerId: OwnerId,
  accountId: string,
  settlementRecordedAt: Date,
): Promise<boolean> {
  const result = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n
     FROM balance_adjustments
     WHERE owner_id = $1 AND account_id = $2
       AND recorded_at > $3`,
    [ownerId, accountId, settlementRecordedAt],
  );
  return (bigToInt(result.rows[0]?.n) ?? 0) > 0;
}

/**
 * Reverse a settlement. Creates an immutable settlement_reversals row linked
 * to the original. If the original used UPDATE_ACCOUNT and the account was
 * manually refreshed after the settlement, the caller MUST explicitly decide
 * whether to adjust the balance via adjustBalanceAfterRefresh.
 */
export async function reverseSettlement(
  ownerId: OwnerId,
  rawInput: ReverseSettlementInput,
): Promise<ReverseSettlementResult> {
  const input = validateReverseSettlementInput(rawInput);
  const hash = payloadHash(
    JSON.stringify({
      operation: "reverse_settlement",
      settlementId: input.settlementId,
      businessDate: input.businessDate,
      reason: input.reason ?? null,
      adjustBalanceAfterRefresh: input.adjustBalanceAfterRefresh ?? null,
    }),
  );

  return withTransaction(async (client) => {
    // 1. Idempotency check.
    const idem = await checkIdempotency(
      client,
      ownerId,
      input.idempotencyKey,
      hash,
      "reverse_settlement",
    );
    if (idem.status === "replay") {
      return await replaySettlementReversal(client, ownerId, input.idempotencyKey);
    }

    // 2. Lock the original settlement row.
    const settlementResult = await client.query<SettlementRow>(
      `SELECT id, obligation_id::text, amount_cents::text, mode,
              account_id::text, business_date, recorded_at, idempotency_key
       FROM settlements
       WHERE owner_id = $1 AND id = $2
       FOR UPDATE`,
      [ownerId, input.settlementId],
    );
    if (settlementResult.rows.length === 0) {
      throw new SettlementNotFoundError("Settlement not found");
    }
    const settlement = settlementResult.rows[0];
    const amount = bigToInt(settlement.amount_cents) ?? 0;

    // 3. Guard double reversal.
    const existingReversal = await client.query<{ id: string }>(
      `SELECT id::text FROM settlement_reversals
       WHERE owner_id = $1 AND original_settlement_id = $2`,
      [ownerId, settlement.id],
    );
    if (existingReversal.rows.length > 0) {
      throw new AlreadyReversedError("This settlement has already been reversed");
    }

    // 4. Check the obligation's month is open.
    const obligationRow = await client.query<{ current_month_key: string }>(
      `SELECT current_month_key FROM obligations WHERE owner_id = $1 AND id = $2`,
      [ownerId, settlement.obligation_id],
    );
    if (obligationRow.rows.length === 0) {
      throw new SettlementNotFoundError("Obligation not found for settlement");
    }
    await requireOpenMonth(client, ownerId, obligationRow.rows[0].current_month_key);

    // 5. Determine whether the account was refreshed after the settlement.
    let balanceWasAdjusted = false;
    let accountNewBalance: number | null = null;

    if (settlement.mode === "UPDATE_ACCOUNT" && settlement.account_id) {
      const refreshed = await accountRefreshedAfterSettlement(
        client,
        ownerId,
        settlement.account_id,
        settlement.recorded_at,
      );

      if (refreshed) {
        // The account was manually refreshed after the settlement. We must
        // NOT blindly credit the old movement. The caller must decide.
        if (input.adjustBalanceAfterRefresh === undefined) {
          throw new RefreshReconciliationRequiredError(
            "The account was manually refreshed after this payment. Choose whether to adjust the current balance for this reversal.",
            settlement.id,
            true,
          );
        }
        if (input.adjustBalanceAfterRefresh) {
          // Caller explicitly wants the balance adjusted (credit back).
          const account = await lockAccount(client, ownerId, settlement.account_id);
          accountNewBalance =
            account.currentBalanceCents === null
              ? amount
              : account.currentBalanceCents + amount;
          await client.query(
            `UPDATE accounts
             SET current_balance_cents = $3, balance_as_of = now(),
                 version = version + 1, updated_at = now()
             WHERE owner_id = $1 AND id = $2`,
            [ownerId, account.id, accountNewBalance],
          );
          await client.query(
            `INSERT INTO account_movements
               (owner_id, account_id, direction, amount_cents, source_type,
                source_id, business_date)
             VALUES ($1, $2, 'credit', $3, 'settlement', $4, $5)`,
            [
              ownerId,
              account.id,
              amount,
              settlement.id,
              parseDate(input.businessDate),
            ],
          );
          balanceWasAdjusted = true;
        } else {
          // Caller explicitly chose NOT to adjust the balance. The reversal
          // row is recorded but no balance change or movement is created.
          balanceWasAdjusted = false;
        }
      } else {
        // The account was NOT refreshed after the settlement. Safe to
        // reverse the balance with a compensating credit movement.
        const account = await lockAccount(client, ownerId, settlement.account_id);
        accountNewBalance =
          account.currentBalanceCents === null
            ? amount
            : account.currentBalanceCents + amount;
        await client.query(
          `UPDATE accounts
           SET current_balance_cents = $3, balance_as_of = now(),
               version = version + 1, updated_at = now()
           WHERE owner_id = $1 AND id = $2`,
          [ownerId, account.id, accountNewBalance],
        );
        await client.query(
          `INSERT INTO account_movements
             (owner_id, account_id, direction, amount_cents, source_type,
              source_id, business_date)
           VALUES ($1, $2, 'credit', $3, 'settlement', $4, $5)`,
          [
            ownerId,
            account.id,
            amount,
            settlement.id,
            parseDate(input.businessDate),
          ],
        );
        balanceWasAdjusted = true;
      }
    }

    // 6. Insert the immutable reversal row.
    let reversalId: string;
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO settlement_reversals
           (owner_id, original_settlement_id, reason, business_date,
            idempotency_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id::text`,
        [
          ownerId,
          settlement.id,
          input.reason ?? null,
          parseDate(input.businessDate),
          input.idempotencyKey,
        ],
      );
      reversalId = inserted.rows[0].id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Could be a double-reversal race or an idempotency-key collision.
        const dupReversal = await client.query<{ id: string }>(
          `SELECT id::text FROM settlement_reversals
           WHERE owner_id = $1 AND original_settlement_id = $2`,
          [ownerId, settlement.id],
        );
        if (dupReversal.rows.length > 0) {
          throw new AlreadyReversedError("This settlement has already been reversed");
        }
        throw new IdempotencyConflictError(
          "A reversal with this idempotency key already exists with different parameters",
        );
      }
      throw error;
    }

    // 7. Write audit log.
    await client.query(
      `INSERT INTO audit_log (owner_id, operation_type, entity_type, entity_id, summary)
       VALUES ($1, 'settlement_reverse', 'settlement_reversal', $2, $3)`,
      [ownerId, reversalId, `Settlement reversed`],
    );

    // 8. Record the operation for idempotency.
    await recordOperation(
      client,
      ownerId,
      input.idempotencyKey,
      hash,
      "reverse_settlement",
    );

    return {
      reversalId,
      originalSettlementId: settlement.id,
      obligationId: settlement.obligation_id,
      amountCents: amount,
      businessDate: input.businessDate,
      accountNewBalance,
      balanceWasAdjusted,
    };
  });
}

/** Reconstruct a ReverseSettlementResult from the DB for an idempotent replay. */
async function replaySettlementReversal(
  client: PoolClient,
  ownerId: OwnerId,
  idempotencyKey: string,
): Promise<ReverseSettlementResult> {
  const result = await client.query<{
    id: string;
    original_settlement_id: string;
    business_date: Date;
  }>(
    `SELECT id::text, original_settlement_id::text, business_date
     FROM settlement_reversals
     WHERE owner_id = $1 AND idempotency_key = $2`,
    [ownerId, idempotencyKey],
  );
  if (result.rows.length === 0) {
    throw new IdempotencyConflictError(
      "Idempotency key recorded but no settlement reversal found",
    );
  }
  const row = result.rows[0];
  const settlement = await client.query<{
    obligation_id: string;
    amount_cents: string;
    account_id: string | null;
  }>(
    `SELECT obligation_id::text, amount_cents::text, account_id::text
     FROM settlements WHERE owner_id = $1 AND id = $2`,
    [ownerId, row.original_settlement_id],
  );
  const s = settlement.rows[0];
  let accountNewBalance: number | null = null;
  if (s.account_id) {
    const acct = await client.query<{ bal: string | null }>(
      `SELECT current_balance_cents::text AS bal FROM accounts WHERE owner_id = $1 AND id = $2`,
      [ownerId, s.account_id],
    );
    accountNewBalance = bigToInt(acct.rows[0]?.bal ?? null);
  }
  return {
    reversalId: row.id,
    originalSettlementId: row.original_settlement_id,
    obligationId: s.obligation_id,
    amountCents: bigToInt(s.amount_cents) ?? 0,
    businessDate: formatDate(row.business_date),
    accountNewBalance,
    balanceWasAdjusted: false,
  };
}

// --- Reversal: receipt ---

/**
 * Check whether the account was manually refreshed after a receipt was
 * recorded.
 */
async function accountRefreshedAfterReceipt(
  client: PoolClient,
  ownerId: OwnerId,
  accountId: string,
  receiptRecordedAt: Date,
): Promise<boolean> {
  const result = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n
     FROM balance_adjustments
     WHERE owner_id = $1 AND account_id = $2
       AND recorded_at > $3`,
    [ownerId, accountId, receiptRecordedAt],
  );
  return (bigToInt(result.rows[0]?.n) ?? 0) > 0;
}

/**
 * Reverse an income receipt. Mirrors reverseSettlement but debits the
 * account (compensating for the original credit).
 */
export async function reverseReceipt(
  ownerId: OwnerId,
  rawInput: ReverseReceiptInput,
): Promise<ReverseReceiptResult> {
  const input = validateReverseReceiptInput(rawInput);
  const hash = payloadHash(
    JSON.stringify({
      operation: "reverse_receipt",
      receiptId: input.receiptId,
      businessDate: input.businessDate,
      reason: input.reason ?? null,
      adjustBalanceAfterRefresh: input.adjustBalanceAfterRefresh ?? null,
    }),
  );

  return withTransaction(async (client) => {
    // 1. Idempotency check.
    const idem = await checkIdempotency(
      client,
      ownerId,
      input.idempotencyKey,
      hash,
      "reverse_receipt",
    );
    if (idem.status === "replay") {
      return await replayReceiptReversal(client, ownerId, input.idempotencyKey);
    }

    // 2. Lock the original receipt row.
    const receiptResult = await client.query<ReceiptRow>(
      `SELECT id, income_expectation_id::text, amount_cents::text, mode,
              account_id::text, business_date, recorded_at, idempotency_key
       FROM income_receipts
       WHERE owner_id = $1 AND id = $2
       FOR UPDATE`,
      [ownerId, input.receiptId],
    );
    if (receiptResult.rows.length === 0) {
      throw new SettlementNotFoundError("Receipt not found");
    }
    const receipt = receiptResult.rows[0];
    const amount = bigToInt(receipt.amount_cents) ?? 0;

    // 3. Guard double reversal.
    const existingReversal = await client.query<{ id: string }>(
      `SELECT id::text FROM income_receipt_reversals
       WHERE owner_id = $1 AND original_receipt_id = $2`,
      [ownerId, receipt.id],
    );
    if (existingReversal.rows.length > 0) {
      throw new AlreadyReversedError("This receipt has already been reversed");
    }

    // 4. Check the income's month is open.
    const incomeRow = await client.query<{ month_key: string }>(
      `SELECT month_key FROM income_expectations WHERE owner_id = $1 AND id = $2`,
      [ownerId, receipt.income_expectation_id],
    );
    if (incomeRow.rows.length === 0) {
      throw new SettlementNotFoundError("Income expectation not found for receipt");
    }
    await requireOpenMonth(client, ownerId, incomeRow.rows[0].month_key);

    // 5. Determine whether the account was refreshed after the receipt.
    let balanceWasAdjusted = false;
    let accountNewBalance: number | null = null;

    if (receipt.mode === "UPDATE_ACCOUNT" && receipt.account_id) {
      const refreshed = await accountRefreshedAfterReceipt(
        client,
        ownerId,
        receipt.account_id,
        receipt.recorded_at,
      );

      if (refreshed) {
        if (input.adjustBalanceAfterRefresh === undefined) {
          throw new RefreshReconciliationRequiredError(
            "The account was manually refreshed after this receipt. Choose whether to adjust the current balance for this reversal.",
            receipt.id,
            true,
          );
        }
        if (input.adjustBalanceAfterRefresh) {
          // Compensating debit (undo the original credit).
          const account = await lockAccount(client, ownerId, receipt.account_id);
          accountNewBalance =
            account.currentBalanceCents === null
              ? -amount
              : account.currentBalanceCents - amount;
          await client.query(
            `UPDATE accounts
             SET current_balance_cents = $3, balance_as_of = now(),
                 version = version + 1, updated_at = now()
             WHERE owner_id = $1 AND id = $2`,
            [ownerId, account.id, accountNewBalance],
          );
          await client.query(
            `INSERT INTO account_movements
               (owner_id, account_id, direction, amount_cents, source_type,
                source_id, business_date)
             VALUES ($1, $2, 'debit', $3, 'receipt', $4, $5)`,
            [
              ownerId,
              account.id,
              amount,
              receipt.id,
              parseDate(input.businessDate),
            ],
          );
          balanceWasAdjusted = true;
        } else {
          balanceWasAdjusted = false;
        }
      } else {
        // Not refreshed: safe to reverse with a compensating debit.
        const account = await lockAccount(client, ownerId, receipt.account_id);
        accountNewBalance =
          account.currentBalanceCents === null
            ? -amount
            : account.currentBalanceCents - amount;
        await client.query(
          `UPDATE accounts
           SET current_balance_cents = $3, balance_as_of = now(),
               version = version + 1, updated_at = now()
           WHERE owner_id = $1 AND id = $2`,
          [ownerId, account.id, accountNewBalance],
        );
        await client.query(
          `INSERT INTO account_movements
             (owner_id, account_id, direction, amount_cents, source_type,
              source_id, business_date)
           VALUES ($1, $2, 'debit', $3, 'receipt', $4, $5)`,
          [
            ownerId,
            account.id,
            amount,
            receipt.id,
            parseDate(input.businessDate),
          ],
        );
        balanceWasAdjusted = true;
      }
    }

    // 6. Insert the immutable reversal row.
    let reversalId: string;
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO income_receipt_reversals
           (owner_id, original_receipt_id, reason, business_date,
            idempotency_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id::text`,
        [
          ownerId,
          receipt.id,
          input.reason ?? null,
          parseDate(input.businessDate),
          input.idempotencyKey,
        ],
      );
      reversalId = inserted.rows[0].id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const dupReversal = await client.query<{ id: string }>(
          `SELECT id::text FROM income_receipt_reversals
           WHERE owner_id = $1 AND original_receipt_id = $2`,
          [ownerId, receipt.id],
        );
        if (dupReversal.rows.length > 0) {
          throw new AlreadyReversedError("This receipt has already been reversed");
        }
        throw new IdempotencyConflictError(
          "A reversal with this idempotency key already exists with different parameters",
        );
      }
      throw error;
    }

    // 7. Write audit log.
    await client.query(
      `INSERT INTO audit_log (owner_id, operation_type, entity_type, entity_id, summary)
       VALUES ($1, 'receipt_reverse', 'receipt_reversal', $2, $3)`,
      [ownerId, reversalId, `Receipt reversed`],
    );

    // 8. Record the operation for idempotency.
    await recordOperation(
      client,
      ownerId,
      input.idempotencyKey,
      hash,
      "reverse_receipt",
    );

    return {
      reversalId,
      originalReceiptId: receipt.id,
      incomeExpectationId: receipt.income_expectation_id,
      amountCents: amount,
      businessDate: input.businessDate,
      accountNewBalance,
      balanceWasAdjusted,
    };
  });
}

/** Reconstruct a ReverseReceiptResult from the DB for an idempotent replay. */
async function replayReceiptReversal(
  client: PoolClient,
  ownerId: OwnerId,
  idempotencyKey: string,
): Promise<ReverseReceiptResult> {
  const result = await client.query<{
    id: string;
    original_receipt_id: string;
    business_date: Date;
  }>(
    `SELECT id::text, original_receipt_id::text, business_date
     FROM income_receipt_reversals
     WHERE owner_id = $1 AND idempotency_key = $2`,
    [ownerId, idempotencyKey],
  );
  if (result.rows.length === 0) {
    throw new IdempotencyConflictError(
      "Idempotency key recorded but no receipt reversal found",
    );
  }
  const row = result.rows[0];
  const receipt = await client.query<{
    income_expectation_id: string;
    amount_cents: string;
    account_id: string | null;
  }>(
    `SELECT income_expectation_id::text, amount_cents::text, account_id::text
     FROM income_receipts WHERE owner_id = $1 AND id = $2`,
    [ownerId, row.original_receipt_id],
  );
  const r = receipt.rows[0];
  let accountNewBalance: number | null = null;
  if (r.account_id) {
    const acct = await client.query<{ bal: string | null }>(
      `SELECT current_balance_cents::text AS bal FROM accounts WHERE owner_id = $1 AND id = $2`,
      [ownerId, r.account_id],
    );
    accountNewBalance = bigToInt(acct.rows[0]?.bal ?? null);
  }
  return {
    reversalId: row.id,
    originalReceiptId: row.original_receipt_id,
    incomeExpectationId: r.income_expectation_id,
    amountCents: bigToInt(r.amount_cents) ?? 0,
    businessDate: formatDate(row.business_date),
    accountNewBalance,
    balanceWasAdjusted: false,
  };
}

// --- Read helpers ---

/** Fetch a single settlement by ID (owner-scoped). */
export async function getSettlement(
  ownerId: OwnerId,
  settlementId: string,
): Promise<Settlement> {
  const result = await query<SettlementRow>(
    `SELECT id, obligation_id::text, amount_cents::text, mode,
            account_id::text, business_date, recorded_at, idempotency_key
     FROM settlements
     WHERE owner_id = $1 AND id = $2`,
    [ownerId, settlementId],
  );
  if (result.rows.length === 0) {
    throw new SettlementNotFoundError("Settlement not found");
  }
  const row = result.rows[0];
  const reversal = await query<{ id: string }>(
    `SELECT id::text FROM settlement_reversals
     WHERE owner_id = $1 AND original_settlement_id = $2`,
    [ownerId, row.id],
  );
  return {
    id: row.id,
    ownerId,
    obligationId: row.obligation_id,
    amountCents: bigToInt(row.amount_cents) ?? 0,
    mode: row.mode as SettlementMode,
    accountId: row.account_id,
    businessDate: formatDate(row.business_date),
    recordedAt: row.recorded_at.toISOString(),
    idempotencyKey: row.idempotency_key,
    reversed: reversal.rows.length > 0,
  };
}

/** Fetch a single receipt by ID (owner-scoped). */
export async function getReceipt(
  ownerId: OwnerId,
  receiptId: string,
): Promise<Receipt> {
  const result = await query<ReceiptRow>(
    `SELECT id, income_expectation_id::text, amount_cents::text, mode,
            account_id::text, business_date, recorded_at, idempotency_key
     FROM income_receipts
     WHERE owner_id = $1 AND id = $2`,
    [ownerId, receiptId],
  );
  if (result.rows.length === 0) {
    throw new SettlementNotFoundError("Receipt not found");
  }
  const row = result.rows[0];
  const reversal = await query<{ id: string }>(
    `SELECT id::text FROM income_receipt_reversals
     WHERE owner_id = $1 AND original_receipt_id = $2`,
    [ownerId, row.id],
  );
  return {
    id: row.id,
    ownerId,
    incomeExpectationId: row.income_expectation_id,
    amountCents: bigToInt(row.amount_cents) ?? 0,
    mode: row.mode as SettlementMode,
    accountId: row.account_id,
    businessDate: formatDate(row.business_date),
    recordedAt: row.recorded_at.toISOString(),
    idempotencyKey: row.idempotency_key,
    reversed: reversal.rows.length > 0,
  };
}