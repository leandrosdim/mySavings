// Account service: owner-scoped account CRUD, balance refresh, and internal
// transfers.
//
// All functions take an ownerId derived from the verified server session.
// No function accepts arbitrary unvalidated owner input from clients. Every
// write uses withTransaction (explicit BEGIN/COMMIT/ROLLBACK on one
// checked-out client). Financial cents are exact integers bounded by
// lib/finance/money.
//
// Key invariants enforced here:
// - Balance refresh REPLACES (not adds) current_balance_cents, writes an
//   immutable balance_adjustments row, increments version, and requires the
//   caller's expectedVersion to match. A stale concurrent form matches zero
//   rows and returns a useful ConflictError.
// - Internal transfer locks both owned accounts in deterministic ascending
//   ID order, validates amount and source/destination inequality, and creates
//   equal/opposite movements atomically. Not income/expense.
// - Idempotency keys deduplicate retries: a retry with the same key and a
//   matching payload hash returns the original result; a retry with a changed
//   payload is rejected.
// - Archive is restricted to zero-balance (or never-set) accounts so funded
//   accounts cannot silently vanish.

import "server-only";
import { createHash } from "node:crypto";
import { withTransaction, query, type PoolClient } from "../db";
import {
  NotFoundError,
  ConflictError,
  ArchiveRestrictedError,
  IdempotencyConflictError,
  ValidationError,
  AccountServiceError,
  type Account,
  type OwnerId,
  type AccountId,
  type CreateAccountInput,
  type CreateAccountResult,
  type RenameAccountResult,
  type ArchiveAccountResult,
  type BalanceRefreshResult,
  type RefreshBalanceInput,
  type TransferInput,
  type TransferResult,
} from "./types";

export {
  NotFoundError,
  ConflictError,
  ArchiveRestrictedError,
  IdempotencyConflictError,
  ValidationError,
  AccountServiceError,
};
import {
  validateAccountName,
  validateAccountId,
  validateCreateAccountInput,
  validateRefreshBalanceInput,
  validateTransferInput,
  validatePositiveCents,
  validateBalanceCents,
  validateAsOfDate,
  validateExpectedVersion,
  validateIdempotencyKey,
  validateBusinessDate,
} from "./validation";

// --- Row types (raw DB shape, snake_case) ---

type AccountRow = {
  id: string;
  name: string;
  current_balance_cents: string | null;
  balance_as_of: Date | null;
  track_balance: boolean;
  archived: boolean;
  version: string;
  created_at: Date;
  updated_at: Date;
};

type AdjustmentRow = {
  id: string;
  old_balance_cents: string | null;
  new_balance_cents: string;
  difference_cents: string;
  as_of: Date;
};

type TransferRow = {
  id: string;
  from_account_id: string;
  to_account_id: string;
  amount_cents: string;
  business_date: Date;
};

// --- Helpers ---

/** Convert a BIGINT string from pg into a safe JS number. */
function bigToInt(value: string | number | null): number | null {
  if (value === null) return null;
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (!Number.isSafeInteger(n)) {
    throw new Error(`BIGINT value out of safe range: ${value}`);
  }
  return n;
}

/** Map a raw DB row to the Account type. */
function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    currentBalanceCents: bigToInt(row.current_balance_cents),
    balanceAsOf: row.balance_as_of ? row.balance_as_of.toISOString() : null,
    trackBalance: row.track_balance,
    archived: row.archived,
    version: bigToInt(row.version) ?? 1,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Compute a stable payload hash for idempotency. */
