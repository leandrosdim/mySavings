import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildSafeConnectionConfig, DbConfigError, publicErrorReason, normalizeSsl } from "../../../db/db-config.cjs";
import { Client } from "pg";

describe("TLS enforcement: actual pg Client connectionParameters", () => {
  const cases: Array<[string, string, "accept" | "reject"]> = [
    ["postgresql://u:p@host/db?sslmode=verify-full", "verify-full", "accept"],
    ["postgresql://u:p@host/db?sslmode=require", "require (pg8 alias)", "accept"],
    ["postgresql://u:p@host/db?sslmode=prefer", "prefer (pg8 alias)", "accept"],
    ["postgresql://u:p@host/db?sslmode=verify-ca", "verify-ca (pg8 alias)", "accept"],
    ["postgresql://u:p@host/db?sslmode=disable", "disable", "reject"],
    ["postgresql://u:p@host/db?sslmode=no-verify", "no-verify", "reject"],
    ["postgresql://u:p@host/db?uselibpqcompat=true&sslmode=require", "uselibpqcompat", "reject"],
    ["postgresql://u:p@host/db", "no sslmode", "reject"],
  ];

  for (const [url, label, expected] of cases) {
    it(`${expected === "accept" ? "accepts" : "rejects"} ${label} at config build and pg Client level`, () => {
      let cfg: unknown;
      try {
        cfg = buildSafeConnectionConfig(url, "DATABASE_URL");
      } catch (e) {
        if (expected === "reject") {
          expect(e).toBeInstanceOf(DbConfigError);
          return;
        }
        throw e;
      }
      if (expected === "reject") {
        throw new Error(`expected ${label} to be rejected but was accepted`);
      }
      const c = new Client(cfg as ConstructorParameters<typeof Client>[0]) as Client & {
        connectionParameters: { ssl: unknown };
      };
      const actualSsl = c.connectionParameters.ssl;
      expect(actualSsl).not.toBe(false);
      if (typeof actualSsl === "object" && actualSsl !== null) {
        expect((actualSsl as { rejectUnauthorized?: unknown }).rejectUnauthorized).not.toBe(false);
      }
    });
  }
});

describe("TLS enforcement: rejectUnauthorized pinned true on accepted configs", () => {
  it("sets rejectUnauthorized true on verify-full config object", () => {
    const cfg = buildSafeConnectionConfig(
      "postgresql://u:p@host/db?sslmode=verify-full",
      "DATABASE_URL",
    ) as { ssl: { rejectUnauthorized: boolean } };
    expect(cfg.ssl.rejectUnauthorized).toBe(true);
  });
});

describe("normalizeSsl", () => {
  it("returns null for false/undefined (TLS disabled)", () => {
    expect(normalizeSsl(false)).toBeNull();
    expect(normalizeSsl(undefined)).toBeNull();
  });
  it("returns {} for true", () => {
    expect(normalizeSsl(true)).toEqual({});
  });
  it("returns the object for object input", () => {
    expect(normalizeSsl({ rejectUnauthorized: true })).toEqual({ rejectUnauthorized: true });
  });
});

describe("publicErrorReason: never leaks raw external messages", () => {
  const SECRET = "secret_marker_xyz_host_user_123";

  it("returns a safe generic reason for a pg error with a secret message", () => {
    const error = new Error(`connection failed at ${SECRET} password=abc`);
    (error as Error & { code: string }).code = "ECONNREFUSED";
    const reason = publicErrorReason(error);
    expect(reason.code).toBe("DB_ERROR");
    expect(reason.reason).not.toContain(SECRET);
    expect(JSON.stringify(reason)).not.toContain(SECRET);
  });

  it("returns a safe generic reason for a custom exception with secret detail", () => {
    const error = new Error(`detail: ${SECRET}`);
    const reason = publicErrorReason(error);
    expect(reason.reason).not.toContain(SECRET);
  });

  it("preserves DbConfigError messages (config reasons, no DB host/user)", () => {
    const error = new DbConfigError("Missing required env DATABASE_URL");
    const reason = publicErrorReason(error);
    expect(reason.code).toBe("DB_CONFIG_ERROR");
    expect(reason.reason).toBe("Missing required env DATABASE_URL");
  });

  it("never logs arbitrary error.name", () => {
    const error = new Error("boom");
    (error as Error & { name: string }).name = SECRET;
    const reason = publicErrorReason(error);
    expect(JSON.stringify(reason)).not.toContain(SECRET);
  });

  it("preserves migration-safe-code messages", () => {
    const error = new Error("Checksum mismatch for 0001");
    (error as Error & { code: string }).code = "MIGRATION_CHECKSUM_MISMATCH";
    const reason = publicErrorReason(error);
    expect(reason.code).toBe("MIGRATION_CHECKSUM_MISMATCH");
    expect(reason.reason).toBe("Checksum mismatch for 0001");
  });
});

describe("db-check and migration CLI do not log raw error.message", () => {
  const SECRET = "secret_host_user_literal_456";

  it("db-check publicErrorReason on a thrown DB error with secret", () => {
    const error = new Error(`ECONNREFUSED ${SECRET}`);
    (error as Error & { code: string }).code = "ECONNREFUSED";
    const reason = publicErrorReason(error);
    expect(reason.code).toBe("DB_ERROR");
    expect(reason.reason).not.toContain(SECRET);
  });

  it("migration publicErrorReason on a thrown DB error with secret", () => {
    const error = new Error(`syntax error at or near "${SECRET}"`);
    const reason = publicErrorReason(error);
    expect(reason.code).toBe("DB_ERROR");
    expect(reason.reason).not.toContain(SECRET);
  });
});