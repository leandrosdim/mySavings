import "server-only";
import { hash, verify } from "@node-rs/argon2";

const HASH_MEMORY_KIB = 19_456;
const HASH_ITERATIONS = 2;
const HASH_PARALLELISM = 1;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    memoryCost: HASH_MEMORY_KIB,
    timeCost: HASH_ITERATIONS,
    parallelism: HASH_PARALLELISM,
  });
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  try {
    return await verify(encodedHash, password);
  } catch {
    return false;
  }
}

let cachedDummyHash: string | null = null;
let dummyHashCallCount = 0;

export async function getDummyHash(): Promise<string> {
  if (cachedDummyHash === null) {
    cachedDummyHash = await hashPassword(
      "dummy-password-for-timing-equalization-not-a-real-secret",
    );
  }
  dummyHashCallCount += 1;
  return cachedDummyHash;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;
export const EMAIL_MAX_LENGTH = 254;

export function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) {
    return false;
  }
  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex === email.length - 1) {
    return false;
  }
  return email === email.trim();
}

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const __testing = {
  getDummyHashCallCount: (): number => dummyHashCallCount,
  resetDummyHashCallCount: (): void => {
    dummyHashCallCount = 0;
  },
  getDummyHashValue: (): string | null => cachedDummyHash,
};