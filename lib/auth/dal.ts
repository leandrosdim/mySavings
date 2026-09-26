import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import {
  resolveSession,
  resolveSessionDetailed,
  revokeSessionDetailed,
  clearSessionCookie,
  validateSessionConfig,
  type AuthenticatedSession,
} from "./session";
import { query } from "@/lib/db";

export type SafeUser = {
  id: string;
  email: string;
};

export const verifySession = cache(async (): Promise<AuthenticatedSession> => {
  const session = await resolveSession();
  if (!session) {
    redirect("/login");
  }
  return session;
});

export const verifyApiSession = cache(
  async (): Promise<
    { ok: true; session: AuthenticatedSession } | { ok: false; reason: "unauthenticated" | "unavailable" }
  > => {
    const outcome = await resolveSessionDetailed();
    if (outcome.status === "valid") {
      return { ok: true, session: outcome.session };
    }
    if (outcome.status === "unavailable") {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: false, reason: "unauthenticated" };
  },
);

export const getOptionalSession = cache(async (): Promise<AuthenticatedSession | null> => {
  return resolveSession();
});

export const getCurrentUser = cache(async (): Promise<SafeUser | null> => {
  const session = await resolveSession();
  if (!session) {
    return null;
  }
  return { id: session.userId, email: session.email };
});

export type LogoutResult = {
  cookieCleared: boolean;
  revocationSucceeded: boolean;
  dbError: boolean;
  hadSession: boolean;
  // Distinguishes a genuine DB unavailability (transient outage) from a
  // mere lookup miss (no_cookie / invalid / expired / revoked). Only
  // unavailable is a real dbError that leaves the local cookie in place
  // pending explicit clearing; invalid/no_cookie mean there is nothing to
  // revoke and revocationSucceeded stays false (no live row was revoked).
  lookupStatus: "valid" | "no_cookie" | "invalid" | "unavailable";
};

export async function logout(): Promise<LogoutResult> {
  validateSessionConfig();
  const outcome = await resolveSessionDetailed();
  let hadSession = false;
  let revocationSucceeded = false;
  let dbError = false;
  let lookupStatus: LogoutResult["lookupStatus"] = "no_cookie";

  if (outcome.status === "valid") {
    hadSession = true;
    lookupStatus = "valid";
    const revokeResult = await revokeSessionDetailed(outcome.session.sessionId);
    revocationSucceeded = revokeResult.revoked;
    dbError = revokeResult.dbError;
  } else if (outcome.status === "unavailable") {
    dbError = true;
    lookupStatus = "unavailable";
  } else {
    // no_cookie or invalid: nothing to revoke. revocationSucceeded stays
    // false (no live row was revoked); dbError stays false (the lookup
    // succeeded, it just found no live session).
    lookupStatus = outcome.status;
  }

  const cookieCleared = await clearSessionCookie();

  return {
    cookieCleared,
    revocationSucceeded,
    dbError,
    hadSession,
    lookupStatus,
  };
}

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
};

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `SELECT id::text, email, password_hash FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  return result.rows[0] ?? null;
}