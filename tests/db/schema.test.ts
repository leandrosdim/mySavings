// Step05 owner-scoped financial schema integration tests.
//
// All tests run against DISPOSABLE, uniquely-named step05_* schemas on the
// approved project test database. The full migration chain (0001 + 0002 +
// 0003) is applied into each disposable schema via the real migration runner.
// Two synthetic users (A and B) are provisioned directly via SQL so cross-owner
// isolation can be tested. No real data, no public schema writes.
//
// Every test uses explicit transactions (withTransaction or client-level
// BEGIN/COMMIT/ROLLBACK) for fixture writes, per the project's mandatory
// explicit-transaction rule. Scoped fixtures are cleaned up in finally.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import {
  loadEnvFileForTests,
  requireDatabaseUrl,
  uniqueSchemaName,
  createDisposableSchema,
  dropDisposableSchema,
  makePool,
} from "./helpers";

loadEnvFileForTests();

const MIGRATIONS_DIR = resolve(process.cwd(), "db", "migrations");

const migrationsRunner = require("../../db/migrations.js") as {
  runMigrations: (opts: {
    migrationsDir?: string;
    schema?: string;
  }) => Promise<{ applied: number; skipped: number }>;
};

const url = requireDatabaseUrl();

const MAX_SAFE = "9007199254740991";

type SchemaContext = {
  schema: string;
  adminPool: Pool;
  testPool: Pool;
  userA: string;
  userB: string;
};

// Build a pool whose every connection carries the disposable schema as a
// startup search_path option, so all unqualified table references resolve to
// the disposable schema. Uses the DIRECT endpoint (no -pooler) so the
// startup search_path survives connection recycling.
function directUrlFromPooled(pooledUrl: string): string {
  const u = new URL(pooledUrl);
  if (u.hostname.includes("-pooler.")) {
    u.hostname = u.hostname.replace("-pooler.", ".");
  }
  return u.toString();
}

function makeSchemaPool(directUrl: string, schema: string): Pool {
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
    max: 6,
  });
}

// Provision two synthetic users directly via SQL and return their ids as
// strings (the users PK is BIGINT IDENTITY). Argon2 hash is a placeholder —
// no login is performed in schema tests.
async function provisionTestUsers(pool: Pool): Promise<{ a: string; b: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const aResult = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
        [`a@step05.test.local`, `argon2id$placeholder`],
      );
      const bResult = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`,
        [`b@step05.test.local`, `argon2id$placeholder`],
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

async function setupSchemaContext(): Promise<SchemaContext> {
  const schema = uniqueSchemaName("step05");
  const adminPool = makePool(url);
  await createDisposableSchema(adminPool, schema);
  await migrationsRunner.runMigrations({
    migrationsDir: MIGRATIONS_DIR,
    schema,
  });
  const directUrl = directUrlFromPooled(url);
  const testPool = makeSchemaPool(directUrl, schema);
  const users = await provisionTestUsers(testPool);
  return {
    schema,
    adminPool,
    testPool,
    userA: users.a,
    userB: users.b,
  };
}

async function teardownSchemaContext(ctx: SchemaContext): Promise<void> {
  await ctx.testPool.end();
  await dropDisposableSchema(ctx.adminPool, ctx.schema);
  await ctx.adminPool.end();
}

// Helper: run a function inside a transaction on a checked-out client. Rolls
// back on error, commits on success. Used for fixture inserts that must be
// atomic.
async function txn<T>(
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

// Helper: insert a monthly plan and return its id.
async function insertPlan(
  pool: Pool,
  ownerId: string,
  monthKey: string,
  savingsTarget = 0,
): Promise<string> {
  return txn(pool, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO monthly_plans (owner_id, month_key, savings_target_cents)
       VALUES ($1, $2, $3) RETURNING id::text`,
      [ownerId, monthKey, savingsTarget],
    );
    return result.rows[0].id;
  });
}

