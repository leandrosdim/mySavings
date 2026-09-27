// Accounts DB integration test helpers.
//
// All accounts integration tests run against DISPOSABLE, uniquely-named
// step06_* schemas on the approved project test database — never against the
// public schema. The full migration chain (0001 + 0002 + 0003) is applied
// into each disposable schema via the real migration runner. Two synthetic
// users (A and B) are provisioned directly via SQL so cross-owner isolation
// can be tested.
//
// The test pool is built against the DIRECT (unpooled) endpoint with the
// disposable schema as a startup search_path option, then injected into
// lib/db via __setTestPool so the production account service code
// (lib/accounts/*) queries resolve to the disposable schema's tables without
// any production code change. This mirrors the tests/auth/helpers.ts pattern.
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
  withTransaction,
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

export type AccountsTestContext = {
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

function makeAccountsPool(directUrl: string, schema: string): Pool {
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
        `Accounts test schema "${schema}" does not exist on the database; refusing to inject pool (no public fallback)`,
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
          `Accounts test pool startup search_path mismatch: expected "${schema}", got "${r.rows[0]?.cs}"`,
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
        [`a@step06.test.local`, `argon2id$placeholder`],
      );
      const bResult = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
        [`b@step06.test.local`, `argon2id$placeholder`],
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

export async function setupAccountsSchema(): Promise<AccountsTestContext> {
  const url = requireDatabaseUrl();
  const schema = uniqueSchemaName("step06");
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
  const pool = makeAccountsPool(directUrl, schema);
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

export async function teardownAccountsSchema(ctx: AccountsTestContext): Promise<void> {
  await closePool();
  const url = requireDatabaseUrl();
  const adminPool = makePool(url);
  try {
    await dropDisposableSchema(adminPool, ctx.schema);
  } finally {
    await adminPool.end();
  }
}

// Helper: run work inside a transaction on a checked-out client from the
// test pool. Rolls back on error, commits on success.
export async function txn<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        client.release(true);
        throw error;
      }
      throw error;
    }
  } finally {
    client.release();
  }
}

// Insert a test account directly via SQL and return its id. Used for fixture
// setup that bypasses the service layer (e.g. to create accounts with
// specific version numbers for concurrency tests).
export async function insertAccountDirect(
  pool: Pool,
  ownerId: string,
  name: string,
  balance: number | null = null,
  extra: { archived?: boolean; version?: number; trackBalance?: boolean } = {},
): Promise<string> {
  return txn(pool, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO accounts (owner_id, name, current_balance_cents, archived, version, track_balance)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
      [
        ownerId,
        name,
        balance,
        extra.archived ?? false,
        extra.version ?? 1,
        extra.trackBalance ?? true,
      ],
    );
    return result.rows[0].id;
  });
}

// Read an account directly from the DB (bypassing the service layer) to
// verify the actual stored state.
export async function readAccountDirect(
  pool: Pool,
  ownerId: string,
  accountId: string,
): Promise<{
  currentBalanceCents: number | null;
  balanceAsOf: Date | null;
  version: number;
  archived: boolean;
  name: string;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      current_balance_cents: string | null;
      balance_as_of: Date | null;
      version: string;
      archived: boolean;
      name: string;
    }>(
      `SELECT current_balance_cents, balance_as_of, version, archived, name
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
      balanceAsOf: row.balance_as_of,
      version: Number.parseInt(row.version, 10),
      archived: row.archived,
      name: row.name,
    };
  } finally {
    client.release();
  }
}

// Count movements for an account directly from the DB.
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

// Count adjustments for an account directly from the DB.
export async function countAdjustments(
  pool: Pool,
  ownerId: string,
  accountId: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM balance_adjustments
       WHERE owner_id = $1 AND account_id = $2`,
      [ownerId, accountId],
    );
    return Number.parseInt(result.rows[0]?.n ?? "0", 10);
  } finally {
    client.release();
  }
}

// Sum all active (non-archived) account balances for an owner.
export async function sumActiveBalances(
  pool: Pool,
  ownerId: string,
): Promise<number | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ total: string | null }>(
      `SELECT sum(current_balance_cents)::text AS total
       FROM accounts
       WHERE owner_id = $1 AND archived = false AND current_balance_cents IS NOT NULL`,
      [ownerId],
    );
    if (result.rows[0]?.total === null) {
      return null;
    }
    return Number.parseInt(result.rows[0]?.total ?? "0", 10);
  } finally {
    client.release();
  }
}

// Generate a unique idempotency key for tests.
export function testIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}