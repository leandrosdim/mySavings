import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import {
  setupAuthSchema,
  teardownAuthSchema,
  insertTestUser,
  resetAuthTables,
  type AuthTestContext,
} from "./helpers";
import { hashPassword } from "../../lib/auth/password";
import { loginAction, logoutAction } from "../../lib/auth/actions";
import { provisionUser } from "../../lib/auth/provisioning";
import { findUserByEmail, getCurrentUser } from "../../lib/auth/dal";
import { resolveSession, revokeAllUserSessions, createSession, clearSessionCookie } from "../../lib/auth/session";
import { withTransaction } from "../../lib/db";
import {
  __resetCookieStore,
  __getCookie,
  __setFailOnInit,
} from "../__mocks__/next/headers";

const ctxRef: { ctx: AuthTestContext } = {} as { ctx: AuthTestContext };

const emailA = "a-login@step04.test.local";
const emailB = "b-login@step04.test.local";
const passwordA = "TestPasswordA!2026";
const passwordB = "TestPasswordB!2026";
let userAId: string;
let userBId: string;

beforeAll(async () => {
  const ctx = await setupAuthSchema();
  ctxRef.ctx = ctx;
  userAId = await insertTestUser(emailA, await hashPassword(passwordA));
  userBId = await insertTestUser(emailB, await hashPassword(passwordB));
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

function formData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    fd.set(key, value);
  }
  return fd;
}

function isRedirectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const digest = (error as Error & { digest?: string }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

type LoginResult = { ok: true } | { ok: false; error: string };

describe("loginAction success and failure", () => {
  it("logs in with valid credentials and redirects to /dashboard", async () => {
    let caught: unknown;
    try {
      await loginAction(undefined, formData({ email: emailA, password: passwordA }));
    } catch (error) {
      caught = error;
    }
    expect(isRedirectError(caught)).toBe(true);
    const session = await resolveSession();
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(userAId);
  });

  it("rejects wrong password with generic error (no enumeration)", async () => {
    const result = (await loginAction(
      undefined,
      formData({ email: emailA, password: "wrong-password-123" }),
    )) as LoginResult;
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBe("Invalid email or password.");
    const session = await resolveSession();
    expect(session).toBeNull();
  });

  it("rejects unknown email with the same generic error as wrong password", async () => {
    const result = (await loginAction(
      undefined,
      formData({ email: "nobody-login@step04.test.local", password: "some-password-123" }),
    )) as LoginResult;
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBe("Invalid email or password.");
  });

  it("rejects empty email", async () => {
    const result = (await loginAction(
      undefined,
      formData({ email: "", password: passwordA }),
    )) as LoginResult;
    expect(result.ok).toBe(false);
  });

  it("rejects too-short password", async () => {
    const result = (await loginAction(
      undefined,
      formData({ email: emailA, password: "short" }),
    )) as LoginResult;
    expect(result.ok).toBe(false);
  });
});

describe("loginAction rate limiting", () => {
  it("rate limits a further WRONG attempt after repeated failures", async () => {
    for (let i = 0; i < 5; i++) {
      await loginAction(undefined, formData({ email: emailA, password: "wrong-password-123" }));
    }
    const result = (await loginAction(
      undefined,
      formData({ email: emailA, password: "still-wrong-456" }),
    )) as LoginResult;
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("Too many failed attempts");
  });

  it("a VALID login still succeeds after repeated failures (no account lockout)", async () => {
    for (let i = 0; i < 4; i++) {
      await loginAction(undefined, formData({ email: emailA, password: "wrong-password-123" }));
    }
    let caught: unknown;
    try {
      await loginAction(undefined, formData({ email: emailA, password: passwordA }));
    } catch (error) {
      caught = error;
    }
    expect(isRedirectError(caught)).toBe(true);
    const session = await resolveSession();
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(userAId);
  });

  it("does not rate limit a different email (per-email throttle)", async () => {
    for (let i = 0; i < 5; i++) {
      await loginAction(undefined, formData({ email: emailA, password: "wrong-password-123" }));
    }
    let caught: unknown;
    try {
      await loginAction(undefined, formData({ email: emailB, password: passwordB }));
    } catch (error) {
      caught = error;
    }
    expect(isRedirectError(caught)).toBe(true);
  });
});

describe("loginAction does not accept forged owner fields", () => {
  it("ignores a submitted user_id field and derives ownership from the session only", async () => {
    const fd = formData({ email: emailA, password: passwordA });
    fd.set("user_id", userBId);
    let caught: unknown;
    try {
      await loginAction(undefined, fd);
    } catch (error) {
      caught = error;
    }
    expect(isRedirectError(caught)).toBe(true);
    const session = await resolveSession();
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(userAId);
    expect(session!.userId).not.toBe(userBId);
  });
});

describe("logoutAction", () => {
  it("revokes the session on logout", async () => {
    try {
      await loginAction(undefined, formData({ email: emailA, password: passwordA }));
    } catch {
      // redirect
    }
    let caught: unknown;
    try {
      await logoutAction();
    } catch (error) {
      caught = error;
    }
    expect(isRedirectError(caught)).toBe(true);
    const session = await resolveSession();
    expect(session).toBeNull();
  });
});

// S4-final logoutAction failure paths. These exercise the action-level
// (Server Action) failure semantics directly, complementing the route-level
// tests in logout-route.test.ts. All fixture writes use explicit
// withTransaction on one client (no autocommit fixtures).
describe("logoutAction failure paths", () => {
  async function blockSessionUpdates(): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
        `CREATE OR REPLACE FUNCTION __block_session_update_action() RETURNS trigger AS $$
         BEGIN
           RAISE EXCEPTION 'simulated revocation update failure (action)';
         END;
         $$ LANGUAGE plpgsql`,
      );
      await client.query(
        `DROP TRIGGER IF EXISTS __sessions_block_update_action ON sessions`,
      );
      await client.query(
        `CREATE TRIGGER __sessions_block_update_action BEFORE UPDATE ON sessions
         FOR EACH ROW EXECUTE FUNCTION __block_session_update_action()`,
      );
    });
  }

  async function unblockSessionUpdates(): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(`DROP TRIGGER IF EXISTS __sessions_block_update_action ON sessions`);
      await client.query(`DROP FUNCTION IF EXISTS __block_session_update_action()`);
    });
  }

  it("throws a safe failure (not a redirect) when the DB revocation fails", async () => {
    // Establish a live session via the test-only createSession so the
    // subsequent logout() finds a valid row to revoke.
    await createSession(userAId);
    expect(__getCookie("mysavings_session")).toBeTruthy();

    // Block UPDATE on sessions so revokeSessionDetailed reports dbError.
    await blockSessionUpdates();
    try {
      let caught: unknown;
      try {
        await logoutAction();
      } catch (error) {
        caught = error;
      }
      // dbError path throws a real Error (not a NEXT_REDIRECT redirect).
      expect(isRedirectError(caught)).toBe(false);
      expect(caught).toBeInstanceOf(Error);
      const msg = String((caught as Error).message).toLowerCase();
      expect(msg).toContain("logout");
      expect(msg).toContain("failed");
      // No internal leak.
      expect((caught as Error).message).not.toContain("simulated revocation update failure");
      expect((caught as Error).message).not.toContain("__block_session_update_action");
    } finally {
      await unblockSessionUpdates();
    }
  });

  it("reports cookie-clearing failure accurately when the iron-session store throws (clearSessionCookie)", async () => {
    // clearSessionCookie() is the in-process iron-session destroy used by
    // the DAL/action path. If the cookie store throws during init,
    // clearSessionCookie returns false — accurately reflecting that the
    // local cookie was NOT cleared. This test exercises the helper
    // directly so the cookieCleared=false contract is verified independent
    // of the lookup path (which also throws on init failure and is a
    // separate, honestly-propagated error).
    await createSession(userAId);
    expect(__getCookie("mysavings_session")).toBeTruthy();

    __setFailOnInit(true);
    try {
      const cleared = await clearSessionCookie();
      expect(cleared).toBe(false);
      // The cookie is still present because the clear failed.
      expect(__getCookie("mysavings_session")).toBeTruthy();
    } finally {
      __setFailOnInit(false);
    }
  });

  it("throws AuthConfigError (not a redirect) when SESSION_SECRET is missing", async () => {
    await createSession(userAId);
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      let caught: unknown;
      try {
        await logoutAction();
      } catch (error) {
        caught = error;
      }
      // validateSessionConfig() runs before any DB write and throws
      // AuthConfigError. The action must propagate a real error, not a
      // redirect.
      expect(isRedirectError(caught)).toBe(false);
      expect(caught).toBeInstanceOf(Error);
      const msg = String((caught as Error).message);
      expect(msg.toLowerCase()).toContain("session_secret");
    } finally {
      process.env.SESSION_SECRET = saved;
    }
  });

  it("throws AuthConfigError when SESSION_SECRET is too short", async () => {
    await createSession(userAId);
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "short";
    try {
      let caught: unknown;
      try {
        await logoutAction();
      } catch (error) {
        caught = error;
      }
      expect(isRedirectError(caught)).toBe(false);
      expect(caught).toBeInstanceOf(Error);
    } finally {
      process.env.SESSION_SECRET = saved;
    }
  });
});

describe("getCurrentUser", () => {
  it("returns the current user after login", async () => {
    try {
      await loginAction(undefined, formData({ email: emailA, password: passwordA }));
    } catch {
      // redirect
    }
    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.email).toBe(emailA);
  });

  it("returns null when not logged in", async () => {
    const user = await getCurrentUser();
    expect(user).toBeNull();
  });
});

describe("two-user session isolation (A vs B)", () => {
  it("user A session cannot see user B data", async () => {
    try {
      await loginAction(undefined, formData({ email: emailA, password: passwordA }));
    } catch {
      // redirect
    }
    const sessionA = await resolveSession();
    expect(sessionA!.userId).toBe(userAId);

    await revokeAllUserSessions(userBId);
    const stillA = await resolveSession();
    expect(stillA).not.toBeNull();
    expect(stillA!.userId).toBe(userAId);
  });

  it("revoking B does not affect A", async () => {
    try {
      await loginAction(undefined, formData({ email: emailA, password: passwordA }));
    } catch {
      // redirect
    }
    const count = await revokeAllUserSessions(userBId);
    expect(count).toBe(0);
    const stillA = await resolveSession();
    expect(stillA).not.toBeNull();
  });
});

