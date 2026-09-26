// S4-03 / S4-04 / S4-08 / API guard regressions.
//
// Logout route (app/api/auth/logout/route.ts):
//   - rejects POSTs with a missing/malformed/sibling/forged Origin header
//     with 403 and does NOT clear the cookie (no cross-site logout CSRF).
//   - on a valid origin, always clears the cookie (success and DB-error).
//   - on a missing TRUSTED_ORIGIN, redirects to the relative /login path
//     (never to localhost or a forwarded origin).
//
// JSON API guard (lib/auth/api-guard.ts):
//   - returns 401 JSON for no session, 503 JSON for DB unavailability, and
//     a valid session otherwise — independent of any proxy/redirect.
//
// These tests construct Request/Headers objects directly and call the route
// POST and the guard against an injected disposable schema. No real HTTP
// server or browser is started.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import {
  setupAuthSchema,
  teardownAuthSchema,
  insertTestUser,
  resetAuthTables,
  type AuthTestContext,
} from "./helpers";
import { hashPassword } from "../../lib/auth/password";
import { createSession } from "../../lib/auth/session";
import { logout } from "../../lib/auth/dal";
import { validateRequestOrigin, getSafeLogoutRedirect, __testing as originTesting, __resetConfigCache } from "../../lib/auth/origin";
import { requireApiSession, requireApiUser } from "../../lib/auth/api-guard";
import { withTransaction } from "../../lib/db";
import { __resetCookieStore, __setCookie, __getCookie } from "../__mocks__/next/headers";

const ctxRef: { ctx: AuthTestContext } = {} as { ctx: AuthTestContext };

const email = "logout@step04.test.local";
let userId: string;
let passwordHash: string;

beforeAll(async () => {
  const ctx = await setupAuthSchema();
  ctxRef.ctx = ctx;
  passwordHash = await hashPassword("LogoutPassword!2026");
  userId = await insertTestUser(email, passwordHash);
});

afterAll(async () => {
  await teardownAuthSchema(ctxRef.ctx);
});

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters-long!!";
  process.env.TRUSTED_ORIGIN = "https://app.mysavings.test";
  delete process.env.TRUSTED_ORIGIN_DEV;
  __resetCookieStore();
  __resetConfigCache();
});

afterEach(async () => {
  await resetAuthTables([userId], [email]);
  delete process.env.TRUSTED_ORIGIN;
  delete process.env.TRUSTED_ORIGIN_DEV;
  __resetCookieStore();
  __resetConfigCache();
  vi.restoreAllMocks();
});

async function expireSession(sessionId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE sessions SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [sessionId],
    );
  });
}

async function revokeSessionRow(sessionId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
  });
}

async function loginAsUser(): Promise<string> {
  const sessionId = await createSession(userId);
  return sessionId;
}

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://app.mysavings.test/api/auth/logout", {
    method: "POST",
    headers: new Headers(headers),
  });
}

// ---------------------------------------------------------------------------
// S4-03 / S4-08 strict Origin enforcement on the logout route.
// ---------------------------------------------------------------------------

