// Step09 obligation service integration tests.
//
// Tests exercise the real production service layer (lib/obligations/service.ts)
// against disposable step09_* schemas with two synthetic users (A and B).
// No mocking of the business logic; the service runs against the real DB.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupPlansSchema,
  teardownPlansSchema,
  readObligationDirect,
  countObligations,
  insertSettlementDirect,
  insertSettlementReversalDirect,
  readSettlementIdDirect,
  createPlanDirect,
  closePlanDirect,
  type PlansTestContext,
} from "./helpers";
import {
  createObligation,
  getObligation,
  listObligations,
  updateObligation,
  cancelObligation,
  ObligationNotFoundError,
  ObligationValidationError,
  ObligationConflictError,
  ClosedMonthError,
  SettledHistoryError,
} from "../../lib/obligations/service";

let ctx: PlansTestContext;

beforeAll(async () => {
  ctx = await setupPlansSchema();
});

afterAll(async () => {
  await teardownPlansSchema(ctx);
});

describe("Step09 obligations: create", () => {
  it("creates an ordinary obligation with a planned amount", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-03");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Ενοίκιο",
      plannedCents: 80000,
      monthKey: "2026-03",
    });
    expect(obligation.id).toBeTruthy();
    expect(obligation.kind).toBe("ordinary");
    expect(obligation.title).toBe("Ενοίκιο");
    expect(obligation.plannedCents).toBe(80000);
    expect(obligation.paidCents).toBe(0);
    expect(obligation.remainingCents).toBe(80000);
    expect(obligation.status).toBe("active");

    const direct = await readObligationDirect(ctx.pool, ctx.userA, obligation.id);
    expect(direct.plannedCents).toBe(80000);
    expect(direct.kind).toBe("ordinary");
  });

  it("creates a reserved obligation (commitment)", async () => {
    const { obligation } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Φόρος",
      plannedCents: 50000,
      monthKey: "2026-03",
    });
    expect(obligation.kind).toBe("reserved");
  });

  it("creates a gas envelope (variable monthly budget, not week-multiplied)", async () => {
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Βενζίνη",
      plannedCents: 8000,
      monthKey: "2026-03",
    });
    // Gas plan remains 80 until payments arrive in Step10.
    expect(obligation.plannedCents).toBe(8000);
    expect(obligation.paidCents).toBe(0);
    expect(obligation.remainingCents).toBe(8000);
  });

  it("rejects invalid kind (income not allowed)", async () => {
    await expect(
      createObligation(ctx.userA, {
        kind: "income" as never,
        title: "Test",
        plannedCents: 1000,
        monthKey: "2026-03",
      }),
    ).rejects.toThrow(ObligationValidationError);
  });

  it("rejects negative planned amount", async () => {
    await expect(
      createObligation(ctx.userA, {
        kind: "ordinary",
        title: "Test",
        plannedCents: -100,
        monthKey: "2026-03",
      }),
    ).rejects.toThrow(ObligationValidationError);
  });

  it("rejects empty title", async () => {
    await expect(
      createObligation(ctx.userA, {
        kind: "ordinary",
        title: "   ",
        plannedCents: 1000,
        monthKey: "2026-03",
      }),
    ).rejects.toThrow(ObligationValidationError);
  });

  it("rejects invalid month key format", async () => {
    await expect(
      createObligation(ctx.userA, {
        kind: "ordinary",
        title: "Test",
        plannedCents: 1000,
        monthKey: "2026-13",
      }),
    ).rejects.toThrow(ObligationValidationError);
  });

  it("rejects invalid due date", async () => {
    await expect(
      createObligation(ctx.userA, {
        kind: "ordinary",
        title: "Test",
        plannedCents: 1000,
        monthKey: "2026-03",
        dueDate: "2026-02-30",
      }),
    ).rejects.toThrow(ObligationValidationError);
  });

  it("rejects creation when no plan exists for the month", async () => {
    await expect(
      createObligation(ctx.userA, {
        kind: "ordinary",
        title: "No plan month",
        plannedCents: 1000,
        monthKey: "2025-01",
      }),
    ).rejects.toThrow(ObligationValidationError);
  });

  it("accepts a valid due date", async () => {
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "With due date",
      plannedCents: 1000,
      monthKey: "2026-03",
      dueDate: "2026-03-15",
    });
    expect(obligation.dueDate).toBe("2026-03-15");
  });
});