describe("findUserByEmail", () => {
  it("finds an existing user (case-insensitive)", async () => {
    const user = await findUserByEmail(emailA.toUpperCase());
    expect(user).not.toBeNull();
    expect(user!.email).toBe(emailA);
  });

  it("returns null for a non-existent email", async () => {
    const user = await findUserByEmail("nobody-login@step04.test.local");
    expect(user).toBeNull();
  });

  it("returns an argon2 hash, not plaintext", async () => {
    const user = await findUserByEmail(emailA);
    expect(user).not.toBeNull();
    expect(user!.password_hash).toBeTruthy();
    expect(user!.password_hash.startsWith("$argon2")).toBe(true);
  });
});

describe("provisionUser", () => {
  it("creates a new user", async () => {
    const newEmail = "new-provision@step04.test.local";
    const result = await provisionUser(newEmail, "NewUserPass!2026");
    expect(result.ok).toBe(true);
    const user = await findUserByEmail(newEmail);
    expect(user).not.toBeNull();
    // Explicit transaction: single client write, no autocommit fixture.
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM users WHERE email = $1`, [newEmail]);
    });
  });

  it("rejects a duplicate email", async () => {
    const result = await provisionUser(emailA, "AnotherPassword!2026");
    expect(result.ok).toBe(false);
  });
});

// S4-final LOGIN ACTION level spy: a rate-limited (blocked) request never
// reaches verifyPassword. This proves the production loginAction ->
// admitLoginAttempt gate blocks BEFORE any hash work, at the ACTION level
// (not just the rate-limit helper level). The spy wraps the real verifyPassword
// so the count reflects actual production calls.
describe("loginAction blocked requests never verifyPassword (action-level spy)", () => {
  it("a rate-limited loginAction does not call verifyPassword", async () => {
    // Exhaust the per-account cap for emailA with wrong passwords. Each
    // admitted failure calls verifyPassword once.
    const passwordModule = await import("../../lib/auth/password");
    let verifyCalls = 0;
    const originalVerify = passwordModule.verifyPassword;
    const spy = vi.spyOn(passwordModule, "verifyPassword").mockImplementation(
      async (password: string, hash: string) => {
        verifyCalls++;
        return originalVerify(password, hash);
      },
    );
    try {
      for (let i = 0; i < 5; i++) {
        await loginAction(
          undefined,
          formData({ email: emailA, password: "wrong-password-123" }),
        );
      }
      // 5 admitted failures => 5 verifyPassword calls.
      expect(verifyCalls).toBe(5);

      // 6th attempt is rate-limited at the per-account cap. The callback is
      // NOT invoked, so verifyPassword is NOT called.
      verifyCalls = 0;
      const result = (await loginAction(
        undefined,
        formData({ email: emailA, password: "still-wrong-789" }),
      )) as LoginResult;
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("Too many failed attempts");
      expect(verifyCalls).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("a busy loginAction (global lock contention) does not call verifyPassword", async () => {
    // Hold the global advisory transaction lock open via a direct
    // admitLoginAttempt callback with a deferred barrier, then drive a
    // loginAction for a DIFFERENT user. The loginAction's admission must
    // return "busy" and never reach verifyPassword.
    const rateLimitModule = await import("../../lib/auth/rate-limit");
    const passwordModule = await import("../../lib/auth/password");
    let verifyCalls = 0;
    const originalVerify = passwordModule.verifyPassword;
    const spy = vi.spyOn(passwordModule, "verifyPassword").mockImplementation(
      async (password: string, hash: string) => {
        verifyCalls++;
        return originalVerify(password, hash);
      },
    );

    let releaseHolder: () => void = () => {};
    const holderReleased = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    const holderEmail = "action-hold@step04.test.local";
    const holderPromise = rateLimitModule.admitLoginAttempt(
      holderEmail,
      async () => {
        await holderReleased;
        return { userFound: false, passwordOk: false };
      },
    );
    // Give the holder a moment to acquire the global lock.
    await new Promise((r) => setTimeout(r, 150));

    try {
      // Drive loginAction for userB while the holder has the global lock.
      verifyCalls = 0;
      const result = (await loginAction(
        undefined,
        formData({ email: emailB, password: "wrong-password-busy" }),
      )) as LoginResult;
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("busy");
      expect(verifyCalls).toBe(0);
    } finally {
      releaseHolder();
      try { await holderPromise; } catch { /* swallow settle */ }
      spy.mockRestore();
      // Cleanup the holder's recorded attempt.
      await withTransaction(async (client) => {
        await client.query(
          `DELETE FROM login_attempts WHERE email = $1`,
          ["action-hold@step04.test.local"],
        );
      });
    }
  });
});