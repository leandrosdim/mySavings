import "server-only";
import { hashPassword, isValidEmail, isValidPassword, normalizeEmail } from "./password";
import { findUserByEmail } from "./dal";
import { resetUserPassword } from "./session";
import { withTransaction, query } from "@/lib/db";

export type ProvisionResult =
  | { ok: true; created: boolean }
  | { ok: false; error: string };

export async function provisionUser(
  email: string,
  password: string,
): Promise<ProvisionResult> {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    return { ok: false, error: "Invalid email." };
  }
  if (!isValidPassword(password)) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const existing = await findUserByEmail(normalizedEmail);
  const passwordHash = await hashPassword(password);

  if (existing) {
    return { ok: false, error: "A user with that email already exists. Use resetUserPassword to change the password." };
  }

  try {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2)`,
        [normalizedEmail, passwordHash],
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/duplicate/i.test(message)) {
      return { ok: false, error: "A user with that email already exists." };
    }
    return { ok: false, error: "Provisioning failed." };
  }
  return { ok: true, created: true };
}

export async function resetPassword(
  email: string,
  newPassword: string,
): Promise<ProvisionResult> {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    return { ok: false, error: "Invalid email." };
  }
  if (!isValidPassword(newPassword)) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const existing = await findUserByEmail(normalizedEmail);
  if (!existing) {
    return { ok: false, error: "User not found." };
  }

  const newPasswordHash = await hashPassword(newPassword);
  await resetUserPassword(existing.id, newPasswordHash);
  return { ok: true, created: false };
}

export async function provisionOrReset(
  email: string,
  password: string,
  reset: boolean,
): Promise<ProvisionResult> {
  if (reset) {
    return resetPassword(email, password);
  }
  return provisionUser(email, password);
}