// Helper: insert an account and return its id.
async function insertAccount(
  pool: Pool,
  ownerId: string,
  name: string,
  balance: number | null = null,
): Promise<string> {
  return txn(pool, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO accounts (owner_id, name, current_balance_cents)
       VALUES ($1, $2, $3) RETURNING id::text`,
      [ownerId, name, balance],
    );
    return result.rows[0].id;
  });
}

// Helper: insert an obligation and return its id.
async function insertObligation(
  pool: Pool,
  ownerId: string,
  kind: string,
  title: string,
  planned: number,
  monthKey: string,
  extra: Partial<{
    linkedAccountId: string;
    originTemplateId: string;
    linkedReserveId: string;
    dueDate: string;
  }> = {},
): Promise<string> {
  return txn(pool, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO obligations (owner_id, kind, title, planned_cents, original_month_key, current_month_key, linked_account_id, origin_template_id, linked_reserve_id, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id::text`,
      [
        ownerId,
        kind,
        title,
        planned,
        monthKey,
        monthKey,
        extra.linkedAccountId ?? null,
        extra.originTemplateId ?? null,
        extra.linkedReserveId ?? null,
        extra.dueDate ?? null,
      ],
    );
    return result.rows[0].id;
  });
}

describe("Step05 schema: migration idempotence", () => {
  let ctx: SchemaContext;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("applies all three migrations and second run skips all", async () => {
    const second = await migrationsRunner.runMigrations({
      migrationsDir: MIGRATIONS_DIR,
      schema: ctx.schema,
    });
    expect(second.applied).toBe(0);
    expect(second.skipped).toBe(4);
  });

  it("creates all expected tables", async () => {
    const client = await ctx.testPool.connect();
    try {
      const result = await client.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
        [ctx.schema],
      );
      const tables = result.rows.map((r) => r.tablename);
      expect(tables).toContain("accounts");
      expect(tables).toContain("monthly_plans");
      expect(tables).toContain("recurring_templates");
      expect(tables).toContain("obligations");
      expect(tables).toContain("income_expectations");
      expect(tables).toContain("settlements");
      expect(tables).toContain("settlement_reversals");
      expect(tables).toContain("income_receipts");
      expect(tables).toContain("income_receipt_reversals");
      expect(tables).toContain("account_movements");
      expect(tables).toContain("balance_adjustments");
      expect(tables).toContain("internal_transfers");
      expect(tables).toContain("operation_log");
      expect(tables).toContain("closing_snapshots");
      expect(tables).toContain("audit_log");
    } finally {
      client.release();
    }
  });
});

