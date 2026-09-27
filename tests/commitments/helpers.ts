// Step12 reserved commitments DB integration test helpers.
//
// All tests run against DISPOSABLE, uniquely-named step12_* schemas on the
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

export type CommitmentsTestContext = {
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

function makeCommitmentsPool(directUrl: string, schema: string): Pool {
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
        `Commitments test schema "${schema}" does not exist on the database; refusing to inject pool (no public fallback)`,
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
          `Commitments test pool startup search_path mismatch: expected "${schema}", got "${r.rows[0]?.cs}"`,
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
        [`a@step12.test.local`, `argon2id$placeholder`],
      );
      const bResult = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
        [`b@step12.test.local`, `argon2id$placeholder`],
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

export async function setupCommitmentsSchema(): Promise<CommitmentsTestContext> {
  const url = requireDatabaseUrl();
  const schema = uniqueSchemaName("step12");
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
  const pool = makeCommitmentsPool(directUrl, schema);
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

export async function teardownCommitmentsSchema(ctx: CommitmentsTestContext): Promise<void> {
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
  kind: string;
  status: string;
  dueDate: string | null;
  linkedReserveId: string | null;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      title: string;
      planned_cents: string;
      kind: string;
      status: string;
      due_date: Date | null;
      linked_reserve_id: string | null;
    }>(
      `SELECT title, planned_cents::text, kind, status, due_date,
              linked_reserve_id::text
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
      kind: row.kind,
      status: row.status,
      dueDate: row.due_date
        ? `${row.due_date.getFullYear()}-${(row.due_date.getMonth() + 1).toString().padStart(2, "0")}-${row.due_date.getDate().toString().padStart(2, "0")}`
        : null,
      linkedReserveId: row.linked_reserve_id,
    };
  } finally {
    client.release();
  }
}

/** Count audit log entries for a given operation type and owner. */
export async function countAuditEntries(
  pool: Pool,
  ownerId: string,
  operationType: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
       WHERE owner_id = $1 AND operation_type = $2`,
      [ownerId, operationType],
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
        `test12-settle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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