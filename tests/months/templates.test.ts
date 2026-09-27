// Step08 recurring templates integration tests.
//
// Tests exercise the real production service layer (lib/templates/service.ts)
// against disposable step08_* schemas with two synthetic users (A and B).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupMonthsSchema,
  teardownMonthsSchema,
  type MonthsTestContext,
} from "./helpers";
import {
  createTemplate,
  getTemplate,
  listTemplates,
  listActiveTemplates,
  updateTemplate,
  deleteTemplate,
  TemplateNotFoundError,
  TemplateConflictError,
  TemplateValidationError,
} from "../../lib/templates/service";

let ctx: MonthsTestContext;

beforeAll(async () => {
  ctx = await setupMonthsSchema();
});

afterAll(async () => {
  await teardownMonthsSchema(ctx);
});

describe("Step08 templates: create and list", () => {
  it("creates an ordinary expense template", async () => {
    const { template } = await createTemplate(ctx.userA, {
      name: "Ενοίκιο",
      kind: "ordinary",
      defaultAmountCents: 800000,
      dueDayOfMonth: 5,
      active: true,
    });
    expect(template.id).toBeTruthy();
    expect(template.name).toBe("Ενοίκιο");
    expect(template.kind).toBe("ordinary");
    expect(template.defaultAmountCents).toBe(800000);
    expect(template.dueDayOfMonth).toBe(5);
    expect(template.active).toBe(true);
  });

  it("creates an income template", async () => {
    const { template } = await createTemplate(ctx.userA, {
      name: "Μισθός",
      kind: "income",
      defaultAmountCents: 2500000,
      dueDayOfMonth: null,
      active: true,
    });
    expect(template.kind).toBe("income");
    expect(template.dueDayOfMonth).toBe(null);
  });

  it("creates a reserved template", async () => {
    const { template } = await createTemplate(ctx.userA, {
      name: "Φόρος",
      kind: "reserved",
      defaultAmountCents: 300000,
      dueDayOfMonth: 15,
      active: true,
    });
    expect(template.kind).toBe("reserved");
  });

  it("rejects duplicate template name per owner", async () => {
    await createTemplate(ctx.userA, {
      name: "ΔΌΘΣ",
      kind: "ordinary",
      defaultAmountCents: 10000,
      dueDayOfMonth: null,
      active: true,
    });
    await expect(
      createTemplate(ctx.userA, {
        name: "ΔΌΘΣ",
        kind: "income",
        defaultAmountCents: 20000,
        dueDayOfMonth: null,
        active: true,
      }),
    ).rejects.toThrow(TemplateConflictError);
  });

  it("allows same template name for different owners", async () => {
    const { template: tplA } = await createTemplate(ctx.userA, {
      name: "Κοινό όνομα",
      kind: "ordinary",
      defaultAmountCents: 10000,
      dueDayOfMonth: null,
      active: true,
    });
    const { template: tplB } = await createTemplate(ctx.userB, {
      name: "Κοινό όνομα",
      kind: "ordinary",
      defaultAmountCents: 20000,
      dueDayOfMonth: null,
      active: true,
    });
    expect(tplA.id).not.toBe(tplB.id);
  });

  it("rejects invalid kind", async () => {
    await expect(
      createTemplate(ctx.userA, {
        name: "Bad kind",
        kind: "invalid" as never,
        defaultAmountCents: 100,
        dueDayOfMonth: null,
        active: true,
      }),
    ).rejects.toThrow(TemplateValidationError);
  });

  it("rejects negative default amount", async () => {
    await expect(
      createTemplate(ctx.userA, {
        name: "Negative",
        kind: "ordinary",
        defaultAmountCents: -1,
        dueDayOfMonth: null,
        active: true,
      }),
    ).rejects.toThrow(TemplateValidationError);
  });

  it("rejects due day out of range", async () => {
    await expect(
      createTemplate(ctx.userA, {
        name: "Bad day",
        kind: "ordinary",
        defaultAmountCents: 100,
        dueDayOfMonth: 32,
        active: true,
      }),
    ).rejects.toThrow(TemplateValidationError);
  });
});

