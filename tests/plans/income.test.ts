// Step09 income expectation service integration tests.
//
// Tests exercise the real production service layer (lib/income/service.ts)
// against disposable step09_* schemas with two synthetic users (A and B).
// No mocking of the business logic; the service runs against the real DB.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupPlansSchema,
  teardownPlansSchema,
  readIncomeDirect,
  countIncomeExpectations,
  insertReceiptDirect,
  readReceiptIdDirect,
  insertReceiptReversalDirect,
  createPlanDirect,
  closePlanDirect,
  type PlansTestContext,
} from "./helpers";
import {
  createIncome,
  getIncome,
  listIncome,
  updateIncome,
  cancelIncome,
  IncomeNotFoundError,
  IncomeValidationError,
  IncomeConflictError,
  IncomeClosedMonthError,
  ReceiptHistoryError,
} from "../../lib/income/service";

let ctx: PlansTestContext;

beforeAll(async () => {
  ctx = await setupPlansSchema();
});

afterAll(async () => {
  await teardownPlansSchema(ctx);
});

describe("Step09 income: create", () => {
  it("creates an income expectation with an expected amount", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-03");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2026-03",
      sourceName: "Μισθός",
      expectedCents: 150000,
    });
    expect(income.id).toBeTruthy();
    expect(income.sourceName).toBe("Μισθός");
    expect(income.expectedCents).toBe(150000);
    expect(income.receivedCents).toBe(0);
    expect(income.pendingCents).toBe(150000);
    expect(income.status).toBe("active");

    const direct = await readIncomeDirect(ctx.pool, ctx.userA, income.id);
    expect(direct.expectedCents).toBe(150000);
  });

  it("rejects negative expected amount", async () => {
    await expect(
      createIncome(ctx.userA, {
        monthKey: "2026-03",
        sourceName: "Negative",
        expectedCents: -100,
      }),
    ).rejects.toThrow(IncomeValidationError);
  });

  it("rejects empty source name", async () => {
    await expect(
      createIncome(ctx.userA, {
        monthKey: "2026-03",
        sourceName: "   ",
        expectedCents: 1000,
      }),
    ).rejects.toThrow(IncomeValidationError);
  });

  it("rejects invalid month key", async () => {
    await expect(
      createIncome(ctx.userA, {
        monthKey: "2026-13",
        sourceName: "Bad month",
        expectedCents: 1000,
      }),
    ).rejects.toThrow(IncomeValidationError);
  });

  it("rejects creation when no plan exists for the month", async () => {
    await expect(
      createIncome(ctx.userA, {
        monthKey: "2025-01",
        sourceName: "No plan",
        expectedCents: 1000,
      }),
    ).rejects.toThrow(IncomeValidationError);
  });

  it("rejects duplicate source name for same owner+month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-04");
    await createIncome(ctx.userA, {
      monthKey: "2026-04",
      sourceName: "Duplicate",
      expectedCents: 1000,
    });
    await expect(
      createIncome(ctx.userA, {
        monthKey: "2026-04",
        sourceName: "Duplicate",
        expectedCents: 2000,
      }),
    ).rejects.toThrow(IncomeConflictError);
  });

  it("allows same source name for different owners in same month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-05");
    await createPlanDirect(ctx.pool, ctx.userB, "2026-05");
    const { income: a } = await createIncome(ctx.userA, {
      monthKey: "2026-05",
      sourceName: "Same source",
      expectedCents: 1000,
    });
    const { income: b } = await createIncome(ctx.userB, {
      monthKey: "2026-05",
      sourceName: "Same source",
      expectedCents: 2000,
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe("Step09 income: get and list", () => {
  it("gets an income by ID (owner-scoped)", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-06");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2026-06",
      sourceName: "Get test",
      expectedCents: 5000,
    });
    const fetched = await getIncome(ctx.userA, income.id);
    expect(fetched.id).toBe(income.id);
    expect(fetched.sourceName).toBe("Get test");
  });

  it("rejects cross-owner income access by ID", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-07");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2026-07",
      sourceName: "A only",
      expectedCents: 5000,
    });
    await expect(getIncome(ctx.userB, income.id)).rejects.toThrow(IncomeNotFoundError);
  });

  it("lists income filtered by month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-08");
    await createIncome(ctx.userA, {
      monthKey: "2026-08",
      sourceName: "August income 1",
      expectedCents: 1000,
    });
    await createIncome(ctx.userA, {
      monthKey: "2026-08",
      sourceName: "August income 2",
      expectedCents: 2000,
    });
    const list = await listIncome(ctx.userA, { monthKey: "2026-08" });
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const i of list) {
      expect(i.monthKey).toBe("2026-08");
    }
  });

  it("user B cannot see user A's income", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-09");
    await createIncome(ctx.userA, {
      monthKey: "2026-09",
      sourceName: "A only list",
      expectedCents: 1000,
    });
    const listB = await listIncome(ctx.userB, { monthKey: "2026-09" });
    expect(listB.length).toBe(0);
  });
});

