import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function installFakeDocument(initialOverflow: string) {
  const style = { overflow: initialOverflow };
  vi.stubGlobal("document", { body: { style } });
  return style;
}

async function loadScrollLock() {
  return import("@/components/ui/scroll-lock");
}

describe("scroll lock", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("locks the body while acquired and restores the original value on release", async () => {
    const style = installFakeDocument("");
    const { acquireScrollLock, releaseScrollLock } = await loadScrollLock();

    acquireScrollLock();
    expect(style.overflow).toBe("hidden");

    releaseScrollLock();
    expect(style.overflow).toBe("");
  });

  it("preserves a pre-existing non-empty body overflow value", async () => {
    const style = installFakeDocument("scroll");
    const { acquireScrollLock, releaseScrollLock } = await loadScrollLock();

    acquireScrollLock();
    expect(style.overflow).toBe("hidden");

    releaseScrollLock();
    expect(style.overflow).toBe("scroll");
  });

  it("keeps the body locked until the last nested sheet closes", async () => {
    const style = installFakeDocument("");
    const { acquireScrollLock, releaseScrollLock } = await loadScrollLock();

    acquireScrollLock();
    acquireScrollLock();

    releaseScrollLock();
    expect(style.overflow).toBe("hidden");

    releaseScrollLock();
    expect(style.overflow).toBe("");
  });

  it("restores the original value when stacked sheets close in the same commit (stuck hidden after payment)", async () => {
    const style = installFakeDocument("");
    const { acquireScrollLock, releaseScrollLock } = await loadScrollLock();

    acquireScrollLock();
    acquireScrollLock();

    releaseScrollLock();
    releaseScrollLock();

    expect(style.overflow).toBe("");
  });

  it("survives an unbalanced release without corrupting the lock", async () => {
    const style = installFakeDocument("");
    const { acquireScrollLock, releaseScrollLock } = await loadScrollLock();

    releaseScrollLock();
    expect(style.overflow).toBe("");

    acquireScrollLock();
    expect(style.overflow).toBe("hidden");

    releaseScrollLock();
    expect(style.overflow).toBe("");
  });
});