describe("Step05 schema: month key and plan uniqueness", () => {
  let ctx: SchemaContext;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("rejects an invalid month_key format", async () => {
    await expect(
      insertPlan(ctx.testPool, ctx.userA, "2026-13"),
    ).rejects.toThrow();
  });

  it("rejects a duplicate owner+month_key", async () => {
    await insertPlan(ctx.testPool, ctx.userA, "2026-09");
    await expect(
      insertPlan(ctx.testPool, ctx.userA, "2026-09"),
    ).rejects.toThrow();
  });

  it("allows the same month_key for different owners", async () => {
    await insertPlan(ctx.testPool, ctx.userB, "2026-08");
    await insertPlan(ctx.testPool, ctx.userA, "2026-08");
  });

  it("rejects a negative savings target", async () => {
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO monthly_plans (owner_id, month_key, savings_target_cents) VALUES ($1, $2, $3)`,
          [ctx.userA, "2026-07", -1],
        );
      }),
    ).rejects.toThrow();
  });
});

describe("Step05 schema: money bounds", () => {
  let ctx: SchemaContext;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
    await insertPlan(ctx.testPool, ctx.userA, "2026-06");
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("rejects a planned amount exceeding MAX_SAFE_INTEGER", async () => {
    const over = String(Number.MAX_SAFE_INTEGER + 1);
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO obligations (owner_id, kind, title, planned_cents, original_month_key, current_month_key)
           VALUES ($1, 'ordinary', 'over', $2, '2026-06', '2026-06')`,
          [ctx.userA, over],
        );
      }),
    ).rejects.toThrow();
  });

  it("rejects a negative account balance beyond -MAX_SAFE_INTEGER", async () => {
    const under = String(-Number.MAX_SAFE_INTEGER - 1);
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO accounts (owner_id, name, current_balance_cents) VALUES ($1, 'neg', $2)`,
          [ctx.userA, under],
        );
      }),
    ).rejects.toThrow();
  });

  it("accepts a balance at exactly -MAX_SAFE_INTEGER", async () => {
    await insertAccount(ctx.testPool, ctx.userA, "boundary", -Number.MAX_SAFE_INTEGER);
  });

  it("accepts a planned amount at exactly MAX_SAFE_INTEGER", async () => {
    await insertObligation(
      ctx.testPool,
      ctx.userA,
      "ordinary",
      "boundary",
      Number.MAX_SAFE_INTEGER,
      "2026-06",
    );
  });
});

describe("Step05 schema: cross-owner isolation (composite FKs)", () => {
  let ctx: SchemaContext;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
    await insertPlan(ctx.testPool, ctx.userA, "2026-05");
    await insertPlan(ctx.testPool, ctx.userB, "2026-05");
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("owner A cannot link an obligation to owner B's account", async () => {
    const bAccount = await insertAccount(ctx.testPool, ctx.userB, "B's account");
    await expect(
      insertObligation(ctx.testPool, ctx.userA, "ordinary", "cross", 1000, "2026-05", {
        linkedAccountId: bAccount,
      }),
    ).rejects.toThrow();
  });

  it("owner A cannot link an obligation to owner B's obligation as linked_reserve_id", async () => {
    const bReserve = await insertObligation(
      ctx.testPool,
      ctx.userB,
      "reserved",
      "B's reserve",
      5000,
      "2026-05",
    );
    await expect(
      insertObligation(ctx.testPool, ctx.userA, "ordinary", "cross-link", 1000, "2026-05", {
        linkedReserveId: bReserve,
      }),
    ).rejects.toThrow();
  });

  it("owner A cannot create a settlement against owner B's obligation", async () => {
    const bObligation = await insertObligation(
      ctx.testPool,
      ctx.userB,
      "ordinary",
      "B's expense",
      8000,
      "2026-05",
    );
    const aAccount = await insertAccount(ctx.testPool, ctx.userA, "A's account", 100000);
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, account_id, business_date, idempotency_key)
           VALUES ($1, $2, $3, 'UPDATE_ACCOUNT', $4, '2026-05-01', 'cross-settle-1')`,
          [ctx.userA, bObligation, 4000, aAccount],
        );
      }),
    ).rejects.toThrow();
  });

  it("owner A cannot create a settlement using owner B's account", async () => {
    const aObligation = await insertObligation(
      ctx.testPool,
      ctx.userA,
      "ordinary",
      "A's expense",
      8000,
      "2026-05",
    );
    const bAccount = await insertAccount(ctx.testPool, ctx.userB, "B's account", 100000);
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, account_id, business_date, idempotency_key)
           VALUES ($1, $2, $3, 'UPDATE_ACCOUNT', $4, '2026-05-01', 'cross-acct-1')`,
          [ctx.userA, aObligation, 4000, bAccount],
        );
      }),
    ).rejects.toThrow();
  });

  it("owner A cannot create an internal transfer to owner B's account", async () => {
    const aAccount = await insertAccount(ctx.testPool, ctx.userA, "A's account", 100000);
    const bAccount = await insertAccount(ctx.testPool, ctx.userB, "B's account", 100000);
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO internal_transfers (owner_id, from_account_id, to_account_id, amount_cents, business_date, idempotency_key)
           VALUES ($1, $2, $3, $4, '2026-05-01', 'cross-transfer-1')`,
          [ctx.userA, aAccount, bAccount, 5000],
        );
      }),
    ).rejects.toThrow();
  });

  it("owner A cannot insert a closing snapshot for owner B's month", async () => {
    // Owner B has a plan for 2026-05; owner A does not have a plan for 2026-05
    // in this describe block's beforeAll (A has 2026-05 but B also has 2026-05).
    // Use a month that only B has a plan for: insert one for B only.
    await insertPlan(ctx.testPool, ctx.userB, "2025-05");
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO closing_snapshots (owner_id, month_key, balances_total_cents, pending_income_remaining_cents, ordinary_unpaid_cents, reserved_outstanding_cents, savings_target_cents, projected_free_to_spend_cents, cash_backed_free_to_spend_cents, settlement_total_cents, closed_at)
           VALUES ($1, '2025-05', 0, 0, 0, 0, 0, 0, 0, 0, now())`,
          [ctx.userA],
        );
      }),
    ).rejects.toThrow();
  });
});

describe("Step05 schema: settlement constraints", () => {
  let ctx: SchemaContext;
  let obligationId: string;
  let accountId: string;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
    await insertPlan(ctx.testPool, ctx.userA, "2026-04");
    obligationId = await insertObligation(
      ctx.testPool,
      ctx.userA,
      "ordinary",
      "gas",
      8000,
      "2026-04",
    );
    accountId = await insertAccount(ctx.testPool, ctx.userA, "checking", 100000);
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("rejects a nonpositive settlement amount", async () => {
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, account_id, business_date, idempotency_key)
           VALUES ($1, $2, 0, 'UPDATE_ACCOUNT', $3, '2026-04-01', 'zero-pay')`,
          [ctx.userA, obligationId, accountId],
        );
      }),
    ).rejects.toThrow();
  });

  it("rejects UPDATE_ACCOUNT mode without account_id", async () => {
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, account_id, business_date, idempotency_key)
           VALUES ($1, $2, 4000, 'UPDATE_ACCOUNT', NULL, '2026-04-01', 'no-acct')`,
          [ctx.userA, obligationId],
        );
      }),
    ).rejects.toThrow();
  });

  it("accepts ALREADY_REFLECTED mode without account_id", async () => {
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, account_id, business_date, idempotency_key)
         VALUES ($1, $2, 4000, 'ALREADY_REFLECTED', NULL, '2026-04-01', 'already-1')`,
        [ctx.userA, obligationId],
      );
    });
  });

  it("rejects a duplicate idempotency_key for the same owner", async () => {
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, account_id, business_date, idempotency_key)
         VALUES ($1, $2, 4000, 'UPDATE_ACCOUNT', $3, '2026-04-02', 'dup-key')`,
        [ctx.userA, obligationId, accountId],
      );
    });
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, account_id, business_date, idempotency_key)
           VALUES ($1, $2, 2000, 'UPDATE_ACCOUNT', $3, '2026-04-03', 'dup-key')`,
          [ctx.userA, obligationId, accountId],
        );
      }),
    ).rejects.toThrow();
  });

  it("allows the same idempotency_key for different owners", async () => {
    // Owner B needs their own plan, obligation and account.
    await insertPlan(ctx.testPool, ctx.userB, "2026-04");
    const bObligation = await insertObligation(
      ctx.testPool,
      ctx.userB,
      "ordinary",
      "B gas",
      8000,
      "2026-04",
    );
    const bAccount = await insertAccount(ctx.testPool, ctx.userB, "B checking", 100000);
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, account_id, business_date, idempotency_key)
         VALUES ($1, $2, 4000, 'UPDATE_ACCOUNT', $3, '2026-04-04', 'shared-key')`,
        [ctx.userA, obligationId, accountId],
      );
    });
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, account_id, business_date, idempotency_key)
         VALUES ($1, $2, 4000, 'UPDATE_ACCOUNT', $3, '2026-04-04', 'shared-key')`,
        [ctx.userB, bObligation, bAccount],
      );
    });
  });
});

