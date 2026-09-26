import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadEnvFileForTests,
  requireDatabaseUrl,
  uniqueSchemaName,
  createDisposableSchema,
  dropDisposableSchema,
  schemaHasTable,
  makePool,
} from "./helpers";

loadEnvFileForTests();

const migrationsRunner = require("../../db/migrations.js") as {
  runMigrations: (opts?: { migrationsDir?: string; schema?: string }) => Promise<{
    applied: number;
    skipped: number;
  }>;
  MigrationError: new (message: string) => Error;
};

const SCHEMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

const url = requireDatabaseUrl();
const pool = makePool(url);

type TestContext = {
  tempDir: string;
  migrationsDir: string;
  schema: string;
};

async function setupTestCtx(): Promise<TestContext> {
  const tempDir = mkdtempSync(join(tmpdir(), "step03-mig-"));
  const migrationsDir = join(tempDir, "migrations");
  mkdirSync(migrationsDir, { recursive: true });
  const schema = uniqueSchemaName("step03_test");
  await createDisposableSchema(pool, schema);
  return { tempDir, migrationsDir, schema };
}

async function teardownTestCtx(ctx: TestContext): Promise<void> {
  await dropDisposableSchema(pool, ctx.schema);
  rmSync(ctx.tempDir, { recursive: true, force: true });
}

function writeMigration(ctx: TestContext, name: string, sql: string): void {
  writeFileSync(join(ctx.migrationsDir, name), sql, "utf8");
}

describe("migration runner idempotence", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestCtx();
  });

  afterEach(async () => {
    await teardownTestCtx(ctx);
  });

  it("applies migrations transactionally and skips on second run", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_test_table.sql",
      "CREATE TABLE step03_test_table (id INTEGER PRIMARY KEY);",
    );

    const first = await migrationsRunner.runMigrations({
      migrationsDir: ctx.migrationsDir,
      schema: ctx.schema,
    });
    expect(first.applied).toBe(2);
    expect(first.skipped).toBe(0);

    const tablePresent = await schemaHasTable(pool, ctx.schema, "step03_test_table");
    expect(tablePresent).toBe(true);

    const second = await migrationsRunner.runMigrations({
      migrationsDir: ctx.migrationsDir,
      schema: ctx.schema,
    });
    expect(second.applied).toBe(0);
    expect(second.skipped).toBe(2);
  });
});

describe("migration failure rollback", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestCtx();
  });

  afterEach(async () => {
    await teardownTestCtx(ctx);
  });

  it("leaves no schema changes or ledger row when a migration fails", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_good.sql",
      "CREATE TABLE step03_rollback_good (id INTEGER PRIMARY KEY);",
    );
    writeMigration(
      ctx,
      "0003_bad.sql",
      "CREATE TABLE step03_rollback_bad (id INTEGER PRIMARY KEY); SELECT * FROM does_not_exist;",
    );

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow();

    const badPresent = await schemaHasTable(pool, ctx.schema, "step03_rollback_bad");
    expect(badPresent).toBe(false);

    const client = await pool.connect();
    try {
      const tableExists = await client.query(
        `SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2`,
        [ctx.schema, "schema_migrations"],
      );
      if (tableExists.rowCount !== null && tableExists.rowCount > 0) {
        const result = await client.query(
          `SELECT version FROM "${ctx.schema}".schema_migrations WHERE version = $1`,
          ["0003_bad"],
        );
        expect(result.rowCount).toBe(0);
      }
      expect(badPresent).toBe(false);

      const goodPresent = await client.query(
        `SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2`,
        [ctx.schema, "step03_rollback_good"],
      );
      expect(goodPresent.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });
});

describe("migration checksum mismatch refusal", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestCtx();
  });

  afterEach(async () => {
    await teardownTestCtx(ctx);
  });

  it("stops when an applied migration file checksum changes", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_check.sql",
      "CREATE TABLE step03_checksum_a (id INTEGER PRIMARY KEY);",
    );

    const first = await migrationsRunner.runMigrations({
      migrationsDir: ctx.migrationsDir,
      schema: ctx.schema,
    });
    expect(first.applied).toBe(2);

    writeMigration(
      ctx,
      "0002_check.sql",
      "CREATE TABLE step03_checksum_a (id INTEGER PRIMARY KEY, name TEXT);",
    );

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/Checksum mismatch/);

    const client = await pool.connect();
    try {
      const cols = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'step03_checksum_a'
         ORDER BY column_name`,
        [ctx.schema],
      );
      const names = cols.rows.map((r) => r.column_name);
      expect(names).toEqual(["id"]);
    } finally {
      client.release();
    }
  });
});

describe("migration concurrency serialization", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestCtx();
  });

  afterEach(async () => {
    await teardownTestCtx(ctx);
  });

  it("serializes two concurrent runners through the advisory lock", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_concurrent.sql",
      "CREATE TABLE step03_concurrent (id INTEGER PRIMARY KEY);",
    );

    const [a, b] = await Promise.all([
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ]);

    const totalApplied = a.applied + b.applied;
    const totalSkipped = a.skipped + b.skipped;
    expect(totalApplied).toBe(2);
    expect(totalSkipped).toBe(2);

    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT count(*)::int AS n FROM "${ctx.schema}".schema_migrations WHERE version = $1`,
        ["0002_concurrent"],
      );
      expect(result.rows[0].n).toBe(1);
    } finally {
      client.release();
    }
  });
});

