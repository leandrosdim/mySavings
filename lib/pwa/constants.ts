// Shared PWA constants. Imported by the service-worker registration client
// and by tests. The service worker file (public/sw.js) embeds the same
// CACHE_NAME version string; keep them in sync via the test in
// tests/pwa/sw-version.test.ts.

export const PWA_CACHE_NAME = "mysavings-v17";
export const PWA_SW_PATH = "/sw.js";
export const PWA_OFFLINE_PATH = "/offline";
export const PWA_SCOPE = "/";

// Explicit public-static asset allowlist. The service worker ONLY precaches
// these. No authenticated HTML, RSC/flight, API, export, auth or mutation
// responses are ever cached. Keep in sync with public/sw.js PRECACHE_URLS.
export const PWA_PRECACHE_URLS: readonly string[] = [
  "/offline",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/icon-32.png",
  "/manifest.webmanifest",
] as const;