describe("Step05 schema: settlement reversal uniqueness", () => {
  let ctx: SchemaContext;
  let settlementId: string;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
    await insertPlan(ctx.testPool, ctx.userA, "2026-03");
    const obligationId = await insertObligation(
      ctx.testPool,
      ctx.userA,
      "ordinary",
      "reversible",
      8000,
      "2026-03",
    );
    const accountId = await insertAccount(ctx.testPool, ctx.userA, "checking", 100000);
    settlementId = await txn(ctx.testPool, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, account_id, business_date, idempotency_key)
         VALUES ($1, $2, 4000, 'UPDATE_ACCOUNT', $3, '2026-03-01', 'rev-1') RETURNING id::text`,
        [ctx.userA, obligationId, accountId],
      );
      return result.rows[0].id;
    });
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("rejects a second reversal of the same settlement", async () => {
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO settlement_reversals (owner_id, original_settlement_id, reason, business_date, idempotency_key)
         VALUES ($1, $2, 'mistake', '2026-03-02', 'rev-key-1')`,
        [ctx.userA, settlementId],
      );
    });
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO settlement_reversals (owner_id, original_settlement_id, reason, business_date, idempotency_key)
           VALUES ($1, $2, 'second', '2026-03-03', 'rev-key-2')`,
          [ctx.userA, settlementId],
        );
      }),
    ).rejects.toThrow();
  });
});

describe("Step05 schema: internal transfer constraints", () => {
  let ctx: SchemaContext;
  let accountA: string;
  let accountB: string;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
    accountA = await insertAccount(ctx.testPool, ctx.userA, "from-acct", 100000);
    accountB = await insertAccount(ctx.testPool, ctx.userA, "to-acct", 50000);
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("rejects a transfer where from = to", async () => {
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO internal_transfers (owner_id, from_account_id, to_account_id, amount_cents, business_date, idempotency_key)
           VALUES ($1, $2, $2, 5000, '2026-01-01', 'self-transfer')`,
          [ctx.userA, accountA],
        );
      }),
    ).rejects.toThrow();
  });

  it("rejects a nonpositive transfer amount", async () => {
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO internal_transfers (owner_id, from_account_id, to_account_id, amount_cents, business_date, idempotency_key)
           VALUES ($1, $2, $3, 0, '2026-01-01', 'zero-transfer')`,
          [ctx.userA, accountA, accountB],
        );
      }),
    ).rejects.toThrow();
  });
});

describe("Step05 schema: template generation uniqueness", () => {
  let ctx: SchemaContext;
  let templateId: string;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
    await insertPlan(ctx.testPool, ctx.userA, "2026-02");
    templateId = await txn(ctx.testPool, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO recurring_templates (owner_id, name, kind, default_amount_cents)
         VALUES ($1, 'rent', 'ordinary', 80000) RETURNING id::text`,
        [ctx.userA],
      );
      return result.rows[0].id;
    });
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("rejects a duplicate obligation from the same template in the same month", async () => {
    await insertObligation(ctx.testPool, ctx.userA, "ordinary", "rent Jan", 80000, "2026-02", {
      originTemplateId: templateId,
    });
    await expect(
      insertObligation(ctx.testPool, ctx.userA, "ordinary", "rent Jan dup", 80000, "2026-02", {
        originTemplateId: templateId,
      }),
    ).rejects.toThrow();
  });

  it("allows the same template to generate in a different month", async () => {
    await insertPlan(ctx.testPool, ctx.userA, "2026-03");
    await insertObligation(ctx.testPool, ctx.userA, "ordinary", "rent Feb", 80000, "2026-03", {
      originTemplateId: templateId,
    });
  });
});

