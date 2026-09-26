import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  hashPassword,
  verifyPassword,
  isValidEmail,
  isValidPassword,
  PASSWORD_MIN_LENGTH,
  getDummyHash,
  __testing,
} from "../../lib/auth/password";

describe("password hashing", () => {
  it("hashes a password and verifies it correctly", async () => {
    const hash = await hashPassword("correct-password-123");
    expect(hash).not.toBe("correct-password-123");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    const ok = await verifyPassword("correct-password-123", hash);
    expect(ok).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct-password-123");
    const ok = await verifyPassword("wrong-password-456", hash);
    expect(ok).toBe(false);
  });

  it("returns false for a corrupted hash instead of throwing", async () => {
    const ok = await verifyPassword("any-password", "not-a-valid-hash");
    expect(ok).toBe(false);
  });

  it("produces different hashes for the same password (salted)", async () => {
    const hash1 = await hashPassword("same-password-789");
    const hash2 = await hashPassword("same-password-789");
    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword("same-password-789", hash1)).toBe(true);
    expect(await verifyPassword("same-password-789", hash2)).toBe(true);
  });
});

describe("email validation", () => {
  it("accepts a normal email", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });

  it("rejects missing @", () => {
    expect(isValidEmail("userexample.com")).toBe(false);
  });

  it("rejects @ at start", () => {
    expect(isValidEmail("@example.com")).toBe(false);
  });

  it("rejects @ at end", () => {
    expect(isValidEmail("user@")).toBe(false);
  });

  it("rejects email over max length", () => {
    expect(isValidEmail("a".repeat(250) + "@x.com")).toBe(false);
  });
});

describe("password validation", () => {
  it("accepts a password at min length", () => {
    expect(isValidPassword("a".repeat(PASSWORD_MIN_LENGTH))).toBe(true);
  });

  it("rejects a password below min length", () => {
    expect(isValidPassword("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
  });

  it("rejects an empty password", () => {
    expect(isValidPassword("")).toBe(false);
  });

  it("rejects a password over max length", () => {
    expect(isValidPassword("a".repeat(257))).toBe(false);
  });
});

// S4-05 timing-equalization regression: an unknown email MUST run a real
// Argon2id verification against a fixed dummy hash at the same parameters as a
// known user, so the login path spends comparable CPU regardless of whether the
// email exists. This exercises the dummy-hash path directly.
describe("S4-05 dummy hash timing equalization", () => {
  beforeEach(() => {
    __testing.resetDummyHashCallCount();
  });

  afterEach(() => {
    __testing.resetDummyHashCallCount();
  });

  it("getDummyHash returns a valid argon2id hash", async () => {
    const dummy = await getDummyHash();
    expect(dummy.startsWith("$argon2id$")).toBe(true);
  });

  it("getDummyHash is cached so repeated unknown-email checks share one hash", async () => {
    const first = await getDummyHash();
    const second = await getDummyHash();
    expect(first).toBe(second);
    expect(__testing.getDummyHashCallCount()).toBe(2);
    expect(__testing.getDummyHashValue()).toBe(first);
  });

  it("verifyPassword against the dummy hash performs real Argon2 work", async () => {
    const dummy = await getDummyHash();
    const ok = await verifyPassword("any-unknown-password", dummy);
    expect(ok).toBe(false);
  });
});