function payloadHash(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Parse a YYYY-MM-DD date string to a JS Date at noon UTC (avoids TZ edge). */
export function parseBusinessDate(dateStr: string): Date {
  const parts = dateStr.split("-");
  const y = Number.parseInt(parts[0], 10);
  const m = Number.parseInt(parts[1], 10);
  const d = Number.parseInt(parts[2], 10);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

// --- Idempotency ---

type IdempotencyRecord = {
  operationType: string;
  resultJson: string;
};

async function checkIdempotency(
  client: PoolClient,
  ownerId: OwnerId,
  operationKey: string,
  expectedPayloadHash: string,
  operationType: string,
): Promise<{ status: "new"; proceed: true } | { status: "replay"; record: IdempotencyRecord }> {
  const existing = await client.query<{ payload_hash: string; operation_type: string }>(
    `SELECT payload_hash, operation_type FROM operation_log
     WHERE owner_id = $1 AND operation_key = $2`,
    [ownerId, operationKey],
  );
  if (existing.rows.length === 0) {
    return { status: "new", proceed: true };
  }
  const row = existing.rows[0];
  if (row.payload_hash !== expectedPayloadHash || row.operation_type !== operationType) {
    throw new IdempotencyConflictError(
      "An operation with this key already exists with different parameters",
    );
  }
  return { status: "replay", record: { operationType: row.operation_type, resultJson: "" } };
}

async function recordOperation(
  client: PoolClient,
  ownerId: OwnerId,
  operationKey: string,
  payloadHashValue: string,
  operationType: string,
): Promise<void> {
  await client.query(
    `INSERT INTO operation_log (owner_id, operation_key, payload_hash, operation_type)
     VALUES ($1, $2, $3, $4)`,
    [ownerId, operationKey, payloadHashValue, operationType],
  );
}

// --- Account CRUD ---

/** Create a new owner-scoped account. */
export async function createAccount(
  ownerId: OwnerId,
  input: CreateAccountInput,
): Promise<CreateAccountResult> {
  const validated = validateCreateAccountInput(input);
  // When an initial balance is provided (including explicit zero), set
  // balance_as_of to now(). A null balance means never-entered and stays
  // null — distinct from explicit zero.
  const hasInitialBalance = validated.initialBalanceCents !== null;
  const result = await withTransaction(async (client) => {
    const row = await client.query<AccountRow>(
      `INSERT INTO accounts (owner_id, name, current_balance_cents, balance_as_of, track_balance)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, current_balance_cents, balance_as_of, track_balance,
                 archived, version, created_at, updated_at`,
      [
        ownerId,
        validated.name,
        validated.initialBalanceCents,
        hasInitialBalance ? new Date() : null,
        validated.trackBalance,
      ],
    );
    return mapAccount(row.rows[0]);
  });
  return { account: result };
}

/** List all non-archived accounts for the owner. */
export async function listAccounts(ownerId: OwnerId): Promise<Account[]> {
  const result = await query<AccountRow>(
    `SELECT id, name, current_balance_cents, balance_as_of, track_balance,
            archived, version, created_at, updated_at
     FROM accounts
     WHERE owner_id = $1 AND archived = false
     ORDER BY created_at ASC, id ASC`,
    [ownerId],
  );
  return result.rows.map(mapAccount);
}

/** List all accounts (including archived) for the owner. */
export async function listAllAccounts(ownerId: OwnerId): Promise<Account[]> {
  const result = await query<AccountRow>(
    `SELECT id, name, current_balance_cents, balance_as_of, track_balance,
            archived, version, created_at, updated_at
     FROM accounts
     WHERE owner_id = $1
     ORDER BY archived ASC, created_at ASC, id ASC`,
    [ownerId],
  );
  return result.rows.map(mapAccount);
}

/** Fetch a single owner-scoped account by ID. Throws NotFoundError if missing. */
export async function getAccount(ownerId: OwnerId, accountId: AccountId): Promise<Account> {
  const id = validateAccountId(accountId);
  const result = await query<AccountRow>(
    `SELECT id, name, current_balance_cents, balance_as_of, track_balance,
            archived, version, created_at, updated_at
     FROM accounts
     WHERE owner_id = $1 AND id = $2`,
    [ownerId, id],
  );
  if (result.rows.length === 0) {
    throw new NotFoundError("Account not found");
  }
  return mapAccount(result.rows[0]);
}

/** Rename an owner-scoped account. */
export async function renameAccount(
  ownerId: OwnerId,
  accountId: AccountId,
  newName: unknown,
): Promise<RenameAccountResult> {
  const id = validateAccountId(accountId);
  const name = validateAccountName(newName);
  const result = await withTransaction(async (client) => {
    const row = await client.query<AccountRow>(
      `UPDATE accounts
       SET name = $3, updated_at = now()
       WHERE owner_id = $1 AND id = $2 AND archived = false
       RETURNING id, name, current_balance_cents, balance_as_of, track_balance,
                 archived, version, created_at, updated_at`,
      [ownerId, id, name],
    );
    if (row.rows.length === 0) {
      const existing = await client.query<{ archived: boolean }>(
        `SELECT archived FROM accounts WHERE owner_id = $1 AND id = $2`,
        [ownerId, id],
      );
      if (existing.rows.length === 0) {
        throw new NotFoundError("Account not found");
      }
      throw new ValidationError("Cannot rename an archived account");
    }
    return mapAccount(row.rows[0]);
  });
  return { account: result };
}

/** Archive an account. Restricted to zero-balance or never-set accounts. */
export async function archiveAccount(
  ownerId: OwnerId,
  accountId: AccountId,
): Promise<ArchiveAccountResult> {
  const id = validateAccountId(accountId);
  const result = await withTransaction(async (client) => {
    // Lock the account row for the duration of the check + update.
    const lockResult = await client.query<AccountRow>(
      `SELECT id, name, current_balance_cents, balance_as_of, track_balance,
              archived, version, created_at, updated_at
       FROM accounts
       WHERE owner_id = $1 AND id = $2
       FOR UPDATE`,
      [ownerId, id],
    );
    if (lockResult.rows.length === 0) {
      throw new NotFoundError("Account not found");
    }
    const account = mapAccount(lockResult.rows[0]);
    if (account.archived) {
      return account;
    }
    // v1 archive restriction: only zero-balance or never-set accounts.
    if (
      account.currentBalanceCents !== null &&
      account.currentBalanceCents !== 0
    ) {
      throw new ArchiveRestrictedError(
        "Cannot archive an account with a non-zero balance; transfer or withdraw funds first",
      );
    }
    const row = await client.query<AccountRow>(
      `UPDATE accounts
       SET archived = true, updated_at = now()
       WHERE owner_id = $1 AND id = $2
       RETURNING id, name, current_balance_cents, balance_as_of, track_balance,
                 archived, version, created_at, updated_at`,
      [ownerId, id],
    );
    return mapAccount(row.rows[0]);
  });
  return { account: result };
}

// --- Balance refresh ---

/** Refresh (replace) an account's current balance with version-guarded audit. */
export async function refreshBalance(
  ownerId: OwnerId,
  input: RefreshBalanceInput,
): Promise<BalanceRefreshResult> {
  // Validate at the service boundary.
  const validated = validateRefreshBalanceInput(input);
  const hash = payloadHash(
    JSON.stringify({
      accountId: validated.accountId,
      newBalanceCents: validated.newBalanceCents,
      asOf: validated.asOf.toISOString(),
      expectedVersion: validated.expectedVersion,
    }),
  );

  return withTransaction(async (client) => {
    // Idempotency check first.
    const idemResult = await checkIdempotency(
      client,
      ownerId,
      validated.idempotencyKey,
      hash,
      "balance_refresh",
    );
    if (idemResult.status === "replay") {
      // Return the stored result. We need to fetch the adjustment row to
      // reconstruct the result.
      const adj = await client.query<AdjustmentRow>(
        `SELECT id, old_balance_cents, new_balance_cents, difference_cents, as_of
         FROM balance_adjustments
         WHERE owner_id = $1 AND idempotency_key = $2`,
        [ownerId, validated.idempotencyKey],
      );
      if (adj.rows.length === 0) {
        throw new IdempotencyConflictError(
          "Idempotency key recorded but no adjustment found",
        );
      }
      const a = adj.rows[0];
      const accountRow = await client.query<{ version: string }>(
        `SELECT version FROM accounts WHERE owner_id = $1 AND id = $2`,
        [ownerId, validated.accountId],
      );
      return {
        accountId: validated.accountId,
        previousBalanceCents: bigToInt(a.old_balance_cents),
        newBalanceCents: bigToInt(a.new_balance_cents) ?? 0,
        differenceCents: bigToInt(a.difference_cents) ?? 0,
        newVersion: bigToInt(accountRow.rows[0]?.version) ?? 1,
        asOf: a.as_of.toISOString(),
      };
    }

    // Lock the account row.
    const lockResult = await client.query<AccountRow>(
      `SELECT id, name, current_balance_cents, balance_as_of, track_balance,
              archived, version, created_at, updated_at
       FROM accounts
       WHERE owner_id = $1 AND id = $2
       FOR UPDATE`,
      [ownerId, validated.accountId],
    );
    if (lockResult.rows.length === 0) {
      throw new NotFoundError("Account not found");
    }
    const account = mapAccount(lockResult.rows[0]);
    if (account.archived) {
      throw new ValidationError("Cannot refresh balance on an archived account");
    }

    // Optimistic concurrency: expectedVersion must match.
    if (account.version !== validated.expectedVersion) {
      throw new ConflictError(
        "Account was modified by another request; please reload and try again",
        account.version,
      );
    }

    const oldBalance = account.currentBalanceCents;
    const newBalance = validated.newBalanceCents;
    const difference = newBalance - (oldBalance ?? 0);

    // Update the account balance and increment version.
    const updated = await client.query(
      `UPDATE accounts
       SET current_balance_cents = $3,
           balance_as_of = $4,
           version = version + 1,
           updated_at = now()
       WHERE owner_id = $1 AND id = $2 AND version = $5`,
      [ownerId, validated.accountId, newBalance, validated.asOf, validated.expectedVersion],
    );
    if (updated.rowCount === 0) {
      throw new ConflictError(
        "Account version changed during refresh; please reload and try again",
      );
    }

    // Write the immutable adjustment audit row.
    const adjRow = await client.query<AdjustmentRow>(
      `INSERT INTO balance_adjustments
         (owner_id, account_id, old_balance_cents, new_balance_cents,
          difference_cents, as_of, reason, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, old_balance_cents, new_balance_cents, difference_cents, as_of`,
      [
        ownerId,
        validated.accountId,
        oldBalance,
        newBalance,
        difference,
        validated.asOf,
        validated.reason ?? null,
        validated.idempotencyKey,
      ],
    );
    const adj = adjRow.rows[0];

    // Record the operation for idempotency.
    await recordOperation(client, ownerId, validated.idempotencyKey, hash, "balance_refresh");

    return {
      accountId: validated.accountId,
      previousBalanceCents: bigToInt(adj.old_balance_cents),
      newBalanceCents: bigToInt(adj.new_balance_cents) ?? 0,
      differenceCents: bigToInt(adj.difference_cents) ?? 0,
      newVersion: account.version + 1,
      asOf: adj.as_of.toISOString(),
    };
  });
}

// --- Internal transfer ---

/** Execute an internal transfer between two owned accounts atomically. */
export async function transferBetweenAccounts(
  ownerId: OwnerId,
  input: TransferInput,
): Promise<TransferResult> {
  // Validate at the service boundary (trusted layer).
  const validated = validateTransferInput(input);
  const hash = payloadHash(
    JSON.stringify({
      fromAccountId: validated.fromAccountId,
      toAccountId: validated.toAccountId,
      amountCents: validated.amountCents,
      businessDate: validated.businessDate,
    }),
  );

  return withTransaction(async (client) => {
    // Idempotency check.
    const idemResult = await checkIdempotency(
      client,
      ownerId,
      validated.idempotencyKey,
      hash,
      "internal_transfer",
    );
    if (idemResult.status === "replay") {
      const transferRow = await client.query<TransferRow>(
        `SELECT id, from_account_id, to_account_id, amount_cents, business_date
         FROM internal_transfers
         WHERE owner_id = $1 AND idempotency_key = $2`,
        [ownerId, validated.idempotencyKey],
      );
      if (transferRow.rows.length === 0) {
        throw new IdempotencyConflictError(
          "Idempotency key recorded but no transfer found",
        );
      }
      const t = transferRow.rows[0];
      const fromAccount = await client.query<{ current_balance_cents: string | null }>(
        `SELECT current_balance_cents FROM accounts WHERE owner_id = $1 AND id = $2`,
        [ownerId, validated.fromAccountId],
      );
      const toAccount = await client.query<{ current_balance_cents: string | null }>(
        `SELECT current_balance_cents FROM accounts WHERE owner_id = $1 AND id = $2`,
        [ownerId, validated.toAccountId],
      );
      return {
        transferId: t.id,
        fromAccountId: validated.fromAccountId,
        toAccountId: validated.toAccountId,
        amountCents: bigToInt(t.amount_cents) ?? 0,
        fromAccountNewBalance: bigToInt(fromAccount.rows[0]?.current_balance_cents ?? null),
        toAccountNewBalance: bigToInt(toAccount.rows[0]?.current_balance_cents ?? null),
        businessDate: validated.businessDate,
      };
    }

    // Lock both accounts in deterministic ascending ID order to prevent
    // deadlocks when two concurrent transfers lock the same pair in
    // opposite order.
    const fromId = BigInt(validated.fromAccountId);
    const toId = BigInt(validated.toAccountId);
    const lockOrder: { id: string; label: "from" | "to" }[] =
      fromId < toId
        ? [
            { id: validated.fromAccountId, label: "from" },
            { id: validated.toAccountId, label: "to" },
          ]
        : [
            { id: validated.toAccountId, label: "to" },
            { id: validated.fromAccountId, label: "from" },
          ];

    const lockedAccounts: Record<string, AccountRow> = {};
    for (const entry of lockOrder) {
      const result = await client.query<AccountRow>(
        `SELECT id, name, current_balance_cents, balance_as_of, track_balance,
                archived, version, created_at, updated_at
         FROM accounts
         WHERE owner_id = $1 AND id = $2
         FOR UPDATE`,
        [ownerId, entry.id],
      );
      if (result.rows.length === 0) {
        throw new NotFoundError("Account not found");
      }
      lockedAccounts[entry.label] = result.rows[0];
    }

    const fromAccount = mapAccount(lockedAccounts.from);
    const toAccount = mapAccount(lockedAccounts.to);

    if (fromAccount.archived || toAccount.archived) {
      throw new ValidationError("Cannot transfer from/to an archived account");
    }

    // Create the immutable transfer record.
    const transferRow = await client.query<TransferRow>(
      `INSERT INTO internal_transfers
         (owner_id, from_account_id, to_account_id, amount_cents,
          business_date, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, from_account_id, to_account_id, amount_cents, business_date`,
      [
        ownerId,
        validated.fromAccountId,
        validated.toAccountId,
        validated.amountCents,
        parseBusinessDate(validated.businessDate),
        validated.idempotencyKey,
      ],
    );
    const transfer = transferRow.rows[0];
    const transferIdStr = transfer.id;

    // Create the debit movement (from account decreases).
    const fromNewBalance =
      fromAccount.currentBalanceCents === null
        ? -validated.amountCents
        : fromAccount.currentBalanceCents - validated.amountCents;
    await client.query(
      `UPDATE accounts
       SET current_balance_cents = $3, balance_as_of = now(), version = version + 1,
           updated_at = now()
       WHERE owner_id = $1 AND id = $2`,
      [ownerId, validated.fromAccountId, fromNewBalance],
    );
    await client.query(
      `INSERT INTO account_movements
         (owner_id, account_id, direction, amount_cents, source_type, source_id,
          business_date)
       VALUES ($1, $2, 'debit', $3, 'transfer', $4, $5)`,
      [ownerId, validated.fromAccountId, validated.amountCents, transferIdStr, parseBusinessDate(validated.businessDate)],
    );

    // Create the credit movement (to account increases).
    const toNewBalance =
      toAccount.currentBalanceCents === null
        ? validated.amountCents
        : toAccount.currentBalanceCents + validated.amountCents;
    await client.query(
      `UPDATE accounts
       SET current_balance_cents = $3, balance_as_of = now(), version = version + 1,
           updated_at = now()
       WHERE owner_id = $1 AND id = $2`,
      [ownerId, validated.toAccountId, toNewBalance],
    );
    await client.query(
      `INSERT INTO account_movements
         (owner_id, account_id, direction, amount_cents, source_type, source_id,
          business_date)
       VALUES ($1, $2, 'credit', $3, 'transfer', $4, $5)`,
      [ownerId, validated.toAccountId, validated.amountCents, transferIdStr, parseBusinessDate(validated.businessDate)],
    );

    // Record the operation for idempotency.
    await recordOperation(client, ownerId, validated.idempotencyKey, hash, "internal_transfer");

    return {
      transferId: transferIdStr,
      fromAccountId: validated.fromAccountId,
      toAccountId: validated.toAccountId,
      amountCents: validated.amountCents,
      fromAccountNewBalance: fromNewBalance,
      toAccountNewBalance: toNewBalance,
      businessDate: validated.businessDate,
    };
  });
}

// --- Reconciliation state ---

/** Check whether an account has outstanding movements that may need reconciliation. */
export async function getReconciliationState(
  ownerId: OwnerId,
  accountId: AccountId,
): Promise<{ needsReconciliation: boolean; pendingMovementCount: number }> {
  const id = validateAccountId(accountId);
  const result = await query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM account_movements
     WHERE owner_id = $1 AND account_id = $2
       AND recorded_at > (
         SELECT COALESCE(MAX(as_of), 'epoch'::timestamptz)
         FROM balance_adjustments
         WHERE owner_id = $1 AND account_id = $2
       )`,
    [ownerId, id],
  );
  const count = bigToInt(result.rows[0]?.count) ?? 0;
  return {
    needsReconciliation: count > 0,
    pendingMovementCount: count,
  };
}