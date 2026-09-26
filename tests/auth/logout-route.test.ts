// S4-final REAL logout route regressions.
//
// These tests import the REAL app/api/auth/logout/route.ts POST handler and
// drive it against an injected disposable schema. They prove the actual
// returned NextResponse carries the correct status, the expired Set-Cookie
// directive, Cache-Control: no-store, and the correct non-localhost redirect
// target — without faking the response functions.
//
// Coverage:
//   A) forbidden Origin (mismatch) => 403, no Set-Cookie, no-store.
//   A) bad_config => 503, no Set-Cookie, no-store, safe config error message.
//   A) success (valid origin, live session, revocation succeeds) => 303 to
//      the configured non-localhost TRUSTED_ORIGIN/login, Set-Cookie carries
//      Max-Age=0 AND Expires epoch, Cache-Control: no-store, Location header
//      is the trusted origin /login.
//   A) 503 after SUCCESSFUL session lookup but failing UPDATE revocation: a
//      BEFORE UPDATE trigger on sessions raises on UPDATE, so resolveSession
//      succeeds but revokeSessionDetailed fails. The route returns 503,
//      no-store, Set-Cookie clears the cookie, body carries the safe retry
//      message. The trigger is dropped in finally.
//
// All fixture writes use explicit withTransaction on one client. No fake
// response functions. No production bypass.

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
import { __resetConfigCache } from "../../lib/auth/origin";
import { POST } from "../../app/api/auth/logout/route";
import { withTransaction } from "../../lib/db";
import {
  __resetCookieStore,
  __setCookie,
  __getCookie,
} from "../__mocks__/next/headers";

const ctxRef: { ctx: AuthTestContext } = {} as { ctx: AuthTestContext };

const email = "route-logout@step04.test.local";
let userId: string;
let passwordHash: string;

beforeAll(async () => {
  const ctx = await setupAuthSchema();
  ctxRef.ctx = ctx;
  passwordHash = await hashPassword("RouteLogout!2026");
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

async function loginAsUser(): Promise<string> {
  return createSession(userId);
}

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://app.mysavings.test/api/auth/logout", {
    method: "POST",
    headers: new Headers(headers),
  });
}

function parseSetCookieHeaders(resp: Response): string[] {
  // NextResponse/Response may surface Set-Cookie as a single header or
  // multiple; getSetCookie() returns the array form when available.
  const anyResp = resp as Response & { getSetCookie?: () => string[] };
  if (typeof anyResp.getSetCookie === "function") {
    const arr = anyResp.getSetCookie();
    if (arr.length > 0) return arr;
  }
  const raw = resp.headers.get("set-cookie");
  return raw ? [raw] : [];
}

