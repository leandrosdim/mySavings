// Step08 month entry generation integration tests.
//
// Tests exercise the real production generation service against disposable
// step08_* schemas. Each test uses a unique test user to avoid template
// accumulation across tests (since listActiveTemplates returns ALL active
// templates for an owner). Key scenarios:
// - Generate from active templates creates obligations and income expectations.
// - Rerunning generation produces no duplicates (idempotent).
// - Editing a template does not rewrite prior instances (amount preserved).
// - Inactive templates are not generated.
// - Two-user isolation: user B generation does not affect user A.
// - Concurrent generation is safe (no duplicates).
// - Year rollover: generation works across December -> January boundary.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupMonthsSchema,
  teardownMonthsSchema,
  countObligations,
  countIncomeExpectations,
  readObligationDirect,
  createUniqueTestUser,
  type MonthsTestContext,
} from "./helpers";
import {
  createTemplate,
  updateTemplate,
} from "../../lib/templates/service";
import { createPlan } from "../../lib/months/service";
import { generateMonthEntries } from "../../lib/generation/service";

let ctx: MonthsTestContext;

beforeAll(async () => {
  ctx = await setupMonthsSchema();
});

afterAll(async () => {
  await teardownMonthsSchema(ctx);
});

describe("Step08 generation: basic", () => {
  it("generates obligations from active ordinary/reserved templates", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await createPlan(user, { monthKey: "2026-03", savingsTargetCents: 0 });

    await createTemplate(user, {
      name: "Gen rent",
      kind: "ordinary",
      defaultAmountCents: 700000,
      dueDayOfMonth: 5,
      active: true,
    });
    await createTemplate(user, {
      name: "Gen tax",
      kind: "reserved",
      defaultAmountCents: 200000,
      dueDayOfMonth: 20,
      active: true,
    });

    const result = await generateMonthEntries(user, "2026-03");
    expect(result.generatedObligations).toBe(2);
    expect(result.generatedIncome).toBe(0);
    expect(result.skippedObligations).toBe(0);
    expect(result.monthKey).toBe("2026-03");

    const obls = await countObligations(ctx.pool, user, "2026-03");
    expect(obls).toBe(2);
  });

  it("generates income expectations from active income templates", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await createPlan(user, { monthKey: "2026-04", savingsTargetCents: 0 });

    await createTemplate(user, {
      name: "Gen salary",
      kind: "income",
      defaultAmountCents: 2500000,
      dueDayOfMonth: null,
      active: true,
    });

    const result = await generateMonthEntries(user, "2026-04");
    expect(result.generatedIncome).toBe(1);
    expect(result.generatedObligations).toBe(0);

    const income = await countIncomeExpectations(ctx.pool, user, "2026-04");
    expect(income).toBe(1);
  });
});

describe("Step08 generation: idempotency", () => {
  it("rerunning generation produces no duplicates", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await createPlan(user, { monthKey: "2026-05", savingsTargetCents: 0 });

    await createTemplate(user, {
      name: "Idem rent",
      kind: "ordinary",
      defaultAmountCents: 500000,
      dueDayOfMonth: null,
      active: true,
    });
    await createTemplate(user, {
      name: "Idem salary",
      kind: "income",
      defaultAmountCents: 2000000,
      dueDayOfMonth: null,
      active: true,
    });

    const first = await generateMonthEntries(user, "2026-05");
    expect(first.generatedObligations).toBe(1);
    expect(first.generatedIncome).toBe(1);

    const second = await generateMonthEntries(user, "2026-05");
    expect(second.generatedObligations).toBe(0);
    expect(second.generatedIncome).toBe(0);
    expect(second.skippedObligations).toBe(1);
    expect(second.skippedIncome).toBe(1);

    const obls = await countObligations(ctx.pool, user, "2026-05");
    const income = await countIncomeExpectations(ctx.pool, user, "2026-05");
    expect(obls).toBe(1);
    expect(income).toBe(1);
  });

  it("concurrent generation produces no duplicates", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await createPlan(user, { monthKey: "2026-06", savingsTargetCents: 0 });

    await createTemplate(user, {
      name: "Concurrent rent",
      kind: "ordinary",
      defaultAmountCents: 300000,
      dueDayOfMonth: null,
      active: true,
    });

    const results = await Promise.all([
      generateMonthEntries(user, "2026-06"),
      generateMonthEntries(user, "2026-06"),
      generateMonthEntries(user, "2026-06"),
    ]);

    const totalGenerated = results.reduce(
      (sum: number, r) => sum + r.generatedObligations,
      0,
    );
    expect(totalGenerated).toBe(1);

    const obls = await countObligations(ctx.pool, user, "2026-06");
    expect(obls).toBe(1);
  });
});