describe("non-transactional statement rejection", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestCtx();
  });

  afterEach(async () => {
    await teardownTestCtx(ctx);
  });

  it("rejects a migration containing VACUUM before applying", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(ctx, "0002_vacuum.sql", "VACUUM;");

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/non-transactional/);
  });
});

describe("top-level transaction control rejection", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestCtx();
  });

  afterEach(async () => {
    await teardownTestCtx(ctx);
  });

  it("rejects a migration containing a top-level COMMIT before applying", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(ctx, "0002_commit.sql", "CREATE TABLE step03_ctrl (id int); COMMIT;");

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/top-level|override/);
  });

  it("rejects a migration with COMMIT hidden behind a line comment", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(ctx, "0002_cmt.sql", "CREATE TABLE step03_ctrl (id int); -- comment\nCOMMIT;");

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/top-level|override/);
  });

  it("accepts a migration with a DO block containing BEGIN/END", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(ctx, "0002_do.sql", "DO $$ BEGIN PERFORM 1; END $$;");

    const result = await migrationsRunner.runMigrations({
      migrationsDir: ctx.migrationsDir,
      schema: ctx.schema,
    });
    expect(result.applied).toBe(2);
  });
});

describe("live isolated failure leaves no ledger/schema changes", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestCtx();
  });

  afterEach(async () => {
    await teardownTestCtx(ctx);
  });

  it("a COMMIT that escapes would be rejected; a failing migration leaves no schema or ledger row", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(ctx, "0002_good.sql", "CREATE TABLE step03_live_good (id int);");
    writeMigration(
      ctx,
      "0003_bad.sql",
      "CREATE TABLE step03_live_bad (id int); SELECT * FROM does_not_exist;",
    );

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const bad = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2",
          [ctx.schema, "step03_live_bad"],
        );
        expect(bad.rowCount).toBe(0);

        const good = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2",
          [ctx.schema, "step03_live_good"],
        );
        expect(good.rowCount).toBe(0);

        const migTable = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = 'schema_migrations'",
          [ctx.schema],
        );
        if (migTable.rowCount !== null && migTable.rowCount > 0) {
          const ledger = await client.query(
            `SELECT count(*)::int AS n FROM "${ctx.schema}".schema_migrations WHERE version LIKE '0003%'`,
          );
          expect(ledger.rows[0].n).toBe(0);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  });
});

describe("migration prevalidation", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestCtx();
  });

  afterEach(async () => {
    await teardownTestCtx(ctx);
  });

  it("rejects a newly introduced version earlier than max applied version", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(ctx, "0002_applied.sql", "CREATE TABLE step03_pv_a (id int);");
    writeMigration(ctx, "0003_applied.sql", "CREATE TABLE step03_pv_b (id int);");

    const first = await migrationsRunner.runMigrations({
      migrationsDir: ctx.migrationsDir,
      schema: ctx.schema,
    });
    expect(first.applied).toBe(3);

    writeMigration(ctx, "0000_retro.sql", "CREATE TABLE step03_pv_c (id int);");

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/out-of-order/);
  });

  it("rejects a missing applied migration file", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(ctx, "0002_applied.sql", "CREATE TABLE step03_missing (id int);");

    await migrationsRunner.runMigrations({
      migrationsDir: ctx.migrationsDir,
      schema: ctx.schema,
    });

    rmSync(join(ctx.migrationsDir, "0002_applied.sql"));

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/missing/);
  });

  it("rejects an invalid migration filename", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(ctx, "0002-kebab.sql", "CREATE TABLE step03_kebab (id int);");

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/Invalid migration filename|expected NNNN/);
  });
});

// ---------------------------------------------------------------------------
// S3-01 atomicity regression: a migration file that tries to COMMIT WORK its
// way out of the outer migration transaction MUST be rejected by the scanner
// before any of its SQL executes, so no table and no ledger row survives.
// This is the real failing sequence from docs/reviews/Step03.md:
//   CREATE TABLE escaped(id integer); COMMIT WORK; SELECT 1/0;
// Before the fix, the scanner accepted COMMIT WORK, the early COMMIT
// released the transaction (and the advisory lock), the table and the
// schema_migrations ledger persisted despite the runner reporting failure.
// ---------------------------------------------------------------------------