describe("Step09 income: update and revision rules", () => {
  it("updates the source name", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-10");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2026-10",
      sourceName: "Original",
      expectedCents: 5000,
    });
    const { income: updated } = await updateIncome(ctx.userA, income.id, {
      sourceName: "Updated",
    });
    expect(updated.sourceName).toBe("Updated");
    expect(updated.expectedCents).toBe(5000);
  });

  it("updates the expected amount upward", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-11");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2026-11",
      sourceName: "Amount update",
      expectedCents: 5000,
    });
    const { income: updated } = await updateIncome(ctx.userA, income.id, {
      expectedCents: 8000,
    });
    expect(updated.expectedCents).toBe(8000);
  });

  it("rejects lowering expected below received amount", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-12");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2026-12",
      sourceName: "Received income",
      expectedCents: 10000,
    });
    await insertReceiptDirect(ctx.pool, ctx.userA, income.id, 6000, "2026-12-10");
    await expect(
      updateIncome(ctx.userA, income.id, { expectedCents: 5000 }),
    ).rejects.toThrow(ReceiptHistoryError);
  });

  it("allows lowering expected to exactly the received amount", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-01");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2027-01",
      sourceName: "Exact received",
      expectedCents: 10000,
    });
    await insertReceiptDirect(ctx.pool, ctx.userA, income.id, 6000, "2027-01-10");
    const { income: updated } = await updateIncome(ctx.userA, income.id, {
      expectedCents: 6000,
    });
    expect(updated.expectedCents).toBe(6000);
    expect(updated.receivedCents).toBe(6000);
    expect(updated.pendingCents).toBe(0);
  });

  it("preserves receipt history: expected stays after partial receipt", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-02");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2027-02",
      sourceName: "Preserve expected",
      expectedCents: 15000,
    });
    await insertReceiptDirect(ctx.pool, ctx.userA, income.id, 5000, "2027-02-10");
    const fetched = await getIncome(ctx.userA, income.id);
    expect(fetched.expectedCents).toBe(15000);
    expect(fetched.receivedCents).toBe(5000);
    expect(fetched.pendingCents).toBe(10000);
  });

  it("rejects update on non-existent income", async () => {
    await expect(
      updateIncome(ctx.userA, "999999999", { sourceName: "No such" }),
    ).rejects.toThrow(IncomeNotFoundError);
  });

  it("rejects cross-owner update", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-03");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2027-03",
      sourceName: "A only update",
      expectedCents: 5000,
    });
    await expect(
      updateIncome(ctx.userB, income.id, { sourceName: "B hack" }),
    ).rejects.toThrow(IncomeNotFoundError);
  });

  it("rejects empty update (no fields)", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-04");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2027-04",
      sourceName: "Empty update",
      expectedCents: 5000,
    });
    await expect(updateIncome(ctx.userA, income.id, {})).rejects.toThrow(
      IncomeValidationError,
    );
  });
});

