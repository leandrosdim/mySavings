import "server-only";
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";
import {
  DbConfigError,
  buildAppPoolConfig,
  publicErrorReason,
} from "../db/db-config.cjs";

const DATABASE_URL_KEY = "DATABASE_URL";

export { DbConfigError, publicErrorReason };

export const DatabaseConfigError = DbConfigError;

const IDLE_POOL_ERROR_MESSAGE = "pg pool idle client error";

let cachedPool: Pool | null = null;

function readAppDatabaseUrl(): string {
  const raw = process.env[DATABASE_URL_KEY];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new DbConfigError(`Missing required env ${DATABASE_URL_KEY}`);
  }
  return raw;
}

export function buildPoolConfig(url: string): PoolConfig {
  return buildAppPoolConfig(url) as PoolConfig;
}

export function getPool(): Pool {
  const url = readAppDatabaseUrl();
  if (cachedPool === null) {
    const config = buildPoolConfig(url);
    const pool = new Pool(config);
    pool.on("error", (err) => {
      void err;
      console.error(IDLE_POOL_ERROR_MESSAGE);
    });
    cachedPool = pool;
  }
  return cachedPool;
}

export async function closePool(): Promise<void> {
  if (cachedPool !== null) {
    await cachedPool.end();
    cachedPool = null;
    testPoolInstalled = false;
  }
}

// Test-only pool injection. Production code MUST NEVER call this. Strictly
// guarded so it cannot silently swap the production pool at runtime: it throws
// in production builds, requires a real Pool instance, and records that a test
// pool is installed so closePool() can clear it. Kept here rather than in a
// separate test-only module so production code never imports a test-only file
// (which would itself be a production test-only bypass).
let testPoolInstalled = false;

export function __setTestPool(pool: Pool): void {
  if (process.env.NODE_ENV === "production" || process.env.NEXT_RUNTIME === "production") {
    throw new Error("__setTestPool must never be called in production");
  }
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__setTestPool is test-only; set NODE_ENV=test to use it");
  }
  if (pool === null || typeof pool !== "object") {
    throw new Error("__setTestPool requires a Pool instance");
  }
  if (cachedPool !== null && !testPoolInstalled) {
    throw new Error(
      "__setTestPool refuses to overwrite a non-test cached pool; call closePool() first",
    );
  }
  cachedPool = pool;
  testPoolInstalled = true;
}

export function __isTestPoolInstalled(): boolean {
  return testPoolInstalled;
}

type QueryParams = ReadonlyArray<unknown> | undefined;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: QueryParams,
): Promise<QueryResult<T>> {
  const pool = getPool();
  return pool.query<T>(text, params as unknown[]);
}

export type TransactionWork<T> = (client: PoolClient) => Promise<T>;

export async function withTransaction<T>(work: TransactionWork<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  let released = false;

  const destroy = (error: unknown): void => {
    if (released) return;
    released = true;
    const releaseArg: Error | true =
      error instanceof Error ? error : true;
    try {
      client.release(releaseArg);
    } catch {
      try {
        client.release(true);
      } catch {
        /* connection already broken; ignore */
      }
    }
  };

  const release = (): void => {
    if (released) return;
    released = true;
    client.release();
  };

  try {
    try {
      await client.query("BEGIN");
    } catch (error) {
      destroy(error);
      throw error;
    }
    let result: T;
    try {
      result = await work(client);
    } catch (workError) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        destroy(rollbackError);
        throw workError;
      }
      release();
      throw workError;
    }
    try {
      await client.query("COMMIT");
    } catch (commitError) {
      destroy(commitError);
      throw commitError;
    }
    release();
    return result;
  } finally {
    if (!released) {
      release();
    }
  }
}

export type { Pool, PoolClient, QueryResult, QueryResultRow };