describe("S3-01 atomicity: COMMIT WORK escape is rejected before applying", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestCtx();
  });

  afterEach(async () => {
    await teardownTestCtx(ctx);
  });

  it("rejects the real failing sequence (COMMIT WORK; SELECT 1/0) with no surviving table or ledger", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_escape.sql",
      "CREATE TABLE escaped(id integer); COMMIT WORK; SELECT 1/0;",
    );

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/top-level|override|MIGRATION_UNSAFE_SQL/);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        // No `escaped` table in the disposable schema.
        const escaped = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2",
          [ctx.schema, "escaped"],
        );
        expect(escaped.rowCount).toBe(0);

        // No schema_migrations table at all (the whole run rolled back,
        // including the bootstrap ledger created by 0001).
        const ledgerTable = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2",
          [ctx.schema, "schema_migrations"],
        );
        expect(ledgerTable.rowCount).toBe(0);

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  });

  it("rejects COMMIT AND CHAIN with no surviving table or ledger", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_chain.sql",
      "CREATE TABLE step03_chain_escape (id int); COMMIT AND CHAIN; SELECT 1;",
    );

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/top-level|override|MIGRATION_UNSAFE_SQL/);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const table = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2",
          [ctx.schema, "step03_chain_escape"],
        );
        expect(table.rowCount).toBe(0);

        const ledgerTable = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2",
          [ctx.schema, "schema_migrations"],
        );
        expect(ledgerTable.rowCount).toBe(0);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  });

  it("rejects START/**/TRANSACTION with no surviving ledger", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_start.sql",
      "CREATE TABLE step03_start_escape (id int); START/**/TRANSACTION; SELECT 1;",
    );

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/top-level|override|MIGRATION_UNSAFE_SQL/);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const table = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2",
          [ctx.schema, "step03_start_escape"],
        );
        expect(table.rowCount).toBe(0);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  });

  it("rejects SET LOCAL search_path override with no surviving ledger", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_setlocal.sql",
      "CREATE TABLE step03_setlocal_escape (id int); SET LOCAL search_path = public; SELECT 1;",
    );

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/top-level|override|MIGRATION_UNSAFE_SQL/);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const table = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2",
          [ctx.schema, "step03_setlocal_escape"],
        );
        expect(table.rowCount).toBe(0);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  });

  it("rejects SET standard_conforming_strings lexical-mode switch with no surviving table", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_guc.sql",
      "CREATE TABLE step03_guc_escape (id int); SET standard_conforming_strings = off; SELECT 1;",
    );

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/top-level|override|MIGRATION_UNSAFE_SQL/);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const table = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2",
          [ctx.schema, "step03_guc_escape"],
        );
        expect(table.rowCount).toBe(0);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  });

  it("rejects unterminated block comment in migration with no surviving table", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_unterminated.sql",
      "CREATE TABLE step03_unterm_escape (id int); /* unclosed COMMIT WORK;",
    );

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/unterminated|MIGRATION_UNSAFE_SQL/);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const table = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2",
          [ctx.schema, "step03_unterm_escape"],
        );
        expect(table.rowCount).toBe(0);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  });
});

