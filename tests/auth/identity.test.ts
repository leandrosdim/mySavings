// S4-05 same-device identity switching and direct privileged-action exposure
// regressions.
//
// Same-device user switching: after user A logs out and user B logs in on the
// same device, A's session must NOT resolve and B's must. After B logs out,
// neither resolves. Private data must not survive logout in app caches (the
// cookie store mock is reset between tests; production uses iron-session
// destroy + Max-Age=0).
//
// Direct privileged action exposure: the API guard (requireApiSession /
// requireApiUser) returns JSON 401/503 independently of any proxy. A direct
// call to a privileged function without going through the guard must NOT
// leak data — ownership is always derived from the verified server session,
// never from client input. The API guard alone does not provide financial
// isolation; it only gates access. Scoped reads/writes must use the
// session's userId in their WHERE clauses (two-user isolation).

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import {
  setupAuthSchema,
  teardownAuthSchema,
  insertTestUser,
  resetAuthTables,
  type AuthTestContext,
} from "./helpers";
import { hashPassword } from "../../lib/auth/password";
import { loginAction } from "../../lib/auth/actions";
import { resolveSession, revokeAllUserSessions } from "../../lib/auth/session";
import { requireApiSession, requireApiUser } from "../../lib/auth/api-guard";
import { query } from "../../lib/db";
import { __resetCookieStore } from "../__mocks__/next/headers";

const ctxRef: { ctx: AuthTestContext } = {} as { ctx: AuthTestContext };

const emailA = "switch-a@step04.test.local";
const emailB = "switch-b@step04.test.local";
const passwordA = "SwitchPasswordA!2026";
const passwordB = "SwitchPasswordB!2026";
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

async function logoutViaAction(): Promise<void> {
  const { logoutAction } = await import("../../lib/auth/actions");
  try {
    await logoutAction();
  } catch (error) {
    if (!isRedirectError(error)) throw error;
  }
}

describe("same-device user switching", () => {
  it("user A logs in, then logs out, then user B logs in — A's session no longer resolves", async () => {
    // User A logs in.
    try {
      await loginAction(undefined, formData({ email: emailA, password: passwordA }));
    } catch (error) {
      if (!isRedirectError(error)) throw error;
    }
    const sessionA = await resolveSession();
    expect(sessionA).not.toBeNull();
    expect(sessionA!.userId).toBe(userAId);

    // User A logs out.
    await logoutViaAction();
    const afterLogout = await resolveSession();
    expect(afterLogout).toBeNull();

    // User B logs in on the same device.
    try {
      await loginAction(undefined, formData({ email: emailB, password: passwordB }));
    } catch (error) {
      if (!isRedirectError(error)) throw error;
    }
    const sessionB = await resolveSession();
    expect(sessionB).not.toBeNull();
    expect(sessionB!.userId).toBe(userBId);
    expect(sessionB!.userId).not.toBe(userAId);
  });

  it("after both users log out, neither session resolves", async () => {
    // A logs in and out.
    try {
      await loginAction(undefined, formData({ email: emailA, password: passwordA }));
    } catch (error) {
      if (!isRedirectError(error)) throw error;
    }
    await logoutViaAction();

    // B logs in and out.
    try {
      await loginAction(undefined, formData({ email: emailB, password: passwordB }));
    } catch (error) {
      if (!isRedirectError(error)) throw error;
    }
    await logoutViaAction();

    const session = await resolveSession();
    expect(session).toBeNull();
  });

  it("revoking all of A's sessions does not affect B's active session (two-user isolation)", async () => {
    // A logs in.
    try {
      await loginAction(undefined, formData({ email: emailA, password: passwordA }));
    } catch (error) {
      if (!isRedirectError(error)) throw error;
    }
    const sessionA = await resolveSession();
    expect(sessionA!.userId).toBe(userAId);

    // Capture A's session cookie value before creating B's session.
    const { __getCookie, __setCookie } = await import("../__mocks__/next/headers");
    const cookieA = __getCookie("mysavings_session");

    // B also has a session (create directly for isolation test). This
    // overwrites the cookie store with B's session.
    const { createSession } = await import("../../lib/auth/session");
    await createSession(userBId);

    // Revoke all of A's sessions.
    const count = await revokeAllUserSessions(userAId);
    expect(count).toBeGreaterThanOrEqual(1);

    // Restore A's cookie to verify A's session is revoked.
    __setCookie("mysavings_session", cookieA!);
    const afterRevoke = await resolveSession();
    expect(afterRevoke).toBeNull();

    // B's sessions are unaffected.
    const bCount = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [userBId],
    );
    expect(bCount.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});

describe("direct privileged action exposure (API guard)", () => {
  it("requireApiSession returns 401 JSON when no session exists", async () => {
    const result = await requireApiSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body.error).toBe("Authentication required");
    }
  });

  it("requireApiUser returns userId from the verified session, not from client input", async () => {
    // Log in as A.
    try {
      await loginAction(undefined, formData({ email: emailA, password: passwordA }));
    } catch (error) {
      if (!isRedirectError(error)) throw error;
    }
    const result = await requireApiUser();
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The userId comes from the server-side session, never from any
      // client-supplied field.
      expect(result.userId).toBe(userAId);
      expect(result.email).toBe(emailA);
    }
  });

  it("API guard alone is not financial isolation — ownership must be enforced in queries", async () => {
    // Log in as A.
    try {
      await loginAction(undefined, formData({ email: emailA, password: passwordA }));
    } catch (error) {
      if (!isRedirectError(error)) throw error;
    }
    const guard = await requireApiUser();
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;
    const userId = guard.userId;

    // A scoped query using the session userId must only see A's data.
    // Insert a session for B to simulate B's data existing.
    const { createSession } = await import("../../lib/auth/session");
    await createSession(userBId);

    // A query scoped by the session userId must NOT return B's sessions.
    const result = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    expect(result.rows[0].n).toBe(1); // Only A's session.
  });
});