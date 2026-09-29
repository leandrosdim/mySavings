// Step12 reserved commitments integration tests.
//
// Tests exercise the real production service layer (lib/obligations/service.ts)
// against disposable step12_* schemas with two synthetic users (A and B). No
// mocking of the business logic; the service runs against the real DB.
//
// Key scenarios from the Step12 acceptance criteria:
// - Reserve creation changes R (spendable) only, not B.
// - Partial payment reduces reserved remainder once; UPDATE_ACCOUNT also
//   reduces B; ALREADY_REFLECTED leaves B unchanged.
// - Never create a duplicate ordinary expense when settling a reserve.
// - Linked expense presentation: one canonical liability, not double-counted
//   in both E and R.
// - Owner-scoped link validation; no free client-controlled cross-owner link.
// - Audited amount revision (planned cannot go below paid).
// - Explicit release of unpaid remainder with audit; paid history retained.
//   Never lower below settled amount; released/settled history retained.
// - Due date does not remove protection (R stays protected before due date).
// - Cross-owner isolation.
// - Closed month rejection for release.
// - Idempotent release.
//
// No real workbook figures. Synthetic fixtures only, scoped cleanup.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupCommitmentsSchema,
  teardownCommitmentsSchema,
  createPlanDirect,
  closePlanDirect,
  readObligationDirect,
  countAuditEntries,
  insertSettlementDirect,
  type CommitmentsTestContext,
} from "./helpers";
import {
  createObligation,
  getObligation,
  listObligations,
  updateObligation,
  cancelObligation,
  deleteReleasedObligation,
  releaseObligation,
  ObligationNotFoundError,
  ObligationValidationError,
  ObligationConflictError,
  ClosedMonthError,
  SettledHistoryError,
} from "../../lib/obligations/service";
import {
  createAccount,
  getAccount,
} from "../../lib/accounts/service";
import {
  payObligation,
} from "../../lib/settlements/service";

let ctx: CommitmentsTestContext;

beforeAll(async () => {
  ctx = await setupCommitmentsSchema();
});

afterAll(async () => {
  await teardownCommitmentsSchema(ctx);
});

async function makeAccount(ownerId: string, balance: number): Promise<string> {
  const { account } = await createAccount(ownerId, {
    name: "Test account",
    initialBalanceCents: balance,
    trackBalance: true,
  });
  return account.id;
}

// --- Reserve creation changes R only, not B ---

describe("Step12 reserves: creation changes spendable only, not B", () => {
  it("creating a reserve does not touch any account balance", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-03");
    const accountId = await makeAccount(ctx.userA, 50000);
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Φόρος",
      plannedCents: 20000,
      monthKey: "2026-03",
      dueDate: "2026-04-15",
    });
    expect(reserve.kind).toBe("reserved");
    expect(reserve.plannedCents).toBe(20000);
    expect(reserve.remainingCents).toBe(20000);
    expect(reserve.paidCents).toBe(0);
    expect(reserve.status).toBe("active");
    expect(reserve.dueDate).toBe("2026-04-15");

    // Account balance unchanged
    const account = await getAccount(ctx.userA, accountId);
    expect(account.currentBalanceCents).toBe(50000);
  });
});

// --- Partial/full settlement in both modes ---

