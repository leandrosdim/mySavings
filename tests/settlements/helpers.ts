// Step10 settlements DB integration test helpers.
//
// All tests run against DISPOSABLE, uniquely-named step10_* schemas on the
// approved project test database — never against the public schema. The full
// migration chain (0001 + 0002 + 0003) is applied into each disposable schema
// via the real migration runner. Two synthetic users (A and B) are provisioned
// directly via SQL so cross-owner isolation can be tested.
//
// The test pool is built against the DIRECT (unpooled) endpoint with the
// disposable schema as a startup search_path option, then injected into
// lib/db via __setTestPool so production service code queries resolve to the
// disposable schema's tables without any production code change.
//
// No real data, no public schema writes. Each test file owns its own schema
// and tears it down in afterAll.

import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import {
  loadEnvFileForTests,
  requireDatabaseUrl,
  uniqueSchemaName,
  createDisposableSchema,
  dropDisposableSchema,
  makePool,
  validateSchemaName,
} from "../db/helpers";
import {
  closePool,
  __setTestPool,
} from "../../lib/db";

export { loadEnvFileForTests, requireDatabaseUrl, uniqueSchemaName };

loadEnvFileForTests();

const MIGRATIONS_DIR = resolve(process.cwd(), "db", "migrations");

const migrationsRunner = require("../../db/migrations.js") as {
  runMigrations: (opts: {
    migrationsDir?: string;
    schema?: string;
  }) => Promise<{ applied: number; skipped: number }>;
};

export type SettlementsTestContext = {
  schema: string;
  pool: Pool;
  userA: string;
  userB: string;
};

function directUrlFromPooled(pooledUrl: string): string {
  const u = new URL(pooledUrl);
  if (u.hostname.includes("-pooler.")) {
    u.hostname = u.hostname.replace("-pooler.", ".");
  }
  return u.toString();
}

function makeSettlementsPool(directUrl: string, schema: string): Pool {
  validateSchemaName(schema);
  const { buildSafeConnectionConfig } = require("../../db/db-config.cjs") as {
    buildSafeConnectionConfig: (
      url: string,
      key: string,
      options?: object,
    ) => {
      ssl: { rejectUnauthorized: boolean };
      connectionTimeoutMillis: number;
      statement_timeout: number;
      query_timeout: number;
      connectionString: string;
    };
  };
  const base = buildSafeConnectionConfig(directUrl, "DATABASE_URL", {
    connectionTimeoutMillis: 15_000,
    statement_timeout: 30_000,
    query_timeout: 30_000,
  });
  return new Pool({
    connectionString: base.connectionString,
    ssl: base.ssl,
    connectionTimeoutMillis: base.connectionTimeoutMillis,
    statement_timeout: base.statement_timeout,
    query_timeout: base.query_timeout,
    options: `-c search_path=${schema}`,
    max: 8,
  });
}

async function verifySchemaAndSearchPath(pool: Pool, schema: string): Promise<void> {
  const clients: PoolClient[] = [];
  try {
    const checkoutCount = 4;
    for (let i = 0; i < checkoutCount; i++) {
      clients.push(await pool.connect());
    }
    const exists = await clients[0].query<{ ok: number }>(
      `SELECT 1::int AS ok FROM pg_namespace WHERE nspname = $1`,
      [schema],
    );
    if ((exists.rows[0]?.ok ?? 0) !== 1) {
      throw new Error(
        `Settlements test schema "${schema}" does not exist on the database; refusing to inject pool (no public fallback)`,
      );
    }
    const checks = await Promise.all(
      clients.map((c) =>
        c.query<{ cs: string }>(`SELECT current_schema()::text AS cs`),
      ),
    );
    for (const r of checks) {
      if (r.rows[0]?.cs !== schema) {
        throw new Error(
          `Settlements test pool startup search_path mismatch: expected "${schema}", got "${r.rows[0]?.cs}"`,
        );
      }
    }
  } finally {
    for (const c of clients) {
      try {
        c.release();
      } catch {
        /* ignore */
      }
    }
  }
}