describe("Step05 schema: paid history survives (ON DELETE RESTRICT)", () => {
  let ctx: SchemaContext;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("cannot delete an account that has account_movements", async () => {
    await insertPlan(ctx.testPool, ctx.userA, "2026-01");
    const accountId = await insertAccount(ctx.testPool, ctx.userA, "protected", 100000);
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO account_movements (owner_id, account_id, direction, amount_cents, source_type, business_date)
         VALUES ($1, $2, 'credit', 5000, 'adjustment', '2026-01-01')`,
        [ctx.userA, accountId],
      );
    });
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
      }),
    ).rejects.toThrow();
  });

  it("cannot delete an obligation that has settlements", async () => {
    await insertPlan(ctx.testPool, ctx.userA, "2025-12");
    const obligationId = await insertObligation(
      ctx.testPool,
      ctx.userA,
      "ordinary",
      "protected-obligation",
      8000,
      "2025-12",
    );
    const accountId = await insertAccount(ctx.testPool, ctx.userA, "acct", 100000);
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, account_id, business_date, idempotency_key)
         VALUES ($1, $2, 4000, 'UPDATE_ACCOUNT', $3, '2025-12-01', 'protect-1')`,
        [ctx.userA, obligationId, accountId],
      );
    });
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(`DELETE FROM obligations WHERE id = $1`, [obligationId]);
      }),
    ).rejects.toThrow();
  });
});

