import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  DatabaseConfigError,
  getPool,
  closePool,
  query,
  withTransaction,
} from "../../lib/db";
import {
  loadEnvFileForTests,
  requireDatabaseUrl,
  uniqueSchemaName,
  createDisposableSchema,
  dropDisposableSchema,
  makePool,
} from "./helpers";

loadEnvFileForTests();

const url = requireDatabaseUrl();
const externalPool = makePool(url);
const schema = uniqueSchemaName("step03_db_test");

beforeAll(async () => {
  await createDisposableSchema(externalPool, schema);
});

afterAll(async () => {
  await closePool();
  await dropDisposableSchema(externalPool, schema);
  await externalPool.end();
});

describe("lib/db missing config safe error", () => {
  it("throws DatabaseConfigError when DATABASE_URL is missing", () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => getPool()).toThrow(DatabaseConfigError);
      expect(() => getPool()).toThrow(/Missing required env DATABASE_URL/);
    } finally {
      if (saved !== undefined) {
        process.env.DATABASE_URL = saved;
      }
    }
  });

  it("throws DatabaseConfigError for a non-postgres URL", () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "https://example.com/path";
    try {
      expect(() => getPool()).toThrow(DatabaseConfigError);
      expect(() => getPool()).toThrow(/expected postgres protocol/);
    } finally {
      if (saved !== undefined) {
        process.env.DATABASE_URL = saved;
      }
    }
  });

  it("does not include the URL value in the error message", () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://marker_secret_value@";
    try {
      let caught: unknown;
      try {
        getPool();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DatabaseConfigError);
      const message = caught instanceof Error ? caught.message : String(caught);
      expect(message).not.toContain("marker_secret_value");
    } finally {
      if (saved !== undefined) {
        process.env.DATABASE_URL = saved;
      }
      closePool();
    }
  });
});

describe("lib/db connection boolean", () => {
  it("returns a reachable SELECT 1 result", async () => {
    const result = await query<{ ok: number }>("SELECT 1 AS ok");
    expect(result.rows[0]?.ok).toBe(1);
  });
});

describe("withTransaction commit and rollback", () => {
  it("commits work on success", async () => {
    const table = `step03_tx_commit_${schema.slice(-6)}`;
    await withTransaction(async (client) => {
      await client.query(`CREATE TABLE "${schema}"."${table}" (id INTEGER PRIMARY KEY)`);
      await client.query(`INSERT INTO "${schema}"."${table}" (id) VALUES ($1)`, [42]);
      return undefined;
    });

    const externalClient = await externalPool.connect();
    try {
      const result = await externalClient.query(
        `SELECT id FROM "${schema}"."${table}"`,
      );
      expect(result.rows.map((r) => r.id)).toEqual([42]);
    } finally {
      externalClient.release();
    }
  });

  it("rolls back work on error and releases the client", async () => {
    const table = `step03_tx_rollback_${schema.slice(-6)}`;
    await expect(
      withTransaction(async (client) => {
        await client.query(`CREATE TABLE "${schema}"."${table}" (id INTEGER PRIMARY KEY)`);
        await client.query(`INSERT INTO "${schema}"."${table}" (id) VALUES ($1)`, [1]);
        throw new Error("deliberate failure");
      }),
    ).rejects.toThrow("deliberate failure");

    const externalClient = await externalPool.connect();
    try {
      const result = await externalClient.query(
        `SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2`,
        [schema, table],
      );
      expect(result.rowCount).toBe(0);
    } finally {
      externalClient.release();
    }
  });

  it("does not share transaction state across pool.query calls", async () => {
    const table = `step03_tx_no_share_${schema.slice(-6)}`;
    const client = await (await import("../../lib/db")).getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE TABLE "${schema}"."${table}" (id INTEGER PRIMARY KEY)`);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const externalClient = await externalPool.connect();
    try {
      const result = await externalClient.query(
        `SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2`,
        [schema, table],
      );
      expect(result.rowCount).toBe(0);
    } finally {
      externalClient.release();
    }
  });
});

describe("db-check CLI does not leak raw error messages", () => {
  const SECRET = "secret_marker_host_user_999";

  it("publicErrorReason strips a secret from a DB error", () => {
    const error = new Error(`connection terminated at ${SECRET} password=abc`);
    const { publicErrorReason } = require("../../db/db-config.cjs") as {
      publicErrorReason: (e: unknown) => { code: string; reason: string };
    };
    const reason = publicErrorReason(error);
    expect(reason.reason).not.toContain(SECRET);
    expect(reason.code).toBe("DB_ERROR");
  });

  it("migration publicErrorReason strips SQL literal secrets", () => {
    const error = new Error(`syntax error at or near "${SECRET}"`);
    const { publicErrorReason } = require("../../db/migrations.js") as {
      publicErrorReason: (e: unknown) => { code: string; reason: string };
    };
    const reason = publicErrorReason(error);
    expect(reason.reason).not.toContain(SECRET);
  });
});