async function provisionTestUsers(pool: Pool): Promise<{ a: string; b: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const aResult = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
        [`a@step10.test.local`, `argon2id$placeholder`],
      );
      const bResult = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
        [`b@step10.test.local`, `argon2id$placeholder`],
      );
      await client.query("COMMIT");
      return { a: aResult.rows[0].id, b: bResult.rows[0].id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function setupSettlementsSchema(): Promise<SettlementsTestContext> {
  const url = requireDatabaseUrl();
  const schema = uniqueSchemaName("step10");
  const adminPool = makePool(url);
  try {
    await createDisposableSchema(adminPool, schema);
  } finally {
    await adminPool.end();
  }
  await migrationsRunner.runMigrations({
    migrationsDir: MIGRATIONS_DIR,
    schema,
  });
  const directUrl = directUrlFromPooled(url);
  const pool = makeSettlementsPool(directUrl, schema);
  try {
    await verifySchemaAndSearchPath(pool, schema);
  } catch (error) {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    throw error;
  }
  await closePool();
  __setTestPool(pool);
  const users = await provisionTestUsers(pool);
  return { schema, pool, userA: users.a, userB: users.b };
}

export async function teardownSettlementsSchema(ctx: SettlementsTestContext): Promise<void> {
  await closePool();
  const url = requireDatabaseUrl();
  const adminPool = makePool(url);
  try {
    await dropDisposableSchema(adminPool, ctx.schema);
  } finally {
    await adminPool.end();
  }
}

// --- Direct helpers ---

/** Create a plan directly via SQL for test setup. */
export async function createPlanDirect(
  pool: Pool,
  ownerId: string,
  monthKey: string,
): Promise<string> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO monthly_plans (owner_id, month_key, savings_target_cents)
       VALUES ($1, $2, 0) RETURNING id::text`,
      [ownerId, monthKey],
    );
    return result.rows[0].id;
  } finally {
    client.release();
  }
}

/** Close a plan directly via SQL for testing closed-month rejection. */
export async function closePlanDirect(
  pool: Pool,
  ownerId: string,
  monthKey: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE monthly_plans SET status = 'closed', closed_at = now()
       WHERE owner_id = $1 AND month_key = $2`,
      [ownerId, monthKey],
    );
  } finally {
    client.release();
  }
}

/** Read an obligation directly from the DB. */
export async function readObligationDirect(
  pool: Pool,
  ownerId: string,
  obligationId: string,
): Promise<{
  plannedCents: number;
  currentMonthKey: string;
  status: string;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      planned_cents: string;
      current_month_key: string;
      status: string;
    }>(
      `SELECT planned_cents::text, current_month_key, status
       FROM obligations WHERE owner_id = $1 AND id = $2`,
      [ownerId, obligationId],
    );
    if (result.rows.length === 0) {
      throw new Error("Obligation not found in direct read");
    }
    const row = result.rows[0];
    return {
      plannedCents: Number.parseInt(row.planned_cents, 10),
      currentMonthKey: row.current_month_key,
      status: row.status,
    };
  } finally {
    client.release();
  }
}

/** Read an income expectation directly from the DB. */
export async function readIncomeDirect(
  pool: Pool,
  ownerId: string,
  incomeId: string,
): Promise<{
  expectedCents: number;
  monthKey: string;
  status: string;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      expected_cents: string;
      month_key: string;
      status: string;
    }>(
      `SELECT expected_cents::text, month_key, status
       FROM income_expectations WHERE owner_id = $1 AND id = $2`,
      [ownerId, incomeId],
    );
    if (result.rows.length === 0) {
      throw new Error("Income expectation not found in direct read");
    }
    const row = result.rows[0];
    return {
      expectedCents: Number.parseInt(row.expected_cents, 10),
      monthKey: row.month_key,
      status: row.status,
    };
  } finally {
    client.release();
  }
}

