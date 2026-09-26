import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

const mockPool = {
  connect: vi.fn(),
  on: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};

vi.mock("pg", () => ({
  Pool: function MockPool() {
    return mockPool;
  },
}));

const { withTransaction, closePool } = await import("../../../lib/db");

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test:test@host/db?sslmode=verify-full";
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockPool.connect.mockReset();
  mockPool.connect.mockResolvedValue(mockClient);
});

afterEach(async () => {
  await closePool();
});

describe("withTransaction mocked: BEGIN failure", () => {
  it("destroys the client and rethrows when BEGIN fails", async () => {
    mockClient.query.mockRejectedValueOnce(new Error("BEGIN failed"));

    await expect(
      withTransaction(async () => "unused"),
    ).rejects.toThrow("BEGIN failed");

    expect(mockClient.release).toHaveBeenCalledTimes(1);
    const arg = mockClient.release.mock.calls[0][0];
    expect(arg).toBeInstanceOf(Error);
    expect((arg as Error).message).toBe("BEGIN failed");
  });
});

describe("withTransaction mocked: callback failure + rollback success", () => {
  it("rolls back and releases (returns to pool) on callback error", async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(
      withTransaction(async (c) => {
        await c.query("SELECT 1");
        throw new Error("work error");
      }),
    ).rejects.toThrow("work error");

    const calls = mockClient.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain("BEGIN");
    expect(calls).toContain("ROLLBACK");
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(mockClient.release.mock.calls[0][0]).toBeUndefined();
  });
});

describe("withTransaction mocked: COMMIT failure", () => {
  it("destroys the client and rethrows when COMMIT fails", async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("COMMIT failed"));

    await expect(
      withTransaction(async (c) => {
        await c.query("SELECT 1");
        return undefined;
      }),
    ).rejects.toThrow("COMMIT failed");

    const calls = mockClient.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain("BEGIN");
    expect(calls).toContain("COMMIT");
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    const arg = mockClient.release.mock.calls[0][0];
    expect(arg).toBeInstanceOf(Error);
  });
});

describe("withTransaction mocked: rollback failure destroys client", () => {
  it("destroys the client when ROLLBACK fails, preserving the original work error", async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("rollback failed"));

    await expect(
      withTransaction(async (c) => {
        await c.query("SELECT 1");
        throw new Error("work error");
      }),
    ).rejects.toThrow("work error");

    const calls = mockClient.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain("ROLLBACK");
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    const arg = mockClient.release.mock.calls[0][0];
    expect(arg).toBeInstanceOf(Error);
    expect((arg as Error).message).toBe("rollback failed");
  });
});

describe("withTransaction mocked: pool.connect rejection", () => {
  it("rethrows when pool.connect rejects without calling release", async () => {
    mockPool.connect.mockReset();
    mockPool.connect.mockRejectedValue(new Error("connect failed"));

    await expect(
      withTransaction(async () => "unused"),
    ).rejects.toThrow("connect failed");

    expect(mockClient.release).not.toHaveBeenCalled();
  });
});

describe("withTransaction mocked: client released exactly once", () => {
  it("releases the client exactly once on success", async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const result = await withTransaction(async (c) => {
      await c.query("SELECT 1");
      return 42;
    });
    expect(result).toBe(42);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(mockClient.release.mock.calls[0][0]).toBeUndefined();
  });
});