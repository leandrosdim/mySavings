import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import {
  setupAuthSchema,
  teardownAuthSchema,
  insertTestUser,
  resetAuthTables,
  type AuthTestContext,
} from "./helpers";
import { hashPassword } from "../../lib/auth/password";
import {
  createSession,
  resolveSession,
  revokeSession,
  revokeAllUserSessions,
  deleteSession,
  AuthConfigError,
  CookieSaveError,
  createSessionWithCredentialCheck,
  CredentialChangedError,
} from "../../lib/auth/session";
import { query, withTransaction } from "../../lib/db";
import { __resetCookieStore } from "../__mocks__/next/headers";

const ctxRef: { ctx: AuthTestContext } = {} as { ctx: AuthTestContext };

const emailA = "a-session@step04.test.local";
const emailB = "b-session@step04.test.local";
let userAId: string;
let userBId: string;
let passwordHashA: string;

beforeAll(async () => {
  const ctx = await setupAuthSchema();
  ctxRef.ctx = ctx;
  passwordHashA = await hashPassword("TestPasswordA!2026");
  userAId = await insertTestUser(emailA, passwordHashA);
  userBId = await insertTestUser(
    emailB,
    await hashPassword("TestPasswordB!2026"),
  );
});

afterAll(async () => {
  await teardownAuthSchema(ctxRef.ctx);
});

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters-long!!";
  __resetCookieStore();
});

afterEach(async () => {
  await resetAuthTables([userAId, userBId], [emailA, emailB]);
  __resetCookieStore();
  vi.restoreAllMocks();
});

async function expireSessionRow(sessionId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE sessions SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [sessionId],
    );
  });
}

async function countActiveSessionsForUser(userId: string): Promise<number> {
  const result = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return result.rows[0]?.n ?? 0;
}

describe("createSession and resolveSession", () => {
  it("creates a session that resolves to the correct user", async () => {
    const sessionId = await createSession(userAId);
    expect(sessionId).toBeTruthy();
    const resolved = await resolveSession();
    expect(resolved).not.toBeNull();
    expect(resolved!.userId).toBe(userAId);
    expect(resolved!.email).toBe(emailA);
  });

  it("returns null when no session cookie exists", async () => {
    const resolved = await resolveSession();
    expect(resolved).toBeNull();
  });
});

describe("session revocation", () => {
  it("revoked session no longer resolves", async () => {
    const sessionId = await createSession(userAId);
    await revokeSession(sessionId);
    const resolved = await resolveSession();
    expect(resolved).toBeNull();
  });

  it("revokeAllUserSessions revokes all sessions for a user", async () => {
    await createSession(userAId);
    await createSession(userAId);
    const count = await revokeAllUserSessions(userAId);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(await revokeAllUserSessions(userAId)).toBe(0);
  });

  it("revokeAllUserSessions does not revoke another user's sessions (two-user isolation)", async () => {
    await createSession(userAId);
    await createSession(userBId);
    const count = await revokeAllUserSessions(userAId);
    expect(count).toBe(1);
    expect(await countActiveSessionsForUser(userBId)).toBe(1);
  });
});

describe("session expiry", () => {
  it("expired session no longer resolves", async () => {
    const sessionId = await createSession(userAId);
    await expireSessionRow(sessionId);
    const resolved = await resolveSession();
    expect(resolved).toBeNull();
  });
});

describe("deleteSession", () => {
  it("deletes the session row and clears cookie", async () => {
    const sessionId = await createSession(userAId);
    await deleteSession(sessionId);
    const resolved = await resolveSession();
    expect(resolved).toBeNull();
  });
});

describe("AuthConfigError", () => {
  it("throws when SESSION_SECRET is missing", async () => {
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      await expect(createSession(userAId)).rejects.toThrow(AuthConfigError);
    } finally {
      process.env.SESSION_SECRET = saved;
    }
  });

  it("throws when SESSION_SECRET is too short", async () => {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "short";
    try {
      await expect(createSession(userAId)).rejects.toThrow(AuthConfigError);
    } finally {
      process.env.SESSION_SECRET = saved;
    }
  });
});

// S4-01 issuance/reset race: createSessionWithCredentialCheck revalidates the
// credential hash inside the same transaction that inserts the session row,
// holding a FOR UPDATE lock on the user row. If the password hash changed
// between the login verify and session issuance, the session is NOT created.
describe("S4-01 credential revalidation on session issuance", () => {
  it("creates a session when the hash is unchanged", async () => {
    const result = await createSessionWithCredentialCheck(userAId, passwordHashA);
    expect(result.sessionId).toBeTruthy();
    expect(result.cookieSaved).toBe(true);
    const resolved = await resolveSession();
    expect(resolved).not.toBeNull();
    expect(resolved!.userId).toBe(userAId);
  });

  it("aborts session creation with CredentialChangedError when the hash changed", async () => {
    const staleHash = passwordHashA;
    const newHash = await hashPassword("NewPassword!2026");
    // Simulate a reset that changes the hash after the login read the old one.
    // Explicit transaction: single client write, no autocommit fixture.
    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
        newHash,
        userAId,
      ]);
    });
    try {
      await expect(
        createSessionWithCredentialCheck(userAId, staleHash),
      ).rejects.toBeInstanceOf(CredentialChangedError);
      const n = await countActiveSessionsForUser(userAId);
      expect(n).toBe(0);
    } finally {
      await withTransaction(async (client) => {
        await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
          passwordHashA,
          userAId,
        ]);
      });
    }
  });
});