/** Read an account directly from the DB. */
export async function readAccountDirect(
  pool: Pool,
  ownerId: string,
  accountId: string,
): Promise<{
  currentBalanceCents: number | null;
  version: number;
  archived: boolean;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      current_balance_cents: string | null;
      version: string;
      archived: boolean;
    }>(
      `SELECT current_balance_cents::text, version::text, archived
       FROM accounts WHERE owner_id = $1 AND id = $2`,
      [ownerId, accountId],
    );
    if (result.rows.length === 0) {
      throw new Error("Account not found in direct read");
    }
    const row = result.rows[0];
    return {
      currentBalanceCents:
        row.current_balance_cents === null
          ? null
          : Number.parseInt(row.current_balance_cents, 10),
      version: Number.parseInt(row.version, 10),
      archived: row.archived,
    };
  } finally {
    client.release();
  }
}

/** Count settlements for an obligation. */
export async function countSettlements(
  pool: Pool,
  ownerId: string,
  obligationId: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM settlements
       WHERE owner_id = $1 AND obligation_id = $2`,
      [ownerId, obligationId],
    );
    return Number.parseInt(result.rows[0]?.n ?? "0", 10);
  } finally {
    client.release();
  }
}

/** Count account movements for an account. */
export async function countMovements(
  pool: Pool,
  ownerId: string,
  accountId: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM account_movements
       WHERE owner_id = $1 AND account_id = $2`,
      [ownerId, accountId],
    );
    return Number.parseInt(result.rows[0]?.n ?? "0", 10);
  } finally {
    client.release();
  }
}

/** Count settlement reversals for an owner. */
export async function countSettlementReversals(
  pool: Pool,
  ownerId: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM settlement_reversals WHERE owner_id = $1`,
      [ownerId],
    );
    return Number.parseInt(result.rows[0]?.n ?? "0", 10);
  } finally {
    client.release();
  }
}

/** Count receipt reversals for an owner. */
export async function countReceiptReversals(
  pool: Pool,
  ownerId: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM income_receipt_reversals WHERE owner_id = $1`,
      [ownerId],
    );
    return Number.parseInt(result.rows[0]?.n ?? "0", 10);
  } finally {
    client.release();
  }
}

/** Count audit log entries for an owner. */
export async function countAuditLogs(
  pool: Pool,
  ownerId: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE owner_id = $1`,
      [ownerId],
    );
    return Number.parseInt(result.rows[0]?.n ?? "0", 10);
  } finally {
    client.release();
  }
}

/** Read a settlement's recorded_at timestamp directly. */
export async function readSettlementRecordedAt(
  pool: Pool,
  ownerId: string,
  settlementId: string,
): Promise<Date> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ recorded_at: Date }>(
      `SELECT recorded_at FROM settlements WHERE owner_id = $1 AND id = $2`,
      [ownerId, settlementId],
    );
    if (result.rows.length === 0) {
      throw new Error("Settlement not found");
    }
    return result.rows[0].recorded_at;
  } finally {
    client.release();
  }
}

/** Insert a balance adjustment directly to simulate a manual refresh. */
export async function insertBalanceAdjustmentDirect(
  pool: Pool,
  ownerId: string,
  accountId: string,
  newBalance: number,
  asOf: Date,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const acct = await client.query<{ current_balance_cents: string | null; version: string }>(
        `SELECT current_balance_cents::text, version::text FROM accounts
         WHERE owner_id = $1 AND id = $2 FOR UPDATE`,
        [ownerId, accountId],
      );
      if (acct.rows.length === 0) {
        throw new Error("Account not found for direct adjustment");
      }
      const oldBalance =
        acct.rows[0].current_balance_cents === null
          ? null
          : Number.parseInt(acct.rows[0].current_balance_cents, 10);
      const version = Number.parseInt(acct.rows[0].version, 10);
      const difference = newBalance - (oldBalance ?? 0);
      await client.query(
        `UPDATE accounts
         SET current_balance_cents = $3, balance_as_of = $4,
             version = version + 1, updated_at = now()
         WHERE owner_id = $1 AND id = $2 AND version = $5`,
        [ownerId, accountId, newBalance, asOf, version],
      );
      await client.query(
        `INSERT INTO balance_adjustments
           (owner_id, account_id, old_balance_cents, new_balance_cents,
            difference_cents, as_of, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ownerId,
          accountId,
          oldBalance,
          newBalance,
          difference,
          asOf,
          `test-refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

/** Generate a unique idempotency key for tests. */
export function testIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}