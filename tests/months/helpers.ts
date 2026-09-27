// Step08 months/templates/generation DB integration test helpers.
//
// All tests run against DISPOSABLE, uniquely-named step08_* schemas on the
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

export type MonthsTestContext = {
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

function makeMonthsPool(directUrl: string, schema: string): Pool {
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
        `Months test schema "${schema}" does not exist on the database; refusing to inject pool (no public fallback)`,
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
          `Months test pool startup search_path mismatch: expected "${schema}", got "${r.rows[0]?.cs}"`,
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
        [`a@step08.test.local`, `argon2id$placeholder`],
      );
      const bResult = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
        [`b@step08.test.local`, `argon2id$placeholder`],
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
  const email = `step08-unique-${counter}-${Date.now()}@test.local`;
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

export async function setupMonthsSchema(): Promise<MonthsTestContext> {
  const url = requireDatabaseUrl();
  const schema = uniqueSchemaName("step08");
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
  const pool = makeMonthsPool(directUrl, schema);
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

export async function teardownMonthsSchema(ctx: MonthsTestContext): Promise<void> {
  await closePool();
  const url = requireDatabaseUrl();
  const adminPool = makePool(url);
  try {
    await dropDisposableSchema(adminPool, ctx.schema);
  } finally {
    await adminPool.end();
  }
}

// Count obligations for an owner in a specific month.
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

// Count income expectations for an owner in a specific month.
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

// Read an obligation directly from the DB to verify stored state.
export async function readObligationDirect(
  pool: Pool,
  ownerId: string,
  obligationId: string,
): Promise<{
  title: string;
  plannedCents: number;
  originTemplateId: string | null;
  originalMonthKey: string;
  currentMonthKey: string;
  kind: string;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      title: string;
      planned_cents: string;
      origin_template_id: string | null;
      original_month_key: string;
      current_month_key: string;
      kind: string;
    }>(
      `SELECT title, planned_cents, origin_template_id::text, original_month_key,
              current_month_key, kind
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
      originTemplateId: row.origin_template_id,
      originalMonthKey: row.original_month_key,
      currentMonthKey: row.current_month_key,
      kind: row.kind,
    };
  } finally {
    client.release();
  }
}

// Read an income expectation directly from the DB.
export async function readIncomeDirect(
  pool: Pool,
  ownerId: string,
  incomeId: string,
): Promise<{
  sourceName: string;
  expectedCents: number;
  originTemplateId: string | null;
  monthKey: string;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      source_name: string;
      expected_cents: string;
      origin_template_id: string | null;
      month_key: string;
    }>(
      `SELECT source_name, expected_cents, origin_template_id::text, month_key
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
      originTemplateId: row.origin_template_id,
      monthKey: row.month_key,
    };
  } finally {
    client.release();
  }
}

// Count all plans for an owner.
export async function countPlans(
  pool: Pool,
  ownerId: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM monthly_plans WHERE owner_id = $1`,
      [ownerId],
    );
    return Number.parseInt(result.rows[0]?.n ?? "0", 10);
  } finally {
    client.release();
  }
}

// Read a plan's savings target directly from the DB.
export async function readPlanTargetDirect(
  pool: Pool,
  ownerId: string,
  planId: string,
): Promise<{ savingsTargetCents: number; status: string }> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      savings_target_cents: string;
      status: string;
    }>(
      `SELECT savings_target_cents, status FROM monthly_plans
       WHERE owner_id = $1 AND id = $2`,
      [ownerId, planId],
    );
    if (result.rows.length === 0) {
      throw new Error("Plan not found in direct read");
    }
    return {
      savingsTargetCents: Number.parseInt(result.rows[0].savings_target_cents, 10),
      status: result.rows[0].status,
    };
  } finally {
    client.release();
  }
}