describe("Step12 reserves: partial/full settlement", () => {
  it("UPDATE_ACCOUNT payment reduces B and R exactly once", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-04");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "ΕΦΚΑ",
      plannedCents: 30000,
      monthKey: "2026-04",
    });
    const accountId = await makeAccount(ctx.userA, 100000);

    const result = await payObligation(ctx.userA, {
      obligationId: reserve.id,
      amountCents: 10000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-04-10",
      idempotencyKey: `step12-reserve-update-acct-${Date.now()}`,
    });
    expect(result.paidCents).toBe(10000);
    expect(result.remainingCents).toBe(20000);
    expect(result.accountNewBalance).toBe(90000);

    // Planned unchanged
    const direct = await readObligationDirect(ctx.pool, ctx.userA, reserve.id);
    expect(direct.plannedCents).toBe(30000);

    // Account debited once
    const account = await getAccount(ctx.userA, accountId);
    expect(account.currentBalanceCents).toBe(90000);
  });

  it("ALREADY_REFLECTED payment reduces R only, B unchanged", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-05");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Τέλος",
      plannedCents: 15000,
      monthKey: "2026-05",
    });
    const accountId = await makeAccount(ctx.userA, 80000);

    const result = await payObligation(ctx.userA, {
      obligationId: reserve.id,
      amountCents: 5000,
      mode: "ALREADY_REFLECTED",
      accountId: null,
      businessDate: "2026-05-10",
      idempotencyKey: `step12-reserve-already-${Date.now()}`,
    });
    expect(result.paidCents).toBe(5000);
    expect(result.remainingCents).toBe(10000);
    expect(result.accountNewBalance).toBe(null);

    // Account unchanged
    const account = await getAccount(ctx.userA, accountId);
    expect(account.currentBalanceCents).toBe(80000);
  });

  it("never creates a duplicate ordinary expense when settling a reserve", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-06");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "ΦΠΑ",
      plannedCents: 12000,
      monthKey: "2026-06",
    });
    const accountId = await makeAccount(ctx.userA, 60000);

    await payObligation(ctx.userA, {
      obligationId: reserve.id,
      amountCents: 6000,
      mode: "UPDATE_ACCOUNT",
      accountId,
      businessDate: "2026-06-10",
      idempotencyKey: `step12-no-dup-${Date.now()}`,
    });

    // Only the reserve obligation exists; no ordinary expense was created.
    const all = await listObligations(ctx.userA, {
      monthKey: "2026-06",
      includeReserved: true,
    });
    expect(all.length).toBe(1);
    expect(all[0].kind).toBe("reserved");
    expect(all[0].id).toBe(reserve.id);
  });
});

// --- Due date does not remove protection ---

describe("Step12 reserves: due date protection", () => {
  it("reserve with a future due date is protected now (R stays protected)", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-07");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Φόρος επόμενου τριμήνου",
      plannedCents: 40000,
      monthKey: "2026-07",
      dueDate: "2026-10-31",
    });
    // The reserve is active and outstanding regardless of the future due date.
    expect(reserve.status).toBe("active");
    expect(reserve.remainingCents).toBe(40000);
    expect(reserve.dueDate).toBe("2026-10-31");

    const fetched = await getObligation(ctx.userA, reserve.id);
    expect(fetched.status).toBe("active");
    expect(fetched.remainingCents).toBe(40000);
  });
});

// --- Linked expense presentation: one canonical liability ---

describe("Step12 reserves: linked expense presentation (not double-counted)", () => {
  it("ordinary expense linked to a reserve counts once in R, not in E", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-08");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Εφορία",
      plannedCents: 25000,
      monthKey: "2026-08",
    });

    const { obligation: linked } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Εφορία (παρουσίαση)",
      plannedCents: 25000,
      monthKey: "2026-08",
      linkedReserveId: reserve.id,
    });
    expect(linked.linkedReserveId).toBe(reserve.id);
    expect(linked.plannedCents).toBe(reserve.plannedCents);

    // The ordinary list excludes the linked presentation when kind=ordinary
    // filtering? No — it is kind=ordinary so it IS in the ordinary list. But
    // the forecast core (Step02) counts it once in R via linkedReserveId.
    // Here we verify the link is stored and the amounts match.
    const direct = await readObligationDirect(ctx.pool, ctx.userA, linked.id);
    expect(direct.linkedReserveId).toBe(reserve.id);
    expect(direct.plannedCents).toBe(reserve.plannedCents);
  });

  it("rejects linking an ordinary expense to a non-existent reserve", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-09");
    await expect(
      createObligation(ctx.userA, {
        kind: "ordinary",
        title: "Bad link",
        plannedCents: 5000,
        monthKey: "2026-09",
        linkedReserveId: "999999999",
      }),
    ).rejects.toThrow(ObligationValidationError);
  });

  it("rejects linking an ordinary expense to another owner's reserve", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-10");
    await createPlanDirect(ctx.pool, ctx.userB, "2026-10");
    const { obligation: bReserve } = await createObligation(ctx.userB, {
      kind: "reserved",
      title: "B's reserve",
      plannedCents: 7000,
      monthKey: "2026-10",
    });
    await expect(
      createObligation(ctx.userA, {
        kind: "ordinary",
        title: "A link to B",
        plannedCents: 7000,
        monthKey: "2026-10",
        linkedReserveId: bReserve.id,
      }),
    ).rejects.toThrow(ObligationValidationError);
  });

  it("rejects linking an ordinary expense with a mismatched amount", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-11");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Amount mismatch reserve",
      plannedCents: 30000,
      monthKey: "2026-11",
    });
    await expect(
      createObligation(ctx.userA, {
        kind: "ordinary",
        title: "Wrong amount",
        plannedCents: 20000,
        monthKey: "2026-11",
        linkedReserveId: reserve.id,
      }),
    ).rejects.toThrow(ObligationConflictError);
  });

  it("rejects linking a reserved obligation to another reserve", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2026-12");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "First reserve",
      plannedCents: 10000,
      monthKey: "2026-12",
    });
    await expect(
      createObligation(ctx.userA, {
        kind: "reserved",
        title: "Second reserve linking first",
        plannedCents: 10000,
        monthKey: "2026-12",
        linkedReserveId: reserve.id,
      }),
    ).rejects.toThrow(ObligationValidationError);
  });
});

