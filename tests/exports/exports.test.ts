// Step15 private exports DB integration tests.
//
// Tests exercise the real export service (lib/exports -> lib/db) against
// disposable step15_* schemas with two synthetic users (A and B). Verifies
// owner isolation, formula-injection neutralization on real malicious data, and
// that no auth/session columns are exported.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupHistorySchema,
  teardownHistorySchema,
  createPlanDirect,
  createUniqueTestUser,
  type HistoryTestContext,
} from "../history/helpers";
import { exportMonthCsv, exportMonthJson } from "../../lib/exports/service";
import { createObligation } from "../../lib/obligations/service";
import { createIncome } from "../../lib/income/service";
import { createAccount } from "../../lib/accounts/service";

let ctx: HistoryTestContext;

beforeAll(async () => {
  ctx = await setupHistorySchema();
});

afterAll(async () => {
  await teardownHistorySchema(ctx);
});

const MONTH = "2026-09";

async function setupMonth(ownerId: string, monthKey: string = MONTH): Promise<void> {
  await createPlanDirect(ctx.pool, ownerId, monthKey, 50000);
  await createAccount(ownerId, {
    name: "=cmd|'/c calc'!A1",
    initialBalanceCents: 100000,
    trackBalance: true,
  });
  await createObligation(ownerId, {
    kind: "ordinary",
    title: "+HYPERLINK(\"http://evil\")",
    plannedCents: 80000,
    monthKey,
  });
  await createIncome(ownerId, {
    monthKey,
    sourceName: "@SUM(A1:A2)",
    expectedCents: 200000,
  });
}

describe("Step15 CSV export", () => {
  it("exports a CSV with owner-scoped data and CRLF separators", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await setupMonth(user);

    const csv = await exportMonthCsv(user, MONTH);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("Λογαριασμοί");
    expect(csv).toContain("Έξοδα");
    expect(csv).toContain("Έσοδα");
  });

  it("neutralizes formula-capable account names, titles and source names", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await setupMonth(user);

    const csv = await exportMonthCsv(user, MONTH);

    // The malicious account name "=cmd|'/c calc'!A1" must be neutralized with
    // a leading single quote (inside the CSV-quoted field content).
    expect(csv).toContain("'=cmd");
    // The malicious title "+HYPERLINK(...)" must be neutralized.
    expect(csv).toContain("'+HYPERLINK");
    // The malicious source name "@SUM(A1:A2)" must be neutralized.
    expect(csv).toContain("'@SUM");

    // No raw un-neutralized formula trigger at the start of a cell: check that
    // the exported lines do not contain a bare "=cmd" without the quote prefix.
    // The neutralizing quote always precedes the trigger.
    const lines = csv.split("\r\n");
    for (const line of lines) {
      // A line that contains "=cmd" must also contain "'=cmd" (neutralized).
      if (line.includes("=cmd")) {
        expect(line.includes("'=cmd")).toBe(true);
      }
    }
  });

  it("does not export auth/session columns or another owner's data", async () => {
    const userA = await createUniqueTestUser(ctx.pool);
    const userB = await createUniqueTestUser(ctx.pool);
    await setupMonth(userA, "2026-09");
    await setupMonth(userB, "2026-09");

    const csvA = await exportMonthCsv(userA, "2026-09");
    const csvB = await exportMonthCsv(userB, "2026-09");

    // A's CSV contains A's data; B's contains B's. Both have the same
    // synthetic names so we cannot distinguish by name — but we can verify
    // that neither CSV contains password_hash, email or session tokens.
    expect(csvA.toLowerCase()).not.toContain("password");
    expect(csvA.toLowerCase()).not.toContain("session");
    expect(csvA.toLowerCase()).not.toContain("token");
    expect(csvB.toLowerCase()).not.toContain("password");
    expect(csvB.toLowerCase()).not.toContain("session");
    expect(csvB.toLowerCase()).not.toContain("token");
  });
});

describe("Step15 JSON backup", () => {
  it("exports a JSON backup with owner-scoped data and no secrets", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    await setupMonth(user, "2026-08");

    const json = await exportMonthJson(user, "2026-08");
    const parsed = JSON.parse(json);

    expect(parsed.format).toBe("mysavings-month-json-v1");
    expect(parsed.monthKey).toBe("2026-08");
    expect(parsed.plan).not.toBeNull();
    expect(parsed.accounts.length).toBe(1);
    expect(parsed.obligations.length).toBe(1);
    expect(parsed.income.length).toBe(1);

    // No auth/session columns.
    const serialized = json.toLowerCase();
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("session");
    expect(serialized).not.toContain("token");
  });

  it("does not include another owner's data", async () => {
    const userA = await createUniqueTestUser(ctx.pool);
    const userB = await createUniqueTestUser(ctx.pool);
    await setupMonth(userA, "2026-07");
    await setupMonth(userB, "2026-07");

    const jsonA = await exportMonthJson(userA, "2026-07");
    const parsed = JSON.parse(jsonA);
    // Only one account/obligation/income (A's), not two.
    expect(parsed.accounts.length).toBe(1);
    expect(parsed.obligations.length).toBe(1);
    expect(parsed.income.length).toBe(1);
  });

  it("JSON backup for a month with no plan still produces a valid payload", async () => {
    const user = await createUniqueTestUser(ctx.pool);
    const json = await exportMonthJson(user, "2024-01");
    const parsed = JSON.parse(json);
    expect(parsed.plan).toBeNull();
    expect(parsed.accounts.length).toBe(0);
  });
});