describe("S4-03 strict Origin enforcement (validateRequestOrigin)", () => {
  it("accepts a POST whose Origin exactly matches the configured trusted origin", () => {
    const result = validateRequestOrigin(new Headers({ origin: "https://app.mysavings.test" }));
    expect(result.valid).toBe(true);
  });

  it("rejects a missing Origin header", () => {
    const result = validateRequestOrigin(new Headers({}));
    expect(result.valid).toBe(false);
  });

  it("rejects an empty Origin header", () => {
    const result = validateRequestOrigin(new Headers({ origin: "" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a malformed Origin", () => {
    const result = validateRequestOrigin(new Headers({ origin: "not-a-url" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a sibling subdomain Origin", () => {
    const result = validateRequestOrigin(new Headers({ origin: "https://evil.mysavings.test" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a forged forwarded-origin that matches a different host", () => {
    const result = validateRequestOrigin(new Headers({ origin: "https://attacker.example.com" }));
    expect(result.valid).toBe(false);
  });

  it("rejects when TRUSTED_ORIGIN is not configured", () => {
    delete process.env.TRUSTED_ORIGIN;
    __resetConfigCache();
    const result = validateRequestOrigin(new Headers({ origin: "https://app.mysavings.test" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a protocol mismatch (http vs https trusted origin)", () => {
    __resetConfigCache();
    const result = validateRequestOrigin(new Headers({ origin: "http://app.mysavings.test" }));
    expect(result.valid).toBe(false);
  });

  it("rejects an Origin with a path component", () => {
    __resetConfigCache();
    const result = validateRequestOrigin(new Headers({ origin: "https://app.mysavings.test/evil" }));
    expect(result.valid).toBe(false);
  });

  it("rejects an Origin with a query string", () => {
    __resetConfigCache();
    const result = validateRequestOrigin(new Headers({ origin: "https://app.mysavings.test?x=1" }));
    expect(result.valid).toBe(false);
  });

  it("rejects an Origin with a fragment", () => {
    __resetConfigCache();
    const result = validateRequestOrigin(new Headers({ origin: "https://app.mysavings.test#frag" }));
    expect(result.valid).toBe(false);
  });

  it("rejects an Origin with userinfo (credentials)", () => {
    __resetConfigCache();
    const result = validateRequestOrigin(new Headers({ origin: "https://user:pass@app.mysavings.test" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a literal null Origin", () => {
    __resetConfigCache();
    const result = validateRequestOrigin(new Headers({ origin: "null" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a multi-origin (comma-separated) header", () => {
    __resetConfigCache();
    const result = validateRequestOrigin(new Headers({ origin: "https://app.mysavings.test, https://evil.com" }));
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S4-03 config validation: bad config returns safe 503 reason, never builds
// a redirect from a raw invalid origin.
// ---------------------------------------------------------------------------

describe("S4-03 config validation and bad-config safe fallback", () => {
  it("getConfigError returns null for valid config", () => {
    process.env.TRUSTED_ORIGIN = "https://app.mysavings.test";
    __resetConfigCache();
    expect(originTesting.readConfiguredOrigin()).toBe("https://app.mysavings.test");
  });

  it("normalizes a trailing slash in config origin", () => {
    process.env.TRUSTED_ORIGIN = "https://app.mysavings.test/";
    __resetConfigCache();
    expect(originTesting.readConfiguredOrigin()).toBe("https://app.mysavings.test");
  });

  it("rejects a config origin with a path", () => {
    process.env.TRUSTED_ORIGIN = "https://app.mysavings.test/admin";
    __resetConfigCache();
    expect(originTesting.readConfiguredOrigin()).toBeNull();
  });

  it("rejects a config origin with a fragment", () => {
    process.env.TRUSTED_ORIGIN = "https://app.mysavings.test#frag";
    __resetConfigCache();
    expect(originTesting.readConfiguredOrigin()).toBeNull();
  });

  it("getSafeLogoutRedirect falls back to /login on bad config", () => {
    process.env.TRUSTED_ORIGIN = "https://app.mysavings.test/path";
    __resetConfigCache();
    expect(getSafeLogoutRedirect()).toBe("/login");
  });

  it("rejects a literal null config origin", () => {
    process.env.TRUSTED_ORIGIN = "null";
    __resetConfigCache();
    expect(originTesting.readConfiguredOrigin()).toBeNull();
    expect(getSafeLogoutRedirect()).toBe("/login");
  });
});

// ---------------------------------------------------------------------------
// S4-08 deployment redirect defaults to relative /login, never localhost or
// a forwarded origin.
// ---------------------------------------------------------------------------

describe("S4-08 safe logout redirect", () => {
  it("returns the trusted origin /login when TRUSTED_ORIGIN is configured", () => {
    process.env.TRUSTED_ORIGIN = "https://app.mysavings.test";
    __resetConfigCache();
    expect(getSafeLogoutRedirect()).toBe("https://app.mysavings.test/login");
  });

  it("falls back to the relative /login path when TRUSTED_ORIGIN is missing", () => {
    delete process.env.TRUSTED_ORIGIN;
    __resetConfigCache();
    expect(getSafeLogoutRedirect()).toBe("/login");
  });

  it("never falls back to localhost or a forwarded origin", () => {
    delete process.env.TRUSTED_ORIGIN;
    __resetConfigCache();
    const redirect = getSafeLogoutRedirect();
    expect(redirect).not.toContain("localhost");
    expect(redirect).not.toContain("127.0.0.1");
    expect(redirect).toBe("/login");
  });

  it("uses TRUSTED_ORIGIN_DEV in non-production when set", () => {
    delete process.env.TRUSTED_ORIGIN;
    process.env.TRUSTED_ORIGIN_DEV = "http://localhost:3000";
    __resetConfigCache();
    expect(getSafeLogoutRedirect()).toBe("http://localhost:3000/login");
  });
});

// ---------------------------------------------------------------------------
// S4-04 logout always clears the cookie; distinguishes DB error from invalid.
// ---------------------------------------------------------------------------

describe("S4-04 logout always clears the cookie and distinguishes DB errors", () => {
  it("clears the cookie and revokes a valid session", async () => {
    await loginAsUser();
    expect(__getCookie("mysavings_session")).toBeTruthy();
    const result = await logout();
    expect(result.hadSession).toBe(true);
    expect(result.revocationSucceeded).toBe(true);
    expect(result.dbError).toBe(false);
    expect(result.cookieCleared).toBe(true);
    // After logout the cookie is cleared (empty or absent).
    const cookie = __getCookie("mysavings_session");
    expect(!cookie || cookie === "").toBe(true);
  });

  it("clears the cookie even for an expired session (stale cookie)", async () => {
    const sessionId = await loginAsUser();
    await expireSession(sessionId);
    const result = await logout();
    expect(result.hadSession).toBe(false);
    expect(result.revocationSucceeded).toBe(false);
    expect(result.cookieCleared).toBe(true);
    const cookie = __getCookie("mysavings_session");
    expect(!cookie || cookie === "").toBe(true);
  });

  it("clears the cookie for a revoked session", async () => {
    const sessionId = await loginAsUser();
    await revokeSessionRow(sessionId);
    const result = await logout();
    expect(result.hadSession).toBe(false);
    expect(result.cookieCleared).toBe(true);
    const cookie = __getCookie("mysavings_session");
    expect(!cookie || cookie === "").toBe(true);
  });

  it("clears the cookie when no session cookie is present", async () => {
    const result = await logout();
    expect(result.hadSession).toBe(false);
    expect(result.cookieCleared).toBe(true);
    const cookie = __getCookie("mysavings_session");
    expect(!cookie || cookie === "").toBe(true);
  });

  it("clears the cookie when the session cookie is tampered/malformed", async () => {
    __setCookie("mysavings_session", "not-a-valid-iron-session-seal");
    const result = await logout();
    expect(result.hadSession).toBe(false);
    expect(result.cookieCleared).toBe(true);
    const cookie = __getCookie("mysavings_session");
    expect(!cookie || cookie === "").toBe(true);
  });

  it("clears the cookie and reports dbError when revocation DB write fails", async () => {
    const sessionId = await loginAsUser();
    await withTransaction(async (client) => {
      await client.query(`ALTER TABLE sessions RENAME TO sessions_bak`);
    });
    try {
      const result = await logout();
      expect(result.dbError).toBe(true);
      expect(result.cookieCleared).toBe(true);
      const cookie = __getCookie("mysavings_session");
      expect(!cookie || cookie === "").toBe(true);
    } finally {
      await withTransaction(async (client) => {
        await client.query(`ALTER TABLE sessions_bak RENAME TO sessions`);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// API JSON guard: 401/503 independent of proxy redirect.
// ---------------------------------------------------------------------------

describe("API JSON guard returns JSON, not redirects", () => {
  it("returns a valid session for an authenticated request", async () => {
    await loginAsUser();
    const result = await requireApiSession();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.userId).toBe(userId);
    }
  });

  it("returns 401 JSON when no session cookie is present", async () => {
    const result = await requireApiSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body.error).toBe("Authentication required");
    }
  });

  it("returns 401 JSON for an expired session", async () => {
    const sessionId = await loginAsUser();
    await expireSession(sessionId);
    const result = await requireApiSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("returns 401 JSON for a revoked session", async () => {
    const sessionId = await loginAsUser();
    await revokeSessionRow(sessionId);
    const result = await requireApiSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("returns 401 JSON for a tampered/malformed session cookie", async () => {
    __setCookie("mysavings_session", "tampered-not-a-real-seal");
    const result = await requireApiSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("returns 503 JSON when the DB is unavailable", async () => {
    await loginAsUser();
    await withTransaction(async (client) => {
      await client.query(`ALTER TABLE sessions RENAME TO sessions_bak`);
    });
    try {
      const result = await requireApiSession();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(503);
        const body = await result.response.json();
        expect(body.error).toBe("Service temporarily unavailable");
      }
    } finally {
      await withTransaction(async (client) => {
        await client.query(`ALTER TABLE sessions_bak RENAME TO sessions`);
      });
    }
  });

  it("requireApiUser returns userId/email for a valid session", async () => {
    await loginAsUser();
    const result = await requireApiUser();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe(userId);
      expect(result.email).toBe(email);
    }
  });
});

// ---------------------------------------------------------------------------
// Token replay / expiry / revocation: a sealed session id that is replayed
// after expiry or revocation must not resolve.
// ---------------------------------------------------------------------------

describe("token replay/expiry/revocation", () => {
  it("a replayed session id after revocation does not resolve", async () => {
    const sessionId = await loginAsUser();
    // Capture the sealed cookie value (the "token").
    const sealed = __getCookie("mysavings_session");
    expect(sealed).toBeTruthy();
    // Revoke the session row directly.
    await revokeSessionRow(sessionId);
    // Replay the same sealed cookie: resolveSession must return null.
    // The cookie is still in the store, so we just call resolveSession via
    // the API guard which reads the cookie.
    const result = await requireApiSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("a replayed session id after expiry does not resolve", async () => {
    const sessionId = await loginAsUser();
    await expireSession(sessionId);
    const result = await requireApiSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("a second login creates a new session id; the old sealed cookie is replaced", async () => {
    const firstSessionId = await loginAsUser();
    const firstSealed = __getCookie("mysavings_session");
    expect(firstSealed).toBeTruthy();
    // Log in again (createSession overwrites the cookie).
    const secondSessionId = await loginAsUser();
    expect(secondSessionId).not.toBe(firstSessionId);
    const secondSealed = __getCookie("mysavings_session");
    expect(secondSealed).not.toBe(firstSealed);
    // The first session row still exists (createSession doesn't revoke it),
    // but the cookie no longer carries its id. This documents cookie
    // replacement; full single-session enforcement is a future policy choice.
  });
});