describe("Step05 schema: operation_log idempotency", () => {
  let ctx: SchemaContext;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("rejects a duplicate operation_key for the same owner", async () => {
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO operation_log (owner_id, operation_key, payload_hash, operation_type)
         VALUES ($1, 'op-1', 'hash-aaa', 'settlement')`,
        [ctx.userA],
      );
    });
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO operation_log (owner_id, operation_key, payload_hash, operation_type)
           VALUES ($1, 'op-1', 'hash-bbb', 'settlement')`,
          [ctx.userA],
        );
      }),
    ).rejects.toThrow();
  });

  it("allows the same operation_key for different owners", async () => {
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO operation_log (owner_id, operation_key, payload_hash, operation_type)
         VALUES ($1, 'shared-op', 'hash-aaa', 'settlement')`,
        [ctx.userA],
      );
    });
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO operation_log (owner_id, operation_key, payload_hash, operation_type)
         VALUES ($1, 'shared-op', 'hash-aaa', 'settlement')`,
        [ctx.userB],
      );
    });
  });
});

describe("Step05 schema: closing snapshot uniqueness", () => {
  let ctx: SchemaContext;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
    await insertPlan(ctx.testPool, ctx.userA, "2025-11");
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("rejects a duplicate closing snapshot for the same owner+month", async () => {
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO closing_snapshots (owner_id, month_key, balances_total_cents, pending_income_remaining_cents, ordinary_unpaid_cents, reserved_outstanding_cents, savings_target_cents, projected_free_to_spend_cents, cash_backed_free_to_spend_cents, settlement_total_cents, closed_at)
         VALUES ($1, '2025-11', 100000, 50000, 30000, 20000, 70000, 30000, -20000, 40000, now())`,
        [ctx.userA],
      );
    });
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO closing_snapshots (owner_id, month_key, balances_total_cents, pending_income_remaining_cents, ordinary_unpaid_cents, reserved_outstanding_cents, savings_target_cents, projected_free_to_spend_cents, cash_backed_free_to_spend_cents, settlement_total_cents, closed_at)
           VALUES ($1, '2025-11', 0, 0, 0, 0, 0, 0, 0, 0, now())`,
          [ctx.userA],
        );
      }),
    ).rejects.toThrow();
  });
});

