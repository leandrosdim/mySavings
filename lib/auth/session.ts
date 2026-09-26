import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { randomUUID } from "node:crypto";
import { withTransaction, type PoolClient } from "@/lib/db";

const SESSION_COOKIE_NAME = "mysavings_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SESSION_SECRET_KEY = "SESSION_SECRET";
const SESSION_SECRET_MIN_LENGTH = 32;

export type SessionPayload = {
  sessionId: string;
};

export type AuthenticatedSession = {
  sessionId: string;
  userId: string;
  email: string;
};

export type ResolveOutcome =
  | { status: "valid"; session: AuthenticatedSession }
  | { status: "no_cookie" }
  | { status: "invalid" }
  | { status: "unavailable" };

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

export class CookieSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookieSaveError";
  }
}

function readSessionSecret(): string {
  const value = process.env[SESSION_SECRET_KEY];
  if (typeof value !== "string" || value.length < SESSION_SECRET_MIN_LENGTH) {
    throw new AuthConfigError(
      `Missing or too-short ${SESSION_SECRET_KEY} (min ${SESSION_SECRET_MIN_LENGTH} chars)`,
    );
  }
  return value;
}

export function validateSessionConfig(): void {
  readSessionSecret();
}

function sessionOptions(): SessionOptions {
  return {
    password: readSessionSecret(),
    cookieName: SESSION_COOKIE_NAME,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    },
    ttl: SESSION_TTL_SECONDS,
  };
}

async function getIronSessionData() {
  const cookieStore = await cookies();
  return getIronSession<SessionPayload>(cookieStore, sessionOptions());
}

type SessionRow = {
  id: string;
  user_id: string;
  email: string;
  expires_at: Date;
  revoked_at: Date | null;
  password_hash: string;
};