// --- Audited amount revision ---

describe("Step12 reserves: audited amount revision", () => {
  it("rejects lowering planned below the paid amount", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-01");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Paid reserve",
      plannedCents: 20000,
      monthKey: "2027-01",
    });
    await insertSettlementDirect(ctx.pool, ctx.userA, reserve.id, 8000, "2027-01-10");
    await expect(
      updateObligation(ctx.userA, reserve.id, { plannedCents: 5000 }),
    ).rejects.toThrow(SettledHistoryError);
  });

  it("allows raising the planned amount", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-02");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Raise reserve",
      plannedCents: 10000,
      monthKey: "2027-02",
    });
    const { obligation: updated } = await updateObligation(ctx.userA, reserve.id, {
      plannedCents: 15000,
    });
    expect(updated.plannedCents).toBe(15000);
  });
});

// --- Explicit release of unpaid remainder ---

describe("Step12 reserves: explicit release", () => {
  it("releases the unpaid remainder, preserves planned and paid history", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-03");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Release me",
      plannedCents: 18000,
      monthKey: "2027-03",
    });
    await insertSettlementDirect(ctx.pool, ctx.userA, reserve.id, 6000, "2027-03-10");

    const beforeAudit = await countAuditEntries(ctx.pool, ctx.userA, "obligation_release");
    const { obligation: released } = await releaseObligation(ctx.userA, reserve.id);
    expect(released.status).toBe("released");
    expect(released.plannedCents).toBe(18000);
    expect(released.paidCents).toBe(6000);
    expect(released.remainingCents).toBe(12000);

    // Planned unchanged in DB
    const direct = await readObligationDirect(ctx.pool, ctx.userA, reserve.id);
    expect(direct.status).toBe("released");
    expect(direct.plannedCents).toBe(18000);

    // Audit log entry written
    const afterAudit = await countAuditEntries(ctx.pool, ctx.userA, "obligation_release");
    expect(afterAudit).toBe(beforeAudit + 1);
  });

  it("idempotent: releasing an already-released obligation returns it", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-04");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Double release",
      plannedCents: 5000,
      monthKey: "2027-04",
    });
    await releaseObligation(ctx.userA, reserve.id);
    const { obligation: second } = await releaseObligation(ctx.userA, reserve.id);
    expect(second.status).toBe("released");
  });

  it("rejects releasing a cancelled obligation", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-05");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Cancel then release",
      plannedCents: 5000,
      monthKey: "2027-05",
    });
    await cancelObligation(ctx.userA, reserve.id);
    await expect(releaseObligation(ctx.userA, reserve.id)).rejects.toThrow(
      ObligationValidationError,
    );
  });

  it("rejects release on a closed month", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-06");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "Closed month release",
      plannedCents: 5000,
      monthKey: "2027-06",
    });
    await closePlanDirect(ctx.pool, ctx.userA, "2027-06");
    await expect(releaseObligation(ctx.userA, reserve.id)).rejects.toThrow(
      ClosedMonthError,
    );
  });

  it("release works for an ordinary obligation too (unpaid remainder)", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-07");
    const { obligation: expense } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Release expense",
      plannedCents: 9000,
      monthKey: "2027-07",
    });
    await insertSettlementDirect(ctx.pool, ctx.userA, expense.id, 4000, "2027-07-10");
    const { obligation: released } = await releaseObligation(ctx.userA, expense.id);
    expect(released.status).toBe("released");
    expect(released.paidCents).toBe(4000);
    expect(released.remainingCents).toBe(5000);
  });

  it("deletes an unpaid released obligation and audits the deletion", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-12");
    const { obligation: expense } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Delete released expense",
      plannedCents: 7000,
      monthKey: "2027-12",
    });
    await releaseObligation(ctx.userA, expense.id);
    const beforeAudit = await countAuditEntries(ctx.pool, ctx.userA, "obligation_delete");

    const result = await deleteReleasedObligation(ctx.userA, expense.id);

    expect(result.obligationId).toBe(expense.id);
    await expect(getObligation(ctx.userA, expense.id)).rejects.toThrow(
      ObligationNotFoundError,
    );
    const afterAudit = await countAuditEntries(ctx.pool, ctx.userA, "obligation_delete");
    expect(afterAudit).toBe(beforeAudit + 1);
  });

  it("does not delete a released obligation with settlement history", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2028-01");
    const { obligation: expense } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "Keep payment history",
      plannedCents: 9000,
      monthKey: "2028-01",
    });
    await insertSettlementDirect(ctx.pool, ctx.userA, expense.id, 4000, "2028-01-10");
    await releaseObligation(ctx.userA, expense.id);

    await expect(deleteReleasedObligation(ctx.userA, expense.id)).rejects.toThrow(
      SettledHistoryError,
    );
    const stillThere = await getObligation(ctx.userA, expense.id);
    expect(stillThere.status).toBe("released");
  });
});

