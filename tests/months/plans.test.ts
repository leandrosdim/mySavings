// Step08 monthly plan integration tests.
//
// Tests exercise the real production service layer (lib/months/service.ts)
// against disposable step08_* schemas with two synthetic users (A and B).
// No mocking of the business logic; the service runs against the real DB.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupMonthsSchema,
  teardownMonthsSchema,
  countPlans,
  readPlanTargetDirect,
  type MonthsTestContext,
} from "./helpers";
import {
  createPlan,
  getOrCreatePlan,
  getPlan,
  getPlanByMonth,
  listPlans,
  updateSavingsTarget,
  currentMonthKeyAthens,
  nextMonthKey,
  prevMonthKey,
  PlanNotFoundError,
  PlanConflictError,
  PlanValidationError,
} from "../../lib/months/service";

let ctx: MonthsTestContext;

beforeAll(async () => {
  ctx = await setupMonthsSchema();
});

afterAll(async () => {
  await teardownMonthsSchema(ctx);
});

describe("Step08 monthly plans: create and uniqueness", () => {
  it("creates a plan with a savings target", async () => {
    const { plan, generated } = await createPlan(ctx.userA, {
      monthKey: "2026-03",
      savingsTargetCents: 500000,
    });
    expect(plan.id).toBeTruthy();
    expect(plan.monthKey).toBe("2026-03");
    expect(plan.savingsTargetCents).toBe(500000);
    expect(plan.status).toBe("open");
    expect(plan.closedAt).toBe(null);
    expect(generated).toBe(false);
  });

  it("rejects duplicate plan for same owner+month", async () => {
    await createPlan(ctx.userA, {
      monthKey: "2026-04",
      savingsTargetCents: 100000,
    });
    await expect(
      createPlan(ctx.userA, {
        monthKey: "2026-04",
        savingsTargetCents: 200000,
      }),
    ).rejects.toThrow(PlanConflictError);
  });

  it("allows same month for different owners", async () => {
    const { plan: planA } = await createPlan(ctx.userA, {
      monthKey: "2026-05",
      savingsTargetCents: 100000,
    });
    const { plan: planB } = await createPlan(ctx.userB, {
      monthKey: "2026-05",
      savingsTargetCents: 200000,
    });
    expect(planA.id).not.toBe(planB.id);
    expect(planA.savingsTargetCents).toBe(100000);
    expect(planB.savingsTargetCents).toBe(200000);
  });

  it("accepts target 0 as explicit", async () => {
    const { plan } = await createPlan(ctx.userA, {
      monthKey: "2026-06",
      savingsTargetCents: 0,
    });
    expect(plan.savingsTargetCents).toBe(0);
  });

  it("rejects negative savings target", async () => {
    await expect(
      createPlan(ctx.userA, {
        monthKey: "2026-07",
        savingsTargetCents: -100,
      }),
    ).rejects.toThrow(PlanValidationError);
  });

  it("rejects invalid month key format", async () => {
    await expect(
      createPlan(ctx.userA, {
        monthKey: "2026-13",
        savingsTargetCents: 0,
      }),
    ).rejects.toThrow(PlanValidationError);
  });
});