describe("S4-final REAL logout route: forbidden Origin => 403, no Set-Cookie", () => {
  it("rejects a mismatched Origin with 403 and does NOT clear the cookie", async () => {
    await loginAsUser();
    expect(__getCookie("mysavings_session")).toBeTruthy();
    const resp = await POST(
      makeRequest({ origin: "https://evil.example.com" }),
    );
    expect(resp.status).toBe(403);
    const setCookies = parseSetCookieHeaders(resp);
    expect(setCookies.length).toBe(0);
    expect(resp.headers.get("set-cookie")).toBeNull();
    // Cookie store untouched by the route.
    expect(__getCookie("mysavings_session")).toBeTruthy();
    expect(resp.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a missing Origin with 403 and no Set-Cookie", async () => {
    await loginAsUser();
    const resp = await POST(makeRequest({}));
    expect(resp.status).toBe(403);
    expect(parseSetCookieHeaders(resp).length).toBe(0);
    expect(resp.headers.get("set-cookie")).toBeNull();
  });
});

describe("S4-final REAL logout route: bad_config => 503, no Set-Cookie, no-store", () => {
  it("returns 503 with a safe config error and does NOT clear the cookie on bad_config", async () => {
    // Point TRUSTED_ORIGIN to an invalid origin (with a path) so the config
    // validator records a bad_config error. The route must return 503
    // no-store with a safe error message and must NOT clear the cookie
    // (a misconfigured origin gate must not wipe the session cookie).
    process.env.TRUSTED_ORIGIN = "https://app.mysavings.test/admin";
    __resetConfigCache();
    await loginAsUser();
    expect(__getCookie("mysavings_session")).toBeTruthy();
    const resp = await POST(
      makeRequest({ origin: "https://app.mysavings.test" }),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("cache-control")).toBe("no-store");
    expect(parseSetCookieHeaders(resp).length).toBe(0);
    expect(resp.headers.get("set-cookie")).toBeNull();
    const body = await resp.json();
    expect(String(body.error).toLowerCase()).toContain("configuration");
    // Cookie store untouched.
    expect(__getCookie("mysavings_session")).toBeTruthy();
  });
});

describe("S4-final REAL logout route: success => 303 + expired cookie + no-store", () => {
  it("returns 303 to the configured non-localhost /login with Max-Age=0 AND Expires epoch Set-Cookie", async () => {
    await loginAsUser();
    expect(__getCookie("mysavings_session")).toBeTruthy();
    const resp = await POST(
      makeRequest({ origin: "https://app.mysavings.test" }),
    );
    expect(resp.status).toBe(303);
    const location = resp.headers.get("location");
    expect(location).toBe("https://app.mysavings.test/login");
    expect(location).not.toContain("localhost");
    expect(location).not.toContain("127.0.0.1");
    expect(resp.headers.get("cache-control")).toBe("no-store");
    const setCookies = parseSetCookieHeaders(resp);
    expect(setCookies.length).toBeGreaterThanOrEqual(1);
    const clearHeader = setCookies.join("; ");
    // Authoritative expiry: Max-Age=0 AND explicit Expires epoch.
    expect(clearHeader).toContain("mysavings_session=");
    expect(/Max-Age=0/i.test(clearHeader)).toBe(true);
    expect(/Expires=Thu, 01 Jan 1970 00:00:00 GMT/i.test(clearHeader)).toBe(true);
    expect(/HttpOnly/i.test(clearHeader)).toBe(true);
    expect(/SameSite=Lax/i.test(clearHeader)).toBe(true);
    // In test (non-production) NODE_ENV, the Secure flag is omitted by
    // buildSessionClearCookieHeader. Confirm the empty value form.
    expect(/mysavings_session=;/i.test(clearHeader)).toBe(true);
  });
});

describe("S4-final REAL logout route: 503 after lookup succeeds but UPDATE revocation fails", () => {
  it("returns 503 + expired Set-Cookie + no-store when the UPDATE revocation fails (BEFORE UPDATE trigger)", async () => {
    await loginAsUser();
    expect(__getCookie("mysavings_session")).toBeTruthy();

    // Install a BEFORE UPDATE trigger on sessions that raises, so
    // resolveSessionDetailed succeeds (SELECT) but revokeSessionDetailed's
    // UPDATE fails. This isolates the revocation-failure path from the
    // session-lookup path and uses a real DB trigger (not a rename), as
    // required by the final regression spec.
    await withTransaction(async (client) => {
      await client.query(
        `CREATE OR REPLACE FUNCTION __block_session_update() RETURNS trigger AS $$
         BEGIN
           RAISE EXCEPTION 'simulated revocation update failure';
         END;
         $$ LANGUAGE plpgsql`,
      );
      await client.query(
        `DROP TRIGGER IF EXISTS __sessions_block_update ON sessions`,
      );
      await client.query(
        `CREATE TRIGGER __sessions_block_update BEFORE UPDATE ON sessions
         FOR EACH ROW EXECUTE FUNCTION __block_session_update()`,
      );
    });

    try {
      const resp = await POST(
        makeRequest({ origin: "https://app.mysavings.test" }),
      );
      expect(resp.status).toBe(503);
      expect(resp.headers.get("cache-control")).toBe("no-store");
      const setCookies = parseSetCookieHeaders(resp);
      expect(setCookies.length).toBeGreaterThanOrEqual(1);
      const clearHeader = setCookies.join("; ");
      expect(/Max-Age=0/i.test(clearHeader)).toBe(true);
      expect(/Expires=Thu, 01 Jan 1970 00:00:00 GMT/i.test(clearHeader)).toBe(true);
      const body = await resp.json();
      // Safe retry message; no internal session id or DB error leak.
      const msg = String(body.error).toLowerCase();
      expect(msg).toContain("logout");
      expect(msg).toContain("failed");
      expect(body.error).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      expect(body.error).not.toContain("simulated revocation update failure");
      expect(body.error).not.toContain("__block_session_update");
    } finally {
      // Drop the trigger first so resetAuthTables (which UPDATEs/DELETEs
      // sessions) does not trip on it. All in one explicit transaction.
      await withTransaction(async (client) => {
        await client.query(`DROP TRIGGER IF EXISTS __sessions_block_update ON sessions`);
        await client.query(`DROP FUNCTION IF EXISTS __block_session_update()`);
      });
    }
  });
});