// S4 cookie-save failure: if iron-session save() fails after the session row
// was inserted, the row is rolled back so no orphan live session remains.
describe("cookie-save failure rolls back session row", () => {
  it("deletes the session row and rethrows CookieSaveError when save() fails", async () => {
    const headersModule = await import("../__mocks__/next/headers");
    headersModule.__setFailOnWrite(true);
    try {
      await expect(
        createSessionWithCredentialCheck(userAId, passwordHashA),
      ).rejects.toBeInstanceOf(CookieSaveError);
      const n = await countActiveSessionsForUser(userAId);
      expect(n).toBe(0);
    } finally {
      headersModule.__setFailOnWrite(false);
    }
  });
});

// S4-final cookie-init failure: if iron-session initialization
// (getIronSessionData) throws AFTER the session row was committed, the row
// is rolled back and a sanitized CookieSaveError is thrown. The error
// message must NOT leak the session id or DB internals.
describe("cookie-init failure rolls back session row (getIronSessionData outside cleanup try)", () => {
  it("deletes the session row and rethrows sanitized CookieSaveError when init fails", async () => {
    const headersModule = await import("../__mocks__/next/headers");
    headersModule.__setFailOnInit(true);
    try {
      await expect(
        createSessionWithCredentialCheck(userAId, passwordHashA),
      ).rejects.toBeInstanceOf(CookieSaveError);
      const n = await countActiveSessionsForUser(userAId);
      expect(n).toBe(0);
    } finally {
      headersModule.__setFailOnInit(false);
    }
  });

  it("init-failure CookieSaveError message does not leak the session id", async () => {
    const headersModule = await import("../__mocks__/next/headers");
    headersModule.__setFailOnInit(true);
    try {
      try {
        await createSessionWithCredentialCheck(userAId, passwordHashA);
      } catch (error) {
        expect(error).toBeInstanceOf(CookieSaveError);
        const message = String((error as Error).message);
        // The session id is a UUID; ensure it does not appear in the message.
        expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
        expect(message).not.toContain("simulated cookie store initialization failure");
      }
      const n = await countActiveSessionsForUser(userAId);
      expect(n).toBe(0);
    } finally {
      headersModule.__setFailOnInit(false);
    }
  });
});

// S4-final config-fails-before-insert: validateSessionConfig() runs BEFORE
// the insert transaction, so a missing/short SESSION_SECRET cannot leave an
// orphan session row. AuthConfigError propagates (not CookieSaveError).
describe("config fails before insert (no orphan row)", () => {
  it("throws AuthConfigError and leaves no session row when SESSION_SECRET is missing", async () => {
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      await expect(
        createSessionWithCredentialCheck(userAId, passwordHashA),
      ).rejects.toBeInstanceOf(AuthConfigError);
      const n = await countActiveSessionsForUser(userAId);
      expect(n).toBe(0);
    } finally {
      process.env.SESSION_SECRET = saved;
    }
  });

  it("throws AuthConfigError and leaves no session row when SESSION_SECRET is too short", async () => {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "short";
    try {
      await expect(
        createSessionWithCredentialCheck(userAId, passwordHashA),
      ).rejects.toBeInstanceOf(AuthConfigError);
      const n = await countActiveSessionsForUser(userAId);
      expect(n).toBe(0);
    } finally {
      process.env.SESSION_SECRET = saved;
    }
  });
});

// S4-final cleanup-failure sanitization: if the session-row cleanup DELETE
// itself fails after a cookie init/save failure, the thrown CookieSaveError
// must still be sanitized (not leak the session id or DB error). The orphan
// row will expire naturally; the user has no cookie and must re-authenticate.
describe("cleanup-failure sanitization (orphan row, sanitized error)", () => {
  it("throws sanitized CookieSaveError even when cleanup DELETE fails (BEFORE DELETE trigger)", async () => {
    const headersModule = await import("../__mocks__/next/headers");
    headersModule.__setFailOnInit(true);
    // Install a BEFORE DELETE trigger that raises an exception, so the
    // INSERT succeeds but the cleanup DELETE fails. This isolates the
    // cleanup-failure path from the insert path.
    await withTransaction(async (client) => {
      await client.query(
        `CREATE OR REPLACE FUNCTION __block_delete() RETURNS trigger AS $$
         BEGIN
           RAISE EXCEPTION 'simulated cleanup delete failure';
         END;
         $$ LANGUAGE plpgsql`,
      );
      await client.query(
        `DROP TRIGGER IF EXISTS __sessions_block_delete ON sessions`,
      );
      await client.query(
        `CREATE TRIGGER __sessions_block_delete BEFORE DELETE ON sessions
         FOR EACH ROW EXECUTE FUNCTION __block_delete()`,
      );
    });
    try {
      try {
        await createSessionWithCredentialCheck(userAId, passwordHashA);
        throw new Error("expected CookieSaveError");
      } catch (error) {
        expect(error).toBeInstanceOf(CookieSaveError);
        const message = String((error as Error).message);
        expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
        expect(message).not.toContain("simulated cleanup delete failure");
        expect(message).not.toContain("__block_delete");
      }
    } finally {
      headersModule.__setFailOnInit(false);
      await withTransaction(async (client) => {
        await client.query(`DROP TRIGGER IF EXISTS __sessions_block_delete ON sessions`);
        await client.query(`DROP FUNCTION IF EXISTS __block_delete()`);
      });
      // The orphan row could not be DELETEd (trigger blocked it); remove
      // the trigger first, then clean up so it doesn't leak across tests.
      // Explicit transaction: single client write.
      await withTransaction(async (client) => {
        await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userAId]);
      });
    }
  });
});