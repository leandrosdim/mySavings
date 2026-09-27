// Step06 account CRUD and archive restriction integration tests.
//
// Tests exercise the real production service layer (lib/accounts/service.ts)
// against disposable step06_* schemas with two synthetic users (A and B).
// No mocking of the business logic; the service runs against the real DB.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupAccountsSchema,
  teardownAccountsSchema,
  type AccountsTestContext,
} from "./helpers";
import {
  createAccount,
  listAccounts,
  listAllAccounts,
  getAccount,
  renameAccount,
  archiveAccount,
  NotFoundError,
  ValidationError,
  ArchiveRestrictedError,
} from "../../lib/accounts/service";

let ctx: AccountsTestContext;

beforeAll(async () => {
  ctx = await setupAccountsSchema();
});

afterAll(async () => {
  await teardownAccountsSchema(ctx);
});

describe("Step06 accounts: create and list", () => {
  it("creates an account with a name and no initial balance (never-entered)", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Main checking",
      initialBalanceCents: null,
      trackBalance: true,
    });
    expect(account.id).toBeTruthy();
    expect(account.name).toBe("Main checking");
    expect(account.currentBalanceCents).toBe(null);
    expect(account.balanceAsOf).toBe(null);
    expect(account.archived).toBe(false);
    expect(account.version).toBe(1);
    expect(account.trackBalance).toBe(true);
  });

  it("creates an account with an explicit zero balance (distinct from never-entered)", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Zero wallet",
      initialBalanceCents: 0,
      trackBalance: true,
    });
    expect(account.currentBalanceCents).toBe(0);
    expect(account.balanceAsOf).not.toBe(null);
  });

  it("creates an account with a positive balance", async () => {
    const { account } = await createAccount(ctx.userA, {
      name: "Savings",
      initialBalanceCents: 500000,
      trackBalance: true,
    });
    expect(account.currentBalanceCents).toBe(500000);
  });

  it("rejects an empty account name", async () => {
    await expect(
      createAccount(ctx.userA, {
        name: "   ",
        initialBalanceCents: null,
        trackBalance: true,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a name exceeding 100 characters", async () => {
    await expect(
      createAccount(ctx.userA, {
        name: "x".repeat(101),
        initialBalanceCents: null,
        trackBalance: true,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a non-integer initial balance", async () => {
    await expect(
      createAccount(ctx.userA, {
        name: "Bad balance",
        initialBalanceCents: 100.5,
        trackBalance: true,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("lists only non-archived accounts by default", async () => {
    const { account: active } = await createAccount(ctx.userA, {
      name: "Active list test",
      initialBalanceCents: null,
      trackBalance: true,
    });
    const { account: archived } = await createAccount(ctx.userA, {
      name: "Archived list test",
      initialBalanceCents: 0,
      trackBalance: true,
    });
    await archiveAccount(ctx.userA, archived.id);

    const accounts = await listAccounts(ctx.userA);
    const ids = accounts.map((a) => a.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(archived.id);
  });

  it("listAllAccounts includes archived accounts", async () => {
    const all = await listAllAccounts(ctx.userA);
    const archived = all.filter((a) => a.archived);
    expect(archived.length).toBeGreaterThan(0);
  });
});

describe("Step06 accounts: get single", () => {
  it("fetches an existing account", async () => {
    const { account: created } = await createAccount(ctx.userA, {
      name: "Get me",
      initialBalanceCents: 1000,
      trackBalance: true,
    });
    const fetched = await getAccount(ctx.userA, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe("Get me");
    expect(fetched.currentBalanceCents).toBe(1000);
  });

  it("throws NotFoundError for a non-existent account", async () => {
    await expect(getAccount(ctx.userA, "999999999")).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when accessing another owner's account", async () => {
    const { account: bAccount } = await createAccount(ctx.userB, {
      name: "B's private",
      initialBalanceCents: null,
      trackBalance: true,
    });
    await expect(getAccount(ctx.userA, bAccount.id)).rejects.toThrow(NotFoundError);
  });
});

describe("Step06 accounts: rename", () => {
  it("renames an active account", async () => {
    const { account: created } = await createAccount(ctx.userA, {
      name: "Old name",
      initialBalanceCents: null,
      trackBalance: true,
    });
    const { account: renamed } = await renameAccount(ctx.userA, created.id, "New name");
    expect(renamed.name).toBe("New name");
    expect(renamed.id).toBe(created.id);
  });

  it("rejects renaming with an empty name", async () => {
    const { account: created } = await createAccount(ctx.userA, {
      name: "To rename",
      initialBalanceCents: null,
      trackBalance: true,
    });
    await expect(renameAccount(ctx.userA, created.id, "")).rejects.toThrow(ValidationError);
  });

  it("cannot rename another owner's account", async () => {
    const { account: bAccount } = await createAccount(ctx.userB, {
      name: "B's account",
      initialBalanceCents: null,
      trackBalance: true,
    });
    await expect(renameAccount(ctx.userA, bAccount.id, "Hacked")).rejects.toThrow(NotFoundError);
  });

  it("rejects renaming an archived account", async () => {
    const { account: created } = await createAccount(ctx.userA, {
      name: "To archive",
      initialBalanceCents: 0,
      trackBalance: true,
    });
    await archiveAccount(ctx.userA, created.id);
    await expect(renameAccount(ctx.userA, created.id, "Unarchive")).rejects.toThrow(ValidationError);
  });
});

describe("Step06 accounts: archive restrictions", () => {
  it("archives a zero-balance account", async () => {
    const { account: created } = await createAccount(ctx.userA, {
      name: "Zero archive",
      initialBalanceCents: 0,
      trackBalance: true,
    });
    const { account: archived } = await archiveAccount(ctx.userA, created.id);
    expect(archived.archived).toBe(true);
  });

  it("archives a never-set balance account (null balance)", async () => {
    const { account: created } = await createAccount(ctx.userA, {
      name: "Never set archive",
      initialBalanceCents: null,
      trackBalance: true,
    });
    const { account: archived } = await archiveAccount(ctx.userA, created.id);
    expect(archived.archived).toBe(true);
  });

  it("rejects archiving a funded account (money must not vanish)", async () => {
    const { account: created } = await createAccount(ctx.userA, {
      name: "Funded",
      initialBalanceCents: 50000,
      trackBalance: true,
    });
    await expect(archiveAccount(ctx.userA, created.id)).rejects.toThrow(ArchiveRestrictedError);
  });

  it("rejects archiving a negative-balance account", async () => {
    const { account: created } = await createAccount(ctx.userA, {
      name: "Overdraft",
      initialBalanceCents: -1000,
      trackBalance: true,
    });
    await expect(archiveAccount(ctx.userA, created.id)).rejects.toThrow(ArchiveRestrictedError);
  });

  it("is idempotent: archiving an already-archived account returns it", async () => {
    const { account: created } = await createAccount(ctx.userA, {
      name: "Double archive",
      initialBalanceCents: 0,
      trackBalance: true,
    });
    await archiveAccount(ctx.userA, created.id);
    const { account: secondArchive } = await archiveAccount(ctx.userA, created.id);
    expect(secondArchive.archived).toBe(true);
  });

  it("cannot archive another owner's account", async () => {
    const { account: bAccount } = await createAccount(ctx.userB, {
      name: "B's zero",
      initialBalanceCents: 0,
      trackBalance: true,
    });
    await expect(archiveAccount(ctx.userA, bAccount.id)).rejects.toThrow(NotFoundError);
  });
});

describe("Step06 accounts: A/B owner isolation", () => {
  it("user A listing does not include user B's accounts", async () => {
    const { account: aAccount } = await createAccount(ctx.userA, {
      name: "A only",
      initialBalanceCents: null,
      trackBalance: true,
    });
    const { account: bAccount } = await createAccount(ctx.userB, {
      name: "B only",
      initialBalanceCents: null,
      trackBalance: true,
    });
    const aList = await listAccounts(ctx.userA);
    const aIds = aList.map((a) => a.id);
    expect(aIds).toContain(aAccount.id);
    expect(aIds).not.toContain(bAccount.id);
  });

  it("user B listing does not include user A's accounts", async () => {
    const { account: aAccount } = await createAccount(ctx.userA, {
      name: "A isolated",
      initialBalanceCents: null,
      trackBalance: true,
    });
    const bList = await listAccounts(ctx.userB);
    const bIds = bList.map((a) => a.id);
    expect(bIds).not.toContain(aAccount.id);
  });
});