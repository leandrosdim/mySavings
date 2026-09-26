"use server";

import { redirect } from "next/navigation";
import { findUserByEmail, logout } from "./dal";
import { verifyPassword, isValidEmail, isValidPassword, normalizeEmail, getDummyHash } from "./password";
import { createSessionWithCredentialCheck, CredentialChangedError } from "./session";
import { admitLoginAttempt, recordSuccess, type LoginAttemptResult } from "./rate-limit";
import type { LoginState } from "./types";
import type { PoolClient } from "@/lib/db";

export type { LoginState };

const GENERIC_ERROR = "Invalid email or password.";
const RATE_LIMITED_ERROR = "Too many failed attempts. Try again in a few minutes.";
const BUSY_ERROR = "Server is busy processing another login. Please retry shortly.";

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!isValidEmail(email) || !isValidPassword(password)) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const normalizedEmail = normalizeEmail(email);

  // Admission is atomic and happens BEFORE any credential lookup or hashing.
  // The callback receives a PoolClient inside the admission transaction and
  // performs the user lookup + real/dummy Argon2 verification. The callback
  // MUST NOT throw for expected failures (wrong password); it returns
  // passwordOk=false. Genuine errors (DB down) propagate and roll back the
  // transaction without recording an attempt.
  const outcome = await admitLoginAttempt(normalizedEmail, async (client: PoolClient): Promise<LoginAttemptResult> => {
    const result = await client.query<{ id: string; email: string; password_hash: string }>(
      `SELECT id::text, email, password_hash FROM users WHERE lower(email) = lower($1)`,
      [normalizedEmail],
    );
    const userRow = result.rows[0] ?? null;

    if (!userRow) {
      // Unknown email: perform a real Argon2 verification against a dummy hash
      // for timing equalization, then return passwordOk=false.
      const dummyHash = await getDummyHash();
      await verifyPassword(password, dummyHash);
      return { userFound: false, passwordOk: false };
    }

    const passwordOk = await verifyPassword(password, userRow.password_hash);
    return {
      userFound: true,
      passwordOk,
      userId: userRow.id,
      passwordHash: userRow.password_hash,
    };
  });

  if (outcome.status === "busy") {
    return { ok: false, error: BUSY_ERROR };
  }

  if (outcome.status === "rate_limited") {
    return { ok: false, error: RATE_LIMITED_ERROR };
  }

  // outcome.status === "admitted"
  const { result } = outcome;

  if (!result.userFound || !result.passwordOk) {
    // The failure attempt was already recorded inside the admission
    // transaction. recordSuccess is NOT called here (it's for success only).
    return { ok: false, error: GENERIC_ERROR };
  }

  // Success path: the success attempt was recorded inside the admission
  // transaction. Now issue the session with credential revalidation.
  // The userId and passwordHash come from the callback's credential row,
  // captured under the admission lock. createSessionWithCredentialCheck
  // revalidates the hash under a FOR UPDATE lock to handle resets that
  // committed between the admission transaction and now.
  try {
    await createSessionWithCredentialCheck(result.userId!, result.passwordHash!);
  } catch (error) {
    if (error instanceof CredentialChangedError) {
      return { ok: false, error: GENERIC_ERROR };
    }
    return { ok: false, error: GENERIC_ERROR };
  }

  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const result = await logout();
  if (result.dbError) {
    // Honest safe failure: the cookie was cleared locally (best-effort) so
    // the user is effectively logged out on this device, but the server-side
    // session revocation failed. We do NOT fake a normal /login redirect
    // that would hide the DB failure from the caller. The unrevoked server
    // session will expire naturally per SESSION_TTL_SECONDS. Throw a
    // safe, generic error so the Server Action surface reports failure
    // rather than silently looking like a clean logout. The caller (UI /
    // tests) can catch this and surface a retry message; the explicit
    // /api/auth/logout route is the recommended logout path and returns a
    // structured 503 on the same condition.
    throw new Error(
      "Logout partially failed: local session cleared, but the server could not revoke the session record. It will expire automatically.",
    );
  }
  redirect("/login");
}