describe("Step08 generation: template edit preserves instances", () => {
  it("editing template amount does not change existing obligations", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await createPlan(user, { monthKey: "2026-07", savingsTargetCents: 0 });
    await createPlan(user, { monthKey: "2026-08", savingsTargetCents: 0 });

    const { template } = await createTemplate(user, {
      name: "Edit preserve",
      kind: "ordinary",
      defaultAmountCents: 100000,
      dueDayOfMonth: null,
      active: true,
    });

    const first = await generateMonthEntries(user, "2026-07");
    expect(first.generatedObligations).toBe(1);

    const oblsBefore = await countObligations(ctx.pool, user, "2026-07");
    expect(oblsBefore).toBe(1);

    const obligationId = await getFirstObligationId(ctx.pool, user, "2026-07");
    const beforeDirect = await readObligationDirect(ctx.pool, user, obligationId);
    expect(beforeDirect.plannedCents).toBe(100000);

    await updateTemplate(user, template.id, {
      defaultAmountCents: 200000,
    });

    const afterDirect = await readObligationDirect(ctx.pool, user, obligationId);
    expect(afterDirect.plannedCents).toBe(100000);

    const nextMonth = await generateMonthEntries(user, "2026-08");
    expect(nextMonth.generatedObligations).toBe(1);

    const nextObligationId = await getFirstObligationId(ctx.pool, user, "2026-08");
    const nextDirect = await readObligationDirect(ctx.pool, user, nextObligationId);
    expect(nextDirect.plannedCents).toBe(200000);
  });

  it("editing template name does not change existing obligation title", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await createPlan(user, { monthKey: "2026-09", savingsTargetCents: 0 });

    const { template } = await createTemplate(user, {
      name: "Name before",
      kind: "ordinary",
      defaultAmountCents: 50000,
      dueDayOfMonth: null,
      active: true,
    });

    await generateMonthEntries(user, "2026-09");

    const obligationId = await getFirstObligationId(ctx.pool, user, "2026-09");
    const before = await readObligationDirect(ctx.pool, user, obligationId);
    expect(before.title).toBe("Name before");

    await updateTemplate(user, template.id, { name: "Name after" });

    const after = await readObligationDirect(ctx.pool, user, obligationId);
    expect(after.title).toBe("Name before");
  });
});

describe("Step08 generation: inactive templates", () => {
  it("does not generate from inactive templates", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await createPlan(user, { monthKey: "2026-10", savingsTargetCents: 0 });

    await createTemplate(user, {
      name: "Inactive gen",
      kind: "ordinary",
      defaultAmountCents: 50000,
      dueDayOfMonth: null,
      active: false,
    });

    const result = await generateMonthEntries(user, "2026-10");
    expect(result.generatedObligations).toBe(0);
    expect(result.skippedObligations).toBe(0);

    const obls = await countObligations(ctx.pool, user, "2026-10");
    expect(obls).toBe(0);
  });
});

describe("Step08 generation: two-user isolation", () => {
  it("user A generation does not create entries for user B", async () => {
    const userA = await createUniqueTestUser(ctx.pool);
    const userB = await createUniqueTestUser(ctx.pool);
    await createPlan(userA, { monthKey: "2026-11", savingsTargetCents: 0 });
    await createPlan(userB, { monthKey: "2026-11", savingsTargetCents: 0 });

    await createTemplate(userA, {
      name: "Isolation A",
      kind: "ordinary",
      defaultAmountCents: 50000,
      dueDayOfMonth: null,
      active: true,
    });

    await createTemplate(userB, {
      name: "Isolation B",
      kind: "income",
      defaultAmountCents: 100000,
      dueDayOfMonth: null,
      active: true,
    });

    const resultA = await generateMonthEntries(userA, "2026-11");
    expect(resultA.generatedObligations).toBe(1);
    expect(resultA.generatedIncome).toBe(0);

    const resultB = await generateMonthEntries(userB, "2026-11");
    expect(resultB.generatedObligations).toBe(0);
    expect(resultB.generatedIncome).toBe(1);

    const oblsA = await countObligations(ctx.pool, userA, "2026-11");
    const oblsB = await countObligations(ctx.pool, userB, "2026-11");
    const incomeA = await countIncomeExpectations(ctx.pool, userA, "2026-11");
    const incomeB = await countIncomeExpectations(ctx.pool, userB, "2026-11");
    expect(oblsA).toBe(1);
    expect(oblsB).toBe(0);
    expect(incomeA).toBe(0);
    expect(incomeB).toBe(1);
  });
});

describe("Step08 generation: year rollover", () => {
  it("generates correctly across December -> January boundary", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await createPlan(user, { monthKey: "2026-12", savingsTargetCents: 0 });
    await createPlan(user, { monthKey: "2027-01", savingsTargetCents: 0 });

    await createTemplate(user, {
      name: "Rollover rent",
      kind: "ordinary",
      defaultAmountCents: 600000,
      dueDayOfMonth: 1,
      active: true,
    });

    const dec = await generateMonthEntries(user, "2026-12");
    expect(dec.generatedObligations).toBe(1);
    expect(dec.monthKey).toBe("2026-12");

    const jan = await generateMonthEntries(user, "2027-01");
    expect(jan.generatedObligations).toBe(1);
    expect(jan.monthKey).toBe("2027-01");

    const decObls = await countObligations(ctx.pool, user, "2026-12");
    const janObls = await countObligations(ctx.pool, user, "2027-01");
    expect(decObls).toBe(1);
    expect(janObls).toBe(1);
  });
});

describe("Step08 generation: empty templates", () => {
  it("generates nothing when no templates exist", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await createPlan(user, { monthKey: "2027-02", savingsTargetCents: 0 });
    const result = await generateMonthEntries(user, "2027-02");
    expect(result.generatedObligations).toBe(0);
    expect(result.generatedIncome).toBe(0);
    expect(result.skippedObligations).toBe(0);
    expect(result.skippedIncome).toBe(0);
  });
});

// Helper: get the first obligation ID for an owner+month.
async function getFirstObligationId(
  pool: MonthsTestContext["pool"],
  ownerId: string,
  monthKey: string,
): Promise<string> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ id: string }>(
      `SELECT id::text FROM obligations
       WHERE owner_id = $1 AND current_month_key = $2
       ORDER BY id ASC LIMIT 1`,
      [ownerId, monthKey],
    );
    if (result.rows.length === 0) {
      throw new Error("No obligation found");
    }
    return result.rows[0].id;
  } finally {
    client.release();
  }
}