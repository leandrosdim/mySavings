import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PWA_CACHE_NAME,
  PWA_PRECACHE_URLS,
  PWA_SW_PATH,
  PWA_OFFLINE_PATH,
  PWA_SCOPE,
} from "@/lib/pwa/constants";

const SW_SOURCE = readFileSync(
  resolve("public/sw.js"),
  "utf8",
);

describe("service worker version matches constants", () => {
  it("embeds the same CACHE_NAME as PWA_CACHE_NAME", () => {
    expect(SW_SOURCE).toContain(`const CACHE_NAME = "${PWA_CACHE_NAME}"`);
  });

  it("uses the same offline URL as PWA_OFFLINE_PATH", () => {
    expect(SW_SOURCE).toContain(`const OFFLINE_URL = "${PWA_OFFLINE_PATH}"`);
  });
});

describe("service worker precache allowlist", () => {
  it("embeds exactly the PWA_PRECACHE_URLS list", () => {
    for (const url of PWA_PRECACHE_URLS) {
      expect(SW_SOURCE).toContain(`"${url}"`);
    }
  });

  it("contains only public static assets (no api/auth/private paths)", () => {
    for (const url of PWA_PRECACHE_URLS) {
      expect(url.startsWith("/api/")).toBe(false);
      expect(url.startsWith("/dashboard")).toBe(false);
      expect(url.startsWith("/accounts")).toBe(false);
      expect(url.startsWith("/plan")).toBe(false);
      expect(url.startsWith("/activity")).toBe(false);
      expect(url.startsWith("/history")).toBe(false);
      expect(url.startsWith("/months")).toBe(false);
      expect(url.includes("_next/data")).toBe(false);
    }
  });
});

describe("service worker privacy invariants", () => {
  it("does not register a background sync / periodic sync handler", () => {
    expect(SW_SOURCE).not.toContain('"sync"');
    expect(SW_SOURCE).not.toContain("'sync'");
    expect(SW_SOURCE).not.toContain("periodicsync");
    expect(SW_SOURCE).not.toContain("register");
  });

  it("does not cache navigation (HTML) responses — network-first with offline fallback only", () => {
    expect(SW_SOURCE).toContain('request.mode === "navigate"');
    // Isolate the navigation branch and assert it never calls cache.put
    // with the navigation request. The offline fallback uses cache.match,
    // not cache.put.
    const navStart = SW_SOURCE.indexOf('isNavigation(request)');
    const navEnd = SW_SOURCE.indexOf("// Allowlisted public static assets");
    const navBranch = SW_SOURCE.slice(navStart, navEnd);
    expect(navBranch).toContain("fetch(request)");
    expect(navBranch).toContain("cache.match(OFFLINE_URL");
    expect(navBranch).not.toContain("cache.put");
  });

  it("ignores non-GET requests (financial writes are never intercepted)", () => {
    expect(SW_SOURCE).toContain('request.method !== "GET"');
  });

  it("never caches /api/ responses", () => {
    expect(SW_SOURCE).toContain('url.pathname.startsWith("/api/")');
    // The api path branch only `return`s (does not cache).
    const apiBranch = SW_SOURCE.slice(
      SW_SOURCE.indexOf('url.pathname.startsWith("/api/")'),
      SW_SOURCE.indexOf('url.pathname.startsWith("/_next/data/")'),
    );
    expect(apiBranch).toContain("return;");
    expect(apiBranch).not.toContain("cache.put");
    expect(apiBranch).not.toContain("caches.open");
  });

  it("never caches RSC/flight (_next/data) responses", () => {
    const rscBranch = SW_SOURCE.slice(
      SW_SOURCE.indexOf('url.pathname.startsWith("/_next/data/")'),
    );
    expect(rscBranch).toContain("return;");
  });

  it("deletes only this app's obsolete caches (mysavings- prefix)", () => {
    expect(SW_SOURCE).toContain('key.startsWith("mysavings-")');
    expect(SW_SOURCE).toContain('key !== CACHE_NAME');
  });
});

describe("PWA constants", () => {
  it("sw path and scope are root-relative", () => {
    expect(PWA_SW_PATH).toBe("/sw.js");
    expect(PWA_SCOPE).toBe("/");
  });

  it("offline path is /offline", () => {
    expect(PWA_OFFLINE_PATH).toBe("/offline");
  });

  it("cache name is versioned", () => {
    expect(PWA_CACHE_NAME.startsWith("mysavings-v")).toBe(true);
  });
});