// Step09 obligations/income DB integration test helpers.
//
// All tests run against DISPOSABLE, uniquely-named step09_* schemas on the
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

export type PlansTestContext = {
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

function makePlansPool(directUrl: string, schema: string): Pool {
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
        `Plans test schema "${schema}" does not exist on the database; refusing to inject pool (no public fallback)`,
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
          `Plans test pool startup search_path mismatch: expected "${schema}", got "${r.rows[0]?.cs}"`,
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
        [`a@step09.test.local`, `argon2id$placeholder`],
      );
      const bResult = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
        [`b@step09.test.local`, `argon2id$placeholder`],
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

let userCounter = 0;

/** Create a unique test user with a random email. Each test gets its own isolated user. */
export async function createUniqueTestUser(pool: Pool): Promise<string> {
  const counter = ++userCounter;
  const email = `step09-unique-${counter}-${Date.now()}@test.local`;
  const client = await pool.connect();
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
      [email, `argon2id$placeholder`],
    );
    return result.rows[0].id;
  } finally {
    client.release();
  }
}

export async function setupPlansSchema(): Promise<PlansTestContext> {
  const url = requireDatabaseUrl();
  const schema = uniqueSchemaName("step09");
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
  const pool = makePlansPool(directUrl, schema);
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

export async function teardownPlansSchema(ctx: PlansTestContext): Promise<void> {
  await closePool();
  const url = requireDatabaseUrl();
  const adminPool = makePool(url);
  try {
    await dropDisposableSchema(adminPool, ctx.schema);
  } finally {
    await adminPool.end();
  }
}

// --- Direct read helpers ---

/** Read an obligation directly from the DB to verify stored state. */
export async function readObligationDirect(
  pool: Pool,
  ownerId: string,
  obligationId: string,
): Promise<{
  title: string;
  plannedCents: number;
  originalMonthKey: string;
  currentMonthKey: string;
  kind: string;
  status: string;
  dueDate: string | null;
  linkedAccountId: string | null;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      title: string;
      planned_cents: string;
      original_month_key: string;
      current_month_key: string;
      kind: string;
      status: string;
      due_date: Date | null;
      linked_account_id: string | null;
    }>(
      `SELECT title, planned_cents, original_month_key, current_month_key,
              kind, status, due_date, linked_account_id::text
       FROM obligations WHERE owner_id = $1 AND id = $2`,
      [ownerId, obligationId],
    );
    if (result.rows.length === 0) {
      throw new Error("Obligation not found in direct read");
    }
    const row = result.rows[0];
    return {
      title: row.title,
      plannedCents: Number.parseInt(row.planned_cents, 10),
      originalMonthKey: row.original_month_key,
      currentMonthKey: row.current_month_key,
      kind: row.kind,
      status: row.status,
      dueDate: row.due_date
        ? `${row.due_date.getFullYear()}-${(row.due_date.getMonth() + 1).toString().padStart(2, "0")}-${row.due_date.getDate().toString().padStart(2, "0")}`
        : null,
      linkedAccountId: row.linked_account_id,
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
  sourceName: string;
  expectedCents: number;
  monthKey: string;
  status: string;
  linkedAccountId: string | null;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      source_name: string;
      expected_cents: string;
      month_key: string;
      status: string;
      linked_account_id: string | null;
    }>(
      `SELECT source_name, expected_cents, month_key, status,
              linked_account_id::text
       FROM income_expectations WHERE owner_id = $1 AND id = $2`,
      [ownerId, incomeId],
    );
    if (result.rows.length === 0) {
      throw new Error("Income expectation not found in direct read");
    }
    const row = result.rows[0];
    return {
      sourceName: row.source_name,
      expectedCents: Number.parseInt(row.expected_cents, 10),
      monthKey: row.month_key,
      status: row.status,
      linkedAccountId: row.linked_account_id,
    };
  } finally {
    client.release();
  }
}

/** Count obligations for an owner in a specific month. */
export async function countObligations(
  pool: Pool,
  ownerId: string,
  monthKey: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM obligations
       WHERE owner_id = $1 AND current_month_key = $2`,
      [ownerId, monthKey],
    );
    return Number.parseInt(result.rows[0]?.n ?? "0", 10);
  } finally {
    client.release();
  }
}

/** Count income expectations for an owner in a specific month. */
export async function countIncomeExpectations(
  pool: Pool,
  ownerId: string,
  monthKey: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM income_expectations
       WHERE owner_id = $1 AND month_key = $2`,
      [ownerId, monthKey],
    );
    return Number.parseInt(result.rows[0]?.n ?? "0", 10);
  } finally {
    client.release();
  }
}

/** Insert a settlement directly for testing paid/remaining derivation. */
export async function insertSettlementDirect(
  pool: Pool,
  ownerId: string,
  obligationId: string,
  amountCents: number,
  businessDate: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, business_date, idempotency_key)
       VALUES ($1, $2, $3, 'ALREADY_REFLECTED', $4, $5)`,
      [
        ownerId,
        obligationId,
        amountCents,
        businessDate,
        `test-settle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ],
    );
  } finally {
    client.release();
  }
}

/** Insert a settlement reversal directly for testing paid/remaining derivation. */
export async function insertSettlementReversalDirect(
  pool: Pool,
  ownerId: string,
  settlementId: string,
  businessDate: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO settlement_reversals (owner_id, original_settlement_id, business_date, idempotency_key)
       VALUES ($1, $2, $3, $4)`,
      [
        ownerId,
        settlementId,
        businessDate,
        `test-reverse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ],
    );
  } finally {
    client.release();
  }
}

/** Read a settlement id directly for testing reversals. */
export async function readSettlementIdDirect(
  pool: Pool,
  ownerId: string,
  obligationId: string,
): Promise<string | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ id: string }>(
      `SELECT id::text FROM settlements
       WHERE owner_id = $1 AND obligation_id = $2
       ORDER BY id ASC LIMIT 1`,
      [ownerId, obligationId],
    );
    return result.rows[0]?.id ?? null;
  } finally {
    client.release();
  }
}

/** Insert an income receipt directly for testing received/pending derivation. */
export async function insertReceiptDirect(
  pool: Pool,
  ownerId: string,
  incomeId: string,
  amountCents: number,
  businessDate: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO income_receipts (owner_id, income_expectation_id, amount_cents, mode, business_date, idempotency_key)
       VALUES ($1, $2, $3, 'ALREADY_REFLECTED', $4, $5)`,
      [
        ownerId,
        incomeId,
        amountCents,
        businessDate,
        `test-receipt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ],
    );
  } finally {
    client.release();
  }
}

/** Read a receipt id directly for testing reversals. */
export async function readReceiptIdDirect(
  pool: Pool,
  ownerId: string,
  incomeId: string,
): Promise<string | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ id: string }>(
      `SELECT id::text FROM income_receipts
       WHERE owner_id = $1 AND income_expectation_id = $2
       ORDER BY id ASC LIMIT 1`,
      [ownerId, incomeId],
    );
    return result.rows[0]?.id ?? null;
  } finally {
    client.release();
  }
}

/** Insert an income receipt reversal directly for testing received/pending derivation. */
export async function insertReceiptReversalDirect(
  pool: Pool,
  ownerId: string,
  receiptId: string,
  businessDate: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO income_receipt_reversals (owner_id, original_receipt_id, business_date, idempotency_key)
       VALUES ($1, $2, $3, $4)`,
      [
        ownerId,
        receiptId,
        businessDate,
        `test-rev-receipt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ],
    );
  } finally {
    client.release();
  }
}

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