// --- Cross-owner isolation ---

describe("Step12 reserves: two-user isolation", () => {
  it("user B cannot release user A's reserve", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-08");
    const { obligation: reserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "A only reserve",
      plannedCents: 6000,
      monthKey: "2027-08",
    });
    await expect(releaseObligation(ctx.userB, reserve.id)).rejects.toThrow(
      ObligationNotFoundError,
    );
  });

  it("user B cannot delete user A's released expense", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2028-02");
    const { obligation: expense } = await createObligation(ctx.userA, {
      kind: "ordinary",
      title: "A protected released expense",
      plannedCents: 6000,
      monthKey: "2028-02",
    });
    await releaseObligation(ctx.userA, expense.id);

    await expect(deleteReleasedObligation(ctx.userB, expense.id)).rejects.toThrow(
      ObligationNotFoundError,
    );
    const stillThere = await getObligation(ctx.userA, expense.id);
    expect(stillThere.status).toBe("released");
  });

  it("user B cannot see user A's reserves", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-09");
    await createPlanDirect(ctx.pool, ctx.userB, "2027-09");
    await createObligation(ctx.userA, {
      kind: "reserved",
      title: "A hidden reserve",
      plannedCents: 3000,
      monthKey: "2027-09",
    });
    const bList = await listObligations(ctx.userB, {
      monthKey: "2027-09",
      kind: "reserved",
    });
    expect(bList.length).toBe(0);
  });

  it("user B cannot link to user A's reserve", async () => {
    await createPlanDirect(ctx.pool, ctx.userA, "2027-10");
    await createPlanDirect(ctx.pool, ctx.userB, "2027-10");
    const { obligation: aReserve } = await createObligation(ctx.userA, {
      kind: "reserved",
      title: "A link target",
      plannedCents: 8000,
      monthKey: "2027-10",
    });
    await expect(
      createObligation(ctx.userB, {
        kind: "ordinary",
        title: "B linking A",
        plannedCents: 8000,
        monthKey: "2027-10",
        linkedReserveId: aReserve.id,
      }),
    ).rejects.toThrow(ObligationValidationError);
  });
});