describe("Step09 income: cancel", () => {
  it("cancels an income with no receipts", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-05");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2027-05",
      sourceName: "Cancel me",
      expectedCents: 5000,
    });
    const { income: cancelled } = await cancelIncome(ctx.userA, income.id);
    expect(cancelled.status).toBe("cancelled");

    const direct = await readIncomeDirect(ctx.pool, ctx.userA, income.id);
    expect(direct.status).toBe("cancelled");
  });

  it("rejects cancellation of an income with receipts", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-06");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2027-06",
      sourceName: "Received cancel",
      expectedCents: 10000,
    });
    await insertReceiptDirect(ctx.pool, ctx.userA, income.id, 5000, "2027-06-10");
    await expect(cancelIncome(ctx.userA, income.id)).rejects.toThrow(
      ReceiptHistoryError,
    );
  });

  it("idempotent: cancelling an already-cancelled income returns it", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-07");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2027-07",
      sourceName: "Double cancel",
      expectedCents: 5000,
    });
    await cancelIncome(ctx.userA, income.id);
    const { income: second } = await cancelIncome(ctx.userA, income.id);
    expect(second.status).toBe("cancelled");
  });

  it("rejects cross-owner cancellation", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-08");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2027-08",
      sourceName: "A only cancel",
      expectedCents: 5000,
    });
    await expect(cancelIncome(ctx.userB, income.id)).rejects.toThrow(
      IncomeNotFoundError,
    );
  });
});

describe("Step09 income: received/pending derivation from receipts", () => {
  it("computes received from non-reversed receipts", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-09");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2027-09",
      sourceName: "Multi receipt",
      expectedCents: 20000,
    });
    await insertReceiptDirect(ctx.pool, ctx.userA, income.id, 8000, "2027-09-10");
    await insertReceiptDirect(ctx.pool, ctx.userA, income.id, 4000, "2027-09-15");
    const fetched = await getIncome(ctx.userA, income.id);
    expect(fetched.receivedCents).toBe(12000);
    expect(fetched.pendingCents).toBe(8000);
  });

  it("excludes reversed receipts from received total", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-10");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2027-10",
      sourceName: "Reversed receipt",
      expectedCents: 10000,
    });
    await insertReceiptDirect(ctx.pool, ctx.userA, income.id, 6000, "2027-10-10");
    const receiptId = await readReceiptIdDirect(ctx.pool, ctx.userA, income.id);
    expect(receiptId).not.toBeNull();
    await insertReceiptReversalDirect(ctx.pool, ctx.userA, receiptId!, "2027-10-12");
    const fetched = await getIncome(ctx.userA, income.id);
    expect(fetched.receivedCents).toBe(0);
    expect(fetched.pendingCents).toBe(10000);
  });
});

describe("Step09 income: closed month rejection", () => {
  it("rejects creation on a closed month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-11");
    await closePlanDirect(ctx.pool, ctx.userA, "2027-11");
    await expect(
      createIncome(ctx.userA, {
        monthKey: "2027-11",
        sourceName: "Closed month",
        expectedCents: 5000,
      }),
    ).rejects.toThrow(IncomeClosedMonthError);
  });

  it("rejects update on a closed month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-12");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2027-12",
      sourceName: "Will be closed",
      expectedCents: 5000,
    });
    await closePlanDirect(ctx.pool, ctx.userA, "2027-12");
    await expect(
      updateIncome(ctx.userA, income.id, { sourceName: "After close" }),
    ).rejects.toThrow(IncomeClosedMonthError);
  });

  it("rejects cancellation on a closed month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2028-01");
    const { income } = await createIncome(ctx.userA, {
      monthKey: "2028-01",
      sourceName: "Closed cancel",
      expectedCents: 5000,
    });
    await closePlanDirect(ctx.pool, ctx.userA, "2028-01");
    await expect(cancelIncome(ctx.userA, income.id)).rejects.toThrow(
      IncomeClosedMonthError,
    );
  });
});

describe("Step09 income: two-user isolation", () => {
  it("user A and B have separate income counts", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2028-02");
    await createPlanDirect(ctx.pool, ctx.userB, "2028-02");
    const beforeA = await countIncomeExpectations(ctx.pool, ctx.userA, "2028-02");
    const beforeB = await countIncomeExpectations(ctx.pool, ctx.userB, "2028-02");
    await createIncome(ctx.userB, {
      monthKey: "2028-02",
      sourceName: "B only",
      expectedCents: 1000,
    });
    const afterA = await countIncomeExpectations(ctx.pool, ctx.userA, "2028-02");
    const afterB = await countIncomeExpectations(ctx.pool, ctx.userB, "2028-02");
    expect(afterA).toBe(beforeA);
    expect(afterB).toBe(beforeB + 1);
  });
});