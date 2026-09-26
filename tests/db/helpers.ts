import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const ENV_PATH = resolve(process.cwd(), ".env");

export const DB_TEST_ALLOW_WRITES_KEY = "DB_TEST_ALLOW_WRITES";

export function isDbTestAllowed(): boolean {
  return process.env[DB_TEST_ALLOW_WRITES_KEY] === "1";
}

export function loadEnvFileForTests(): void {
  let content: string;
  try {
    content = readFileSync(ENV_PATH, "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function requireDatabaseTestAccess(): void {
  if (!isDbTestAllowed()) {
    throw new Error(
      `Database integration tests require ${DB_TEST_ALLOW_WRITES_KEY}=1; refusing to connect without explicit opt-in`,
    );
  }
}

export function requireDatabaseUrl(): string {
  requireDatabaseTestAccess();
  loadEnvFileForTests();
  const value = process.env.DATABASE_URL;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("DATABASE_URL is required for DB integration tests");
  }
  return value;
}

export function uniqueSchemaName(prefix: string): string {
  const suffix = randomBytes(6).toString("hex");
  return `${prefix}_${suffix}`;
}

export function validateSchemaName(schema: string): void {
  if (typeof schema !== "string" || schema.length === 0) {
    throw new Error("Schema name must be a non-empty string");
  }
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error("Schema name must be a single lowercase identifier");
  }
  if (/[,"'\\;\s]/.test(schema)) {
    throw new Error("Schema name must not contain commas, quotes or whitespace");
  }
}

export async function createDisposableSchema(
  pool: Pool,
  schema: string,
): Promise<void> {
  validateSchemaName(schema);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query("COMMIT");
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

export async function dropDisposableSchema(
  pool: Pool,
  schema: string,
): Promise<void> {
  validateSchemaName(schema);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const identity = await client.query(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1",
        [schema],
      );
      if (identity.rowCount === null || identity.rowCount === 0) {
        await client.query("COMMIT");
        return;
      }
      if (!schema.startsWith("step03_test") && !schema.startsWith("step03_db_test") && !schema.startsWith("step04")) {
        await client.query("ROLLBACK");
        throw new Error(`Refusing to drop non-test schema: ${schema}`);
      }
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.query("COMMIT");
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

export async function schemaHasTable(
  pool: Pool,
  schema: string,
  table: string,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2`,
      [schema, table],
    );
    return result.rowCount !== null && result.rowCount > 0;
  } finally {
    client.release();
  }
}

export async function countLedgerRows(
  client: PoolClient,
  schema: string,
): Promise<number> {
  const result = await client.query(
    `SELECT count(*)::int AS n FROM "${schema}".schema_migrations`,
  );
  return result.rows[0]?.n ?? 0;
}

export async function withSearchPath<T>(
  client: PoolClient,
  schema: string,
  work: () => Promise<T>,
): Promise<T> {
  await client.query("SELECT set_config($1, $2, true)", ["search_path", schema]);
  return work();
}

export function makePool(url: string): Pool {
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
  const base = buildSafeConnectionConfig(url, "DATABASE_URL", {
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
    max: 5,
  });
}