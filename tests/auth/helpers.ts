// Auth DB integration test helpers.
//
// All auth integration tests run against DISPOSABLE, uniquely-named step04_*
// schemas on the approved project test database — never against the public
// schema. The identity migration (db/migrations/0001 + 0002) is applied into
// each disposable schema via the real migration runner, and a test-only Pool
// with a per-connection `search_path` startup option is injected into lib/db
// so that the production auth code (lib/auth/*) queries resolve to the
// disposable schema's tables without any production code change.
//
// ROOT CAUSE NOTE: a previous version set search_path OUTSIDE the transaction
// on Neon's TRANSACTION (-pooler) endpoint by monkey-patching pool.connect /
// pool.query. The pooler routes each statement through a different backend, so
// a `SET search_path` issued outside a transaction is a backend-local setting
// that is LOST when that backend is recycled; subsequent statements may land
// on a different backend with the default search_path, causing
// relation-missing errors and isolation risk (statements resolving against the
// wrong schema).
//
// FIX: build the test Pool against the SAME approved direct (unpooled)
// endpoint (the pooler hostname with `-pooler.` removed) and pass the
// disposable schema as a libpq startup option via
// `options=-c search_path=<schema>`. pg's normal Pool honors startup options
// on every checkout, so no connect/query monkey-patching is needed. The
// schema's existence is verified and `current_schema()` is asserted to equal
// the own schema on multiple concurrent checkouts before the pool is injected.
//
// No public/global fixture writes. No public login_attempt cleanup. Each test
// file owns its own schema and tears it down in afterAll.

import { resolve } from "node:path";
import { Pool } from "pg";
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
  type PoolClient,
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

export type AuthTestContext = {
  schema: string;
  pool: Pool;
};

// Build a direct (unpooled) connection string from the approved DATABASE_URL.
// Neon's pooled endpoint hostname contains `-pooler.`; replacing it with `.`
// yields the direct endpoint, which honors session-level startup options
// (search_path) on every backend without loss. If the URL has no `-pooler.`,
// it is already direct and is returned unchanged. TLS verification is kept via
// buildSafeConnectionConfig (verifiedTLS).
function directUrlFromPooled(pooledUrl: string): string {
  const u = new URL(pooledUrl);
  if (u.hostname.includes("-pooler.")) {
    u.hostname = u.hostname.replace("-pooler.", ".");
  }
  return u.toString();
}

// Build a Pool whose every acquired connection carries a startup
// `search_path=<schema>` option. pg's Pool passes the `options` field through
// to the libpq startup packet, so every checkout starts with the disposable
// schema as its search_path — no monkey-patching of connect/query.
function makeAuthPool(directUrl: string, schema: string): Pool {
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
  const pool = new Pool({
    connectionString: base.connectionString,
    ssl: base.ssl,
    connectionTimeoutMillis: base.connectionTimeoutMillis,
    statement_timeout: base.statement_timeout,
    query_timeout: base.query_timeout,
    // libpq startup option applied to every connection in this pool. Quotes
    // around the schema value match the libpq `-c key=value` syntax.
    options: `-c search_path=${schema}`,
    max: 8,
  });
  return pool;
}

// Fail closed if the own schema does not exist, then assert that
// current_schema() equals the own schema on multiple concurrent checkouts.
// This catches startup-option loss (e.g. a misbuilt URL) before any test
// fixture runs. No public fallback: if the schema is missing we throw and
// never inject the pool.
async function verifySchemaAndSearchPath(
  pool: Pool,
  schema: string,
): Promise<void> {
  const clients: PoolClient[] = [];
  try {
    // Acquire several clients concurrently to exercise the pool's startup
    // option across distinct backends.
    const checkoutCount = 4;
    for (let i = 0; i < checkoutCount; i++) {
      clients.push(await pool.connect());
    }
    // First, confirm the schema exists on this DB. Fail closed if not.
    const exists = await clients[0].query<{ ok: number }>(
      `SELECT 1::int AS ok FROM pg_namespace WHERE nspname = $1`,
      [schema],
    );
    if ((exists.rows[0]?.ok ?? 0) !== 1) {
      throw new Error(
        `Auth test schema "${schema}" does not exist on the database; refusing to inject pool (no public fallback)`,
      );
    }
    // Assert current_schema() equals the own schema on every checkout.
    const checks = await Promise.all(
      clients.map((c) =>
        c.query<{ cs: string }>(`SELECT current_schema()::text AS cs`),
      ),
    );
    for (const r of checks) {
      if (r.rows[0]?.cs !== schema) {
        throw new Error(
          `Auth test pool startup search_path mismatch: expected "${schema}", got "${r.rows[0]?.cs}"`,
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

export async function setupAuthSchema(): Promise<AuthTestContext> {
  const url = requireDatabaseUrl();
  const schema = uniqueSchemaName("step04");
  // Create the schema using a plain administrative pool (no search_path
  // override) so we explicitly CREATE SCHEMA before running migrations.
  const adminPool = makePool(url);
  try {
    await createDisposableSchema(adminPool, schema);
  } finally {
    await adminPool.end();
  }
  // Apply the real identity migration into the disposable schema.
  await migrationsRunner.runMigrations({
    migrationsDir: MIGRATIONS_DIR,
    schema,
  });
  // Build the test pool against the DIRECT endpoint with the schema as a
  // startup search_path option, then verify before injecting.
  const directUrl = directUrlFromPooled(url);
  const pool = makeAuthPool(directUrl, schema);
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
  // Reset any previously-installed test pool from an earlier test file before
  // installing ours. closePool() ends the prior pool and clears the test flag.
  await closePool();
  __setTestPool(pool);
  return { schema, pool };
}

export async function teardownAuthSchema(ctx: AuthTestContext): Promise<void> {
  // First detach and close the injected test pool so no connections remain
  // holding objects in the disposable schema.
  await closePool();
  // Drop the disposable schema from a separate admin pool.
  const url = requireDatabaseUrl();
  const adminPool = makePool(url);
  try {
    await dropDisposableSchema(adminPool, ctx.schema);
  } finally {
    await adminPool.end();
  }
}

// Convenience: insert a test user directly via raw SQL and return its id.
// Uses a single explicit transaction (withTransaction) so the insert is one
// atomic client write — no pool.query auto-checkout ambiguity.
export async function insertTestUser(
  email: string,
  passwordHash: string,
): Promise<string> {
  return withTransaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
      [email, passwordHash],
    );
    return result.rows[0].id;
  });
}

// Wipe all sessions and login_attempts for a set of user ids / emails within
// the disposable schema. Used between tests to reset state without dropping
// the schema. Never touches the public schema. Uses a single explicit
// transaction (withTransaction) so both deletes are one atomic client write.
export async function resetAuthTables(
  userIds: string[],
  emails: string[],
): Promise<void> {
  await withTransaction(async (client) => {
    if (userIds.length > 0) {
      await client.query(
        `DELETE FROM sessions WHERE user_id = ANY($1::bigint[])`,
        [userIds],
      );
    }
    if (emails.length > 0) {
      await client.query(`DELETE FROM login_attempts WHERE email = ANY($1)`, [
        emails,
      ]);
    }
  });
}