describe("Step09 obligations: get and list", () => {
  it("gets an obligation by ID (owner-scoped)", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-04");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Test get",
      plannedCents: 5000,
      monthKey: "2026-04",
    });
    const fetched = await getObligation(ctx.userA, obligation.id);
    expect(fetched.id).toBe(obligation.id);
    expect(fetched.title).toBe("Test get");
  });

  it("rejects cross-owner obligation access by ID", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-05");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Cross owner",
      plannedCents: 5000,
      monthKey: "2026-05",
    });
    await expect(getObligation(ctx.userB, obligation.id)).rejects.toThrow(
      ObligationNotFoundError,
    );
  });

  it("lists obligations filtered by month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-06");
    await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "June expense 1",
      plannedCents: 1000,
      monthKey: "2026-06",
    });
    await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "June expense 2",
      plannedCents: 2000,
      monthKey: "2026-06",
    });
    const list = await listObligations(ctx.userA, { monthKey: "2026-06" });
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const o of list) {
      expect(o.currentMonthKey).toBe("2026-06");
    }
  });

  it("excludes reserved from ordinary expense list by default", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-07");
    await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Ordinary July",
      plannedCents: 1000,
      monthKey: "2026-07",
    });
    await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Reserved July",
      plannedCents: 2000,
      monthKey: "2026-07",
    });
    const ordinaryList = await listObligations(ctx.userA, { monthKey: "2026-07" });
    for (const o of ordinaryList) {
      expect(o.kind).not.toBe("reserved");
    }
    const reservedList = await listObligations(ctx.userA, {
      monthKey: "2026-07",
      kind: "reserved",
    });
    for (const o of reservedList) {
      expect(o.kind).toBe("reserved");
    }
    const allList = await listObligations(ctx.userA, {
      monthKey: "2026-07",
      includeReserved: true,
    });
    const kinds = allList.map((o) => o.kind);
    expect(kinds).toContain("ordinary");
    expect(kinds).toContain("reserved");
  });

  it("user B cannot see user A's obligations", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-08");
    await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "A only",
      plannedCents: 1000,
      monthKey: "2026-08",
    });
    const listB = await listObligations(ctx.userB, { monthKey: "2026-08" });
    expect(listB.length).toBe(0);
  });
});

describe("Step09 obligations: update and revision rules", () => {
  it("updates the title", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-09");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Original title",
      plannedCents: 5000,
      monthKey: "2026-09",
    });
    const { obligation: updated } = await updateObligation(ctx.userA, obligation.id, {
      title: "Updated title",
    });
    expect(updated.title).toBe("Updated title");
    expect(updated.plannedCents).toBe(5000);
  });

  it("updates the planned amount upward", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-10");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Amount update",
      plannedCents: 5000,
      monthKey: "2026-10",
    });
    const { obligation: updated } = await updateObligation(ctx.userA, obligation.id, {
      plannedCents: 8000,
    });
    expect(updated.plannedCents).toBe(8000);
  });

  it("rejects lowering planned below paid amount", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-11");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Paid obligation",
      plannedCents: 10000,
      monthKey: "2026-11",
    });
    // Insert a settlement directly to simulate a payment.
    await insertSettlementDirect(ctx.pool, ctx.userA, obligation.id, 6000, "2026-11-10");

    await expect(
      updateObligation(ctx.userA, obligation.id, { plannedCents: 5000 }),
    ).rejects.toThrow(SettledHistoryError);
  });

  it("allows lowering planned to exactly the paid amount", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-12");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Exact paid",
      plannedCents: 10000,
      monthKey: "2026-12",
    });
    await insertSettlementDirect(ctx.pool, ctx.userA, obligation.id, 6000, "2026-12-10");
    const { obligation: updated } = await updateObligation(ctx.userA, obligation.id, {
      plannedCents: 6000,
    });
    expect(updated.plannedCents).toBe(6000);
    expect(updated.paidCents).toBe(6000);
    expect(updated.remainingCents).toBe(0);
  });

  it("preserves paid history: planned stays after partial payment", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-01");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Preserve plan",
      plannedCents: 8000,
      monthKey: "2027-01",
    });
    await insertSettlementDirect(ctx.pool, ctx.userA, obligation.id, 3000, "2027-01-10");
    const fetched = await getObligation(ctx.userA, obligation.id);
    // Gas plan remains 80 until payments; partial payment does not zero planned.
    expect(fetched.plannedCents).toBe(8000);
    expect(fetched.paidCents).toBe(3000);
    expect(fetched.remainingCents).toBe(5000);
  });

  it("rejects update on non-existent obligation", async () => {
    await expect(
      updateObligation(ctx.userA, "999999999", { title: "No such" }),
    ).rejects.toThrow(ObligationNotFoundError);
  });

  it("rejects cross-owner update", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-02");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "A only update",
      plannedCents: 5000,
      monthKey: "2027-02",
    });
    await expect(
      updateObligation(ctx.userB, obligation.id, { title: "B hack" }),
    ).rejects.toThrow(ObligationNotFoundError);
  });

  it("rejects empty update (no fields)", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-03");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Empty update",
      plannedCents: 5000,
      monthKey: "2027-03",
    });
    await expect(updateObligation(ctx.userA, obligation.id, {})).rejects.toThrow(
      ObligationValidationError,
    );
  });
});