describe("Step08 templates: get and list", () => {
  it("gets a template by ID (owner-scoped)", async () => {
    const { template } = await createTemplate(ctx.userA, {
      name: "Get test",
      kind: "ordinary",
      defaultAmountCents: 5000,
      dueDayOfMonth: null,
      active: true,
    });
    const fetched = await getTemplate(ctx.userA, template.id);
    expect(fetched.id).toBe(template.id);
    expect(fetched.name).toBe("Get test");
  });

  it("rejects cross-owner template access", async () => {
    const { template } = await createTemplate(ctx.userA, {
      name: "Cross owner",
      kind: "ordinary",
      defaultAmountCents: 5000,
      dueDayOfMonth: null,
      active: true,
    });
    await expect(getTemplate(ctx.userB, template.id)).rejects.toThrow(
      TemplateNotFoundError,
    );
  });

  it("lists templates owner-scoped", async () => {
    const listA = await listTemplates(ctx.userA);
    const listB = await listTemplates(ctx.userB);
    const aIds = new Set(listA.map((t) => t.id));
    for (const t of listB) {
      expect(aIds.has(t.id)).toBe(false);
    }
  });

  it("listActiveTemplates returns only active templates", async () => {
    const { template: active } = await createTemplate(ctx.userA, {
      name: "Active one",
      kind: "ordinary",
      defaultAmountCents: 1000,
      dueDayOfMonth: null,
      active: true,
    });
    const { template: inactive } = await createTemplate(ctx.userA, {
      name: "Inactive one",
      kind: "ordinary",
      defaultAmountCents: 2000,
      dueDayOfMonth: null,
      active: false,
    });
    const activeList = await listActiveTemplates(ctx.userA);
    const activeIds = new Set(activeList.map((t) => t.id));
    expect(activeIds.has(active.id)).toBe(true);
    expect(activeIds.has(inactive.id)).toBe(false);
  });
});

describe("Step08 templates: update", () => {
  it("updates template name and amount", async () => {
    const { template } = await createTemplate(ctx.userA, {
      name: "Update me",
      kind: "ordinary",
      defaultAmountCents: 10000,
      dueDayOfMonth: null,
      active: true,
    });
    const { template: updated } = await updateTemplate(ctx.userA, template.id, {
      name: "Updated name",
      defaultAmountCents: 20000,
    });
    expect(updated.name).toBe("Updated name");
    expect(updated.defaultAmountCents).toBe(20000);
  });

  it("deactivates a template", async () => {
    const { template } = await createTemplate(ctx.userA, {
      name: "Deactivate me",
      kind: "ordinary",
      defaultAmountCents: 5000,
      dueDayOfMonth: null,
      active: true,
    });
    const { template: updated } = await updateTemplate(ctx.userA, template.id, {
      active: false,
    });
    expect(updated.active).toBe(false);
  });

  it("updates due day to null", async () => {
    const { template } = await createTemplate(ctx.userA, {
      name: "Clear due day",
      kind: "ordinary",
      defaultAmountCents: 5000,
      dueDayOfMonth: 15,
      active: true,
    });
    const { template: updated } = await updateTemplate(ctx.userA, template.id, {
      dueDayOfMonth: null,
    });
    expect(updated.dueDayOfMonth).toBe(null);
  });

  it("rejects update on non-existent template", async () => {
    await expect(
      updateTemplate(ctx.userA, "999999999", { name: "Nope" }),
    ).rejects.toThrow(TemplateNotFoundError);
  });

  it("rejects cross-owner update", async () => {
    const { template } = await createTemplate(ctx.userA, {
      name: "Cross update",
      kind: "ordinary",
      defaultAmountCents: 5000,
      dueDayOfMonth: null,
      active: true,
    });
    await expect(
      updateTemplate(ctx.userB, template.id, { name: "Hacked" }),
    ).rejects.toThrow(TemplateNotFoundError);
  });

  it("rejects duplicate name on update", async () => {
    await createTemplate(ctx.userA, {
      name: "Existing name",
      kind: "ordinary",
      defaultAmountCents: 5000,
      dueDayOfMonth: null,
      active: true,
    });
    const { template } = await createTemplate(ctx.userA, {
      name: "Original name",
      kind: "ordinary",
      defaultAmountCents: 5000,
      dueDayOfMonth: null,
      active: true,
    });
    await expect(
      updateTemplate(ctx.userA, template.id, { name: "Existing name" }),
    ).rejects.toThrow(TemplateConflictError);
  });

  it("rejects empty update (no fields)", async () => {
    const { template } = await createTemplate(ctx.userA, {
      name: "Empty update",
      kind: "ordinary",
      defaultAmountCents: 5000,
      dueDayOfMonth: null,
      active: true,
    });
    await expect(updateTemplate(ctx.userA, template.id, {})).rejects.toThrow(
      TemplateValidationError,
    );
  });
});

describe("Step08 templates: delete", () => {
  it("deletes a template with no generated instances", async () => {
    const { template } = await createTemplate(ctx.userA, {
      name: "Delete me",
      kind: "ordinary",
      defaultAmountCents: 5000,
      dueDayOfMonth: null,
      active: true,
    });
    await deleteTemplate(ctx.userA, template.id);
    await expect(getTemplate(ctx.userA, template.id)).rejects.toThrow(
      TemplateNotFoundError,
    );
  });

  it("rejects delete on non-existent template", async () => {
    await expect(deleteTemplate(ctx.userA, "999999999")).rejects.toThrow(
      TemplateNotFoundError,
    );
  });
});