describe("S3-01 correction: E-string and doubled-quote live acceptance", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestCtx();
  });

  afterEach(async () => {
    await teardownTestCtx(ctx);
  });

  it("accepts and applies a migration with a legitimate E-string hiding a COMMIT token", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_estring.sql",
      "CREATE TABLE step03_estring_ok (id int, note text); INSERT INTO step03_estring_ok (id, note) VALUES (1, E'quote\\'; COMMIT WORK;');",
    );

    const result = await migrationsRunner.runMigrations({
      migrationsDir: ctx.migrationsDir,
      schema: ctx.schema,
    });
    expect(result.applied).toBe(2);

    const tablePresent = await schemaHasTable(pool, ctx.schema, "step03_estring_ok");
    expect(tablePresent).toBe(true);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const rows = await client.query(
          `SELECT count(*)::int AS n FROM "${ctx.schema}".step03_estring_ok`,
        );
        expect(rows.rows[0]?.n).toBe(1);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  });

  it("accepts and applies a migration with doubled double-quote quoted identifiers", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_doubled.sql",
      'CREATE TABLE step03_doubled_ok (id int); CREATE TABLE "step03_""q""" (id int);',
    );

    const result = await migrationsRunner.runMigrations({
      migrationsDir: ctx.migrationsDir,
      schema: ctx.schema,
    });
    expect(result.applied).toBe(2);

    const tablePresent = await schemaHasTable(pool, ctx.schema, 'step03_"q"');
    expect(tablePresent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S3-01 lexical-boundary follow-up: the previous E-prefix lexer falsely
// treated the trailing `e` of an identifier (e.g. `name`, `CASE`) followed by
// whitespace then a quote as an E-string prefix, merging the whole sequence
// `SELECT name '\'; COMMIT WORK; -- ' SELECT 1;` into a single SELECT and
// letting a real COMMIT WORK escape the guard. The fix requires the E/e prefix
// to be a standalone lexical prefix (immediately adjacent to its quote, and
// not preceded by an identifier character). This live isolated test writes the
// exact Hermes escape sequence preceded by `CREATE TABLE escaped(id integer);`
// and followed by a final `SELECT 1/0`, and proves the runner rejects it with
// no surviving `escaped` table and no ledger row.
// ---------------------------------------------------------------------------

describe("S3-01 lexical-boundary: typed-name E-prefix escape is rejected", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestCtx();
  });

  afterEach(async () => {
    await teardownTestCtx(ctx);
  });

  it("rejects the typed-name escape (name + whitespace + quote) with no surviving table or ledger", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    // The backslash below is a literal single backslash in the SQL file.
    writeMigration(
      ctx,
      "0002_typed_name_escape.sql",
      "CREATE TABLE escaped(id integer);\nSELECT name '\\'; COMMIT WORK; -- '\nSELECT 1;\nSELECT 1/0;",
    );

    await expect(
      migrationsRunner.runMigrations({
        migrationsDir: ctx.migrationsDir,
        schema: ctx.schema,
      }),
    ).rejects.toThrow(/top-level|override|MIGRATION_UNSAFE_SQL/);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const escaped = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2",
          [ctx.schema, "escaped"],
        );
        expect(escaped.rowCount).toBe(0);

        const ledgerTable = await client.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2",
          [ctx.schema, "schema_migrations"],
        );
        expect(ledgerTable.rowCount).toBe(0);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  });

  it("accepts and applies a migration with a genuine E escape string hiding a COMMIT token", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    // The genuine E prefix is immediately adjacent to its quote and preceded
    // by whitespace, so it is recognized as an escape string. The \' inside is
    // an escaped quote, so the COMMIT WORK is string content, not a statement.
    writeMigration(
      ctx,
      "0002_genuine_estring.sql",
      "CREATE TABLE step03_genuine_estring (id int, note text); INSERT INTO step03_genuine_estring (id, note) VALUES (1, E'quote\\'; COMMIT WORK;');",
    );

    const result = await migrationsRunner.runMigrations({
      migrationsDir: ctx.migrationsDir,
      schema: ctx.schema,
    });
    expect(result.applied).toBe(2);

    const tablePresent = await schemaHasTable(pool, ctx.schema, "step03_genuine_estring");
    expect(tablePresent).toBe(true);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const rows = await client.query(
          `SELECT count(*)::int AS n FROM "${ctx.schema}".step03_genuine_estring`,
        );
        expect(rows.rows[0]?.n).toBe(1);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  });
});

describe("S3-01 atomicity: retained valid DO block and idempotent re-run", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestCtx();
  });

  afterEach(async () => {
    await teardownTestCtx(ctx);
  });

  it("accepts and applies a DO block whose procedural body contains BEGIN/END", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_do.sql",
      "CREATE TABLE step03_do_retain (id int); DO $$ BEGIN PERFORM 1; END $$;",
    );

    const result = await migrationsRunner.runMigrations({
      migrationsDir: ctx.migrationsDir,
      schema: ctx.schema,
    });
    expect(result.applied).toBe(2);

    const tablePresent = await schemaHasTable(pool, ctx.schema, "step03_do_retain");
    expect(tablePresent).toBe(true);

    // Idempotent re-run skips both.
    const second = await migrationsRunner.runMigrations({
      migrationsDir: ctx.migrationsDir,
      schema: ctx.schema,
    });
    expect(second.applied).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it("retains history across runs: applied ledger matches file checksums", async () => {
    writeMigration(ctx, "0001_schema_migrations.sql", SCHEMA_MIGRATIONS_DDL);
    writeMigration(
      ctx,
      "0002_hist.sql",
      "CREATE TABLE step03_hist_retain (id int PRIMARY KEY);",
    );

    const first = await migrationsRunner.runMigrations({
      migrationsDir: ctx.migrationsDir,
      schema: ctx.schema,
    });
    expect(first.applied).toBe(2);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const rows = await client.query(
          `SELECT version, checksum FROM "${ctx.schema}".schema_migrations ORDER BY version`,
        );
        expect(rows.rowCount).toBe(2);
        expect(rows.rows.map((r) => r.version)).toEqual([
          "0001_schema_migrations",
          "0002_hist",
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  });
});