describe("Step09 obligations: cancel", () => {
  it("cancels an obligation with no settlements", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-04");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Cancel me",
      plannedCents: 5000,
      monthKey: "2027-04",
    });
    const { obligation: cancelled } = await cancelObligation(ctx.userA, obligation.id);
    expect(cancelled.status).toBe("cancelled");

    const direct = await readObligationDirect(ctx.pool, ctx.userA, obligation.id);
    expect(direct.status).toBe("cancelled");
  });

  it("rejects cancellation of an obligation with settlements", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-05");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Paid cancel",
      plannedCents: 10000,
      monthKey: "2027-05",
    });
    await insertSettlementDirect(ctx.pool, ctx.userA, obligation.id, 5000, "2027-05-10");
    await expect(cancelObligation(ctx.userA, obligation.id)).rejects.toThrow(
      SettledHistoryError,
    );
  });

  it("idempotent: cancelling an already-cancelled obligation returns it", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-06");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Double cancel",
      plannedCents: 5000,
      monthKey: "2027-06",
    });
    await cancelObligation(ctx.userA, obligation.id);
    const { obligation: second } = await cancelObligation(ctx.userA, obligation.id);
    expect(second.status).toBe("cancelled");
  });

  it("rejects cross-owner cancellation", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-07");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "A only cancel",
      plannedCents: 5000,
      monthKey: "2027-07",
    });
    await expect(cancelObligation(ctx.userB, obligation.id)).rejects.toThrow(
      ObligationNotFoundError,
    );
  });
});

describe("Step09 obligations: paid/remaining derivation from settlements", () => {
  it("computes paid from non-reversed settlements", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-08");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Multi payment",
      plannedCents: 10000,
      monthKey: "2027-08",
    });
    await insertSettlementDirect(ctx.pool, ctx.userA, obligation.id, 3000, "2027-08-10");
    await insertSettlementDirect(ctx.pool, ctx.userA, obligation.id, 2000, "2027-08-15");
    const fetched = await getObligation(ctx.userA, obligation.id);
    expect(fetched.paidCents).toBe(5000);
    expect(fetched.remainingCents).toBe(5000);
  });

  it("excludes reversed settlements from paid total", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-09");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Reversed payment",
      plannedCents: 10000,
      monthKey: "2027-09",
    });
    await insertSettlementDirect(ctx.pool, ctx.userA, obligation.id, 4000, "2027-09-10");
    const settlementId = await readSettlementIdDirect(ctx.pool, ctx.userA, obligation.id);
    expect(settlementId).not.toBeNull();
    await insertSettlementReversalDirect(ctx.pool, ctx.userA, settlementId!, "2027-09-12");
    const fetched = await getObligation(ctx.userA, obligation.id);
    expect(fetched.paidCents).toBe(0);
    expect(fetched.remainingCents).toBe(10000);
  });
});

describe("Step09 obligations: closed month rejection", () => {
  it("rejects creation on a closed month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-10");
    await closePlanDirect(ctx.pool, ctx.userA, "2027-10");
    await expect(
      createObligation(ctx.userA, {
        kind: "ordinary",
        title: "Closed month",
        plannedCents: 5000,
        monthKey: "2027-10",
      }),
    ).rejects.toThrow(ClosedMonthError);
  });

  it("rejects update on a closed month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-11");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Will be closed",
      plannedCents: 5000,
      monthKey: "2027-11",
    });
    await closePlanDirect(ctx.pool, ctx.userA, "2027-11");
    await expect(
      updateObligation(ctx.userA, obligation.id, { title: "After close" }),
    ).rejects.toThrow(ClosedMonthError);
  });

  it("rejects cancellation on a closed month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-12");
    const { obligation } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Closed cancel",
      plannedCents: 5000,
      monthKey: "2027-12",
    });
    await closePlanDirect(ctx.pool, ctx.userA, "2027-12");
    await expect(cancelObligation(ctx.userA, obligation.id)).rejects.toThrow(
      ClosedMonthError,
    );
  });
});

describe("Step09 obligations: two-user isolation", () => {
  it("user A and B have separate obligation counts", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2028-01");
    await createPlanDirect(ctx.pool, ctx.userB, "2028-01");
    const beforeA = await countObligations(ctx.pool, ctx.userA, "2028-01");
    const beforeB = await countObligations(ctx.pool, ctx.userB, "2028-01");
    await createObligation(ctx.userB, {
      kind: "ordinary",
      title: "B only",
      plannedCents: 1000,
      monthKey: "2028-01",
    });
    const afterA = await countObligations(ctx.pool, ctx.userA, "2028-01");
    const afterB = await countObligations(ctx.pool, ctx.userB, "2028-01");
    expect(afterA).toBe(beforeA);
    expect(afterB).toBe(beforeB + 1);
  });
});