describe("Step05 schema: obligation month_key references real plan", () => {
  let ctx: SchemaContext;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("rejects an obligation whose current_month_key has no plan", async () => {
    await insertPlan(ctx.testPool, ctx.userA, "2025-10");
    await expect(
      insertObligation(ctx.testPool, ctx.userA, "ordinary", "orphan", 1000, "2025-09"),
    ).rejects.toThrow();
  });

  it("rejects an obligation whose original_month_key has no plan", async () => {
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO obligations (owner_id, kind, title, planned_cents, original_month_key, current_month_key)
           VALUES ($1, 'ordinary', 'cross-month', 1000, '2025-09', '2025-10')`,
          [ctx.userA],
        );
      }),
    ).rejects.toThrow();
  });
});

describe("Step05 schema: user deletion cascades finance rows", () => {
  let ctx: SchemaContext;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("deleting a user cascades to all owner-scoped finance tables", async () => {
    await insertPlan(ctx.testPool, ctx.userA, "2025-08");
    await insertAccount(ctx.testPool, ctx.userA, "cascade-acct", 100000);
    await insertObligation(ctx.testPool, ctx.userA, "ordinary", "cascade-oblig", 5000, "2025-08");

    const client = await ctx.testPool.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query(`DELETE FROM users WHERE id = $1`, [ctx.userA]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }

    const checkClient = await ctx.testPool.connect();
    try {
      const accounts = await checkClient.query(
        `SELECT count(*)::int AS n FROM accounts WHERE owner_id = $1`,
        [ctx.userA],
      );
      expect(accounts.rows[0].n).toBe(0);

      const plans = await checkClient.query(
        `SELECT count(*)::int AS n FROM monthly_plans WHERE owner_id = $1`,
        [ctx.userA],
      );
      expect(plans.rows[0].n).toBe(0);

      const obligations = await checkClient.query(
        `SELECT count(*)::int AS n FROM obligations WHERE owner_id = $1`,
        [ctx.userA],
      );
      expect(obligations.rows[0].n).toBe(0);
    } finally {
      checkClient.release();
    }
  });
});

describe("Step05 schema: account_movements direction and source_type", () => {
  let ctx: SchemaContext;
  let accountId: string;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
    accountId = await insertAccount(ctx.testPool, ctx.userA, "moves", 100000);
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("rejects an invalid direction", async () => {
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO account_movements (owner_id, account_id, direction, amount_cents, source_type, business_date)
           VALUES ($1, $2, 'sideways', 5000, 'adjustment', '2026-01-01')`,
          [ctx.userA, accountId],
        );
      }),
    ).rejects.toThrow();
  });

  it("rejects an invalid source_type", async () => {
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO account_movements (owner_id, account_id, direction, amount_cents, source_type, business_date)
           VALUES ($1, $2, 'credit', 5000, 'magic', '2026-01-01')`,
          [ctx.userA, accountId],
        );
      }),
    ).rejects.toThrow();
  });

  it("rejects a nonpositive movement amount", async () => {
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO account_movements (owner_id, account_id, direction, amount_cents, source_type, business_date)
           VALUES ($1, $2, 'credit', 0, 'adjustment', '2026-01-01')`,
          [ctx.userA, accountId],
        );
      }),
    ).rejects.toThrow();
  });
});

describe("Step05 schema: income_expectations constraints", () => {
  let ctx: SchemaContext;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
    await insertPlan(ctx.testPool, ctx.userA, "2026-01");
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("rejects a negative expected amount", async () => {
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO income_expectations (owner_id, month_key, source_name, expected_cents)
           VALUES ($1, '2026-01', 'salary', -100)`,
          [ctx.userA],
        );
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate owner+month+source_name", async () => {
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO income_expectations (owner_id, month_key, source_name, expected_cents)
         VALUES ($1, '2026-01', 'salary', 50000)`,
        [ctx.userA],
      );
    });
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO income_expectations (owner_id, month_key, source_name, expected_cents)
           VALUES ($1, '2026-01', 'salary', 60000)`,
          [ctx.userA],
        );
      }),
    ).rejects.toThrow();
  });

  it("rejects an income_expectation whose month_key has no plan", async () => {
    await expect(
      txn(ctx.testPool, async (client) => {
        await client.query(
          `INSERT INTO income_expectations (owner_id, month_key, source_name, expected_cents)
           VALUES ($1, '2025-01', 'bonus', 10000)`,
          [ctx.userA],
        );
      }),
    ).rejects.toThrow();
  });
});

describe("Step05 schema: BIGINT safe boundary values", () => {
  let ctx: SchemaContext;

  beforeAll(async () => {
    ctx = await setupSchemaContext();
    await insertPlan(ctx.testPool, ctx.userA, "2024-12");
  });

  afterAll(async () => {
    await teardownSchemaContext(ctx);
  });

  it("a settlement amount at exactly MAX_SAFE_INTEGER is accepted", async () => {
    const obligationId = await insertObligation(
      ctx.testPool,
      ctx.userA,
      "ordinary",
      "big",
      Number.MAX_SAFE_INTEGER,
      "2024-12",
    );
    const accountId = await insertAccount(ctx.testPool, ctx.userA, "big-acct", Number.MAX_SAFE_INTEGER);
    await txn(ctx.testPool, async (client) => {
      await client.query(
        `INSERT INTO settlements (owner_id, obligation_id, amount_cents, mode, account_id, business_date, idempotency_key)
         VALUES ($1, $2, $3, 'UPDATE_ACCOUNT', $4, '2024-12-01', 'max-safe-pay')`,
        [ctx.userA, obligationId, MAX_SAFE, accountId],
      );
    });
  });
});