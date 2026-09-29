import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { offlineSubmitGuard } from "@/lib/ui/form-helpers";

describe("offlineSubmitGuard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok when online", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(offlineSubmitGuard()).toEqual({ ok: true });
  });

  it("returns a Greek error when offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    const res = offlineSubmitGuard();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.length).toBeGreaterThan(0);
      expect(res.error).toContain("Χωρίς σύνδεση");
    }
  });

  it("returns ok when navigator is undefined (SSR / first paint)", () => {
    vi.stubGlobal("navigator", undefined);
    expect(offlineSubmitGuard()).toEqual({ ok: true });
  });
});

describe("offlineSubmitGuard does not queue", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { onLine: false });
  });

  it("never returns a retry handle or queue reference", () => {
    const res = offlineSubmitGuard();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res).not.toHaveProperty("queue");
      expect(res).not.toHaveProperty("retry");
      expect(res).not.toHaveProperty("pending");
    }
  });
});