import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";

describe("app/manifest.ts", () => {
  const m = manifest();

  it("has a stable id", () => {
    expect(typeof m.id).toBe("string");
    expect(m.id!.length).toBeGreaterThan(0);
  });

  it("uses standalone display", () => {
    expect(m.display).toBe("standalone");
  });

  it("start_url and scope are root-relative", () => {
    expect(m.start_url).toMatch(/^\//);
    expect(m.scope).toBe("/");
  });

  it("declares 192 and 512 icons plus a maskable icon", () => {
    const icons = m.icons ?? [];
    const sizes = icons.map((i) => i.sizes).join(",");
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    const maskable = icons.find((i) => i.purpose === "maskable");
    expect(maskable).toBeDefined();
    expect(maskable?.type).toBe("image/png");
  });

  it("icons reference /icons/ PNG assets (no data URIs)", () => {
    for (const icon of m.icons ?? []) {
      expect(icon.src).toMatch(/^\/icons\/.*\.png$/);
    }
  });

  it("declares theme and background colors", () => {
    expect(m.theme_color).toBe("#059669");
    expect(typeof m.background_color).toBe("string");
  });

  it("is noindex via metadata (handled in layout), manifest has no private URLs", () => {
    const urls = [
      m.start_url ?? "",
      ...(m.shortcuts ?? []).map((s) => s.url ?? ""),
    ];
    for (const u of urls) {
      expect(u.startsWith("/api/")).toBe(false);
      expect(u.includes("token")).toBe(false);
    }
  });
});