// Step15 history + exports DB integration test helpers.
//
// All tests run against DISPOSABLE, uniquely-named step15_* schemas on the
// approved project test database — never against the public schema. The full
// migration chain (0001 + 0002 + 0003 + 0004) is applied into each disposable
// schema via the real migration runner. Two synthetic users (A and B) are
// provisioned directly via SQL so cross-owner isolation can be tested.

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

export type HistoryTestContext = {
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

function makeHistoryPool(directUrl: string, schema: string): Pool {
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
        `History test schema "${schema}" does not exist on the database; refusing to inject pool (no public fallback)`,
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
          `History test pool startup search_path mismatch: expected "${schema}", got "${r.rows[0]?.cs}"`,
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
        [`a@step15.test.local`, `argon2id$placeholder`],
      );
      const bResult = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
        [`b@step15.test.local`, `argon2id$placeholder`],
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

export async function setupHistorySchema(): Promise<HistoryTestContext> {
  const url = requireDatabaseUrl();
  const schema = uniqueSchemaName("step15");
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
  const pool = makeHistoryPool(directUrl, schema);
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

export async function teardownHistorySchema(ctx: HistoryTestContext): Promise<void> {
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

export async function createPlanDirect(
  pool: Pool,
  ownerId: string,
  monthKey: string,
  savingsTargetCents: number = 0,
): Promise<string> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO monthly_plans (owner_id, month_key, savings_target_cents)
       VALUES ($1, $2, $3) RETURNING id::text`,
      [ownerId, monthKey, savingsTargetCents],
    );
    return result.rows[0].id;
  } finally {
    client.release();
  }
}

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

export async function readSnapshotDirect(
  pool: Pool,
  ownerId: string,
  monthKey: string,
): Promise<{
  balancesTotalCents: number;
  savingsTargetCents: number;
  settlementTotalCents: number;
  closedAt: Date;
  provenance: unknown;
} | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      balances_total_cents: string;
      savings_target_cents: string;
      settlement_total_cents: string;
      closed_at: Date;
      provenance: unknown;
    }>(
      `SELECT balances_total_cents::text, savings_target_cents::text,
              settlement_total_cents::text, closed_at, provenance
       FROM closing_snapshots
       WHERE owner_id = $1 AND month_key = $2`,
      [ownerId, monthKey],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      balancesTotalCents: Number.parseInt(row.balances_total_cents, 10),
      savingsTargetCents: Number.parseInt(row.savings_target_cents, 10),
      settlementTotalCents: Number.parseInt(row.settlement_total_cents, 10),
      closedAt: row.closed_at,
      provenance: row.provenance,
    };
  } finally {
    client.release();
  }
}

export async function countSnapshots(
  pool: Pool,
  ownerId: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM closing_snapshots WHERE owner_id = $1`,
      [ownerId],
    );
    return Number.parseInt(result.rows[0]?.n ?? "0", 10);
  } finally {
    client.release();
  }
}

export async function countAuditLogs(
  pool: Pool,
  ownerId: string,
  operationType?: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    let result;
    if (operationType) {
      result = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log
         WHERE owner_id = $1 AND operation_type = $2`,
        [ownerId, operationType],
      );
    } else {
      result = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log WHERE owner_id = $1`,
        [ownerId],
      );
    }
    return Number.parseInt(result.rows[0]?.n ?? "0", 10);
  } finally {
    client.release();
  }
}

let userCounter = 0;
export async function createUniqueTestUser(pool: Pool): Promise<string> {
  const counter = ++userCounter;
  const email = `step15-unique-${counter}-${Date.now()}@test.local`;
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