describe("Step08 monthly plans: getOrCreate idempotency", () => {
  it("creates on first call, returns existing on second", async () => {
    const first = await getOrCreatePlan(ctx.userA, "2026-08", 300000);
    expect(first.generated).toBe(true);
    expect(first.plan.savingsTargetCents).toBe(300000);

    const second = await getOrCreatePlan(ctx.userA, "2026-08", 999999);
    expect(second.generated).toBe(false);
    expect(second.plan.savingsTargetCents).toBe(300000);
    expect(second.plan.id).toBe(first.plan.id);
  });

  it("handles concurrent getOrCreate for the same month", async () => {
    const results = await Promise.all([
      getOrCreatePlan(ctx.userA, "2026-09", 100000),
      getOrCreatePlan(ctx.userA, "2026-09", 100000),
      getOrCreatePlan(ctx.userA, "2026-09", 100000),
    ]);
    const ids = results.map((r) => r.plan.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(1);
    const generatedCount = results.filter((r) => r.generated).length;
    expect(generatedCount).toBe(1);
  });
});

describe("Step08 monthly plans: get and list", () => {
  it("gets a plan by ID (owner-scoped)", async () => {
    const { plan } = await createPlan(ctx.userA, {
      monthKey: "2026-10",
      savingsTargetCents: 50000,
    });
    const fetched = await getPlan(ctx.userA, plan.id);
    expect(fetched.id).toBe(plan.id);
    expect(fetched.monthKey).toBe("2026-10");
  });

  it("rejects cross-owner plan access by ID", async () => {
    const { plan } = await createPlan(ctx.userA, {
      monthKey: "2026-11",
      savingsTargetCents: 50000,
    });
    await expect(getPlan(ctx.userB, plan.id)).rejects.toThrow(PlanNotFoundError);
  });

  it("gets a plan by month key", async () => {
    await createPlan(ctx.userA, {
      monthKey: "2026-12",
      savingsTargetCents: 75000,
    });
    const fetched = await getPlanByMonth(ctx.userA, "2026-12");
    expect(fetched.monthKey).toBe("2026-12");
    expect(fetched.savingsTargetCents).toBe(75000);
  });

  it("lists plans ordered by month descending", async () => {
    const plans = await listPlans(ctx.userA);
    expect(plans.length).toBeGreaterThan(0);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i - 1].monthKey >= plans[i].monthKey).toBe(true);
    }
  });

  it("user B cannot see user A's plans", async () => {
    const plansA = await listPlans(ctx.userA);
    const plansB = await listPlans(ctx.userB);
    const aIds = new Set(plansA.map((p) => p.id));
    for (const p of plansB) {
      expect(aIds.has(p.id)).toBe(false);
    }
  });
});

describe("Step08 monthly plans: update savings target", () => {
  it("updates the savings target on an open plan", async () => {
    const { plan } = await createPlan(ctx.userA, {
      monthKey: "2027-01",
      savingsTargetCents: 100000,
    });
    const { plan: updated } = await updateSavingsTarget(ctx.userA, {
      planId: plan.id,
      savingsTargetCents: 250000,
    });
    expect(updated.savingsTargetCents).toBe(250000);

    const direct = await readPlanTargetDirect(ctx.pool, ctx.userA, plan.id);
    expect(direct.savingsTargetCents).toBe(250000);
  });

  it("rejects update on a non-existent plan", async () => {
    await expect(
      updateSavingsTarget(ctx.userA, {
        planId: "999999999",
        savingsTargetCents: 100000,
      }),
    ).rejects.toThrow(PlanNotFoundError);
  });

  it("rejects cross-owner target update", async () => {
    const { plan } = await createPlan(ctx.userA, {
      monthKey: "2027-02",
      savingsTargetCents: 100000,
    });
    await expect(
      updateSavingsTarget(ctx.userB, {
        planId: plan.id,
        savingsTargetCents: 999999,
      }),
    ).rejects.toThrow(PlanNotFoundError);
  });

  it("rejects negative target on update", async () => {
    const { plan } = await createPlan(ctx.userA, {
      monthKey: "2027-03",
      savingsTargetCents: 100000,
    });
    await expect(
      updateSavingsTarget(ctx.userA, {
        planId: plan.id,
        savingsTargetCents: -1,
      }),
    ).rejects.toThrow(PlanValidationError);
  });
});

describe("Step08 monthly plans: month boundary helpers", () => {
  it("currentMonthKeyAthens returns a valid YYYY-MM", async () => {
    const key = currentMonthKeyAthens();
    expect(key).toMatch(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
  });

  it("nextMonthKey handles year rollover", async () => {
    expect(nextMonthKey("2026-12")).toBe("2027-01");
    expect(nextMonthKey("2026-01")).toBe("2026-02");
    expect(nextMonthKey("2026-06")).toBe("2026-07");
  });

  it("prevMonthKey handles year rollover", async () => {
    expect(prevMonthKey("2026-01")).toBe("2025-12");
    expect(prevMonthKey("2026-12")).toBe("2026-11");
    expect(prevMonthKey("2026-06")).toBe("2026-05");
  });
});

describe("Step08 monthly plans: two-user isolation", () => {
  it("user A and B have separate plan counts", async () => {
    const beforeA = await countPlans(ctx.pool, ctx.userA);
    const beforeB = await countPlans(ctx.pool, ctx.userB);
    await createPlan(ctx.userB, {
      monthKey: "2027-06",
      savingsTargetCents: 100000,
    });
    const afterA = await countPlans(ctx.pool, ctx.userA);
    const afterB = await countPlans(ctx.pool, ctx.userB);
    expect(afterA).toBe(beforeA);
    expect(afterB).toBe(beforeB + 1);
  });
});