async function fetchSessionRow(
  client: PoolClient,
  sessionId: string,
): Promise<SessionRow | null> {
  const result = await client.query<SessionRow>(
    `SELECT s.id, s.user_id, u.email, s.expires_at, s.revoked_at, u.password_hash
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [sessionId],
  );
  return result.rows[0] ?? null;
}

export type CreateSessionResult = {
  sessionId: string;
  cookieSaved: boolean;
};

export async function createSessionWithCredentialCheck(
  userId: string,
  expectedPasswordHash: string,
): Promise<CreateSessionResult> {
  // Validate config BEFORE any DB write so a missing/short SESSION_SECRET
  // cannot leave an orphan session row. AuthConfigError propagates
  // untouched (it is a config error, not a partial-failure state).
  validateSessionConfig();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await withTransaction(async (client) => {
    const userResult = await client.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (userResult.rows.length === 0) {
      throw new Error("User not found during session creation");
    }
    if (userResult.rows[0].password_hash !== expectedPasswordHash) {
      throw new CredentialChangedError(
        "Credential hash changed during session issuance; aborting to prevent old-password session",
      );
    }
    await client.query(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
      [sessionId, userId, expiresAt],
    );
  });

  // The session row is now committed. iron-session initialization
  // (getIronSessionData) happens OUTSIDE the insert transaction and
  // OUTSIDE the save-failure cleanup try: if it throws (e.g. malformed
  // cookie store, iron-session internal error), we must still roll back
  // the committed row. We catch here, attempt cleanup, and throw a
  // sanitized CookieSaveError so no internal session id or DB detail
  // leaks to the caller. If cleanup itself fails, we still throw
  // CookieSaveError — the orphan row will expire naturally.
  let session;
  try {
    session = await getIronSessionData();
  } catch {
    await cleanupSessionRowSafe(sessionId);
    throw new CookieSaveError(
      "Failed to initialize session cookie; session row rolled back",
    );
  }

  session.sessionId = sessionId;
  try {
    await session.save();
  } catch {
    await cleanupSessionRowSafe(sessionId);
    throw new CookieSaveError(
      "Failed to save session cookie; session row rolled back",
    );
  }
  return { sessionId, cookieSaved: true };
}

// Best-effort deletion of a just-inserted session row when cookie
// initialization or save fails. Errors are swallowed and NEVER propagated:
// a cleanup failure must not mask the original CookieSaveError or leak the
// session id / DB internals to the caller. The orphaned row will expire
// naturally per SESSION_TTL_SECONDS if cleanup fails. This is intentionally
// not exported (internal rollback helper).
async function cleanupSessionRowSafe(sessionId: string): Promise<void> {
  try {
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    });
  } catch {
    // Swallow: never leak the session id or DB error to the caller. The
    // orphan row expires naturally; the user has no cookie and must
    // re-authenticate.
  }
}

export class CredentialChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialChangedError";
  }
}

export async function resolveSession(): Promise<AuthenticatedSession | null> {
  const outcome = await resolveSessionDetailed();
  if (outcome.status === "valid") {
    return outcome.session;
  }
  return null;
}

export async function resolveSessionDetailed(): Promise<ResolveOutcome> {
  const session = await getIronSessionData();
  if (!session.sessionId) {
    return { status: "no_cookie" };
  }
  const sessionId = session.sessionId;
  try {
    return await withTransaction(async (client) => {
      const row = await fetchSessionRow(client, sessionId);
      if (!row) {
        return { status: "invalid" } as const;
      }
      if (row.revoked_at !== null) {
        return { status: "invalid" } as const;
      }
      if (row.expires_at.getTime() <= Date.now()) {
        return { status: "invalid" } as const;
      }
      return {
        status: "valid",
        session: {
          sessionId: row.id,
          userId: row.user_id,
          email: row.email,
        },
      } as const;
    });
  } catch {
    return { status: "unavailable" };
  }
}

// Clear (destroy) the iron-session cookie. Returns true only when the
// cookie store accepted the destroy and the in-memory value is gone.
// Returns false when iron-session initialization or destroy throws — the
// caller MUST NOT report cookieCleared=true in that case. The explicit
// Set-Cookie header built by buildSessionClearCookieHeader() is the
// authoritative clearing mechanism used by the logout route; this helper
// is the in-process iron-session destroy used by the DAL/action path.
export async function clearSessionCookie(): Promise<boolean> {
  let session;
  try {
    session = await getIronSessionData();
  } catch {
    return false;
  }
  try {
    session.destroy();
  } catch {
    return false;
  }
  return true;
}

// Build a Set-Cookie header that authoritatively expires the session cookie.
// Both Max-Age=0 and an explicit Expires epoch are emitted: Next's response
// cookie machinery merges cookie-store writes with response Set-Cookie headers
// and has been observed dropping Max-Age=0 on the merged value, leaving the
// browser with an empty-value cookie that has no expiry directive. The
// explicit Expires epoch (Thu, 01 Jan 1970 00:00:00 GMT) is a stable fallback
// that every browser honors as "already expired", so the merged response
// actually deletes the cookie regardless of which directive Next preserves.
export function buildSessionClearCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production";
  const secureFlag = secure ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secureFlag}`;
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export type RevokeResult = {
  revoked: boolean;
  dbError: boolean;
};

export async function revokeSessionDetailed(
  sessionId: string,
): Promise<RevokeResult> {
  try {
    const result = await withTransaction(async (client) => {
      const updateResult = await client.query(
        `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
        [sessionId],
      );
      return updateResult.rowCount ?? 0;
    });
    return { revoked: result > 0, dbError: false };
  } catch {
    return { revoked: false, dbError: true };
  }
}

export async function revokeSession(sessionId: string): Promise<void> {
  await revokeSessionDetailed(sessionId);
  await clearSessionCookie();
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await withTransaction(async (client) => {
    const updateResult = await client.query<{ id: string }>(
      `UPDATE sessions SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL
       RETURNING id`,
      [userId],
    );
    return updateResult.rowCount ?? 0;
  });
  return result;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  });
  await clearSessionCookie();
}

export async function getCurrentSession(): Promise<SessionPayload | null> {
  const session = await getIronSessionData();
  if (!session.sessionId) {
    return null;
  }
  return { sessionId: session.sessionId };
}

export async function resetUserPassword(
  userId: string,
  newPasswordHash: string,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    await client.query(
      `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
      [newPasswordHash, userId],
    );
    await client.query(
      `UPDATE sessions SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  });
}

// Test/CLI-only direct session creation that skips the credential-revalidation
// barrier. Production login MUST use createSessionWithCredentialCheck so that a
// reset racing with issuance cannot create a session bound to a stale hash.
// Guarded: refuses to run in production builds.
export async function createSession(userId: string): Promise<string> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("createSession is test-only; production must use createSessionWithCredentialCheck");
  }
  validateSessionConfig();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
      [sessionId, userId, expiresAt],
    );
  });
  const session = await getIronSessionData();
  session.sessionId = sessionId;
  await session.save();
  return sessionId;
}

export const __testing = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  fetchSessionRow,
};

export type { SessionRow };