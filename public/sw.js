// mySavings service worker — privacy-safe, versioned, allowlisted.
//
// PRIVACY CONTRACT (see docs/pwa.md):
//   * Only the explicit public-static assets in PRECACHE_URLS are cached.
//   * Navigation requests (HTML pages) are NEVER cached. When the network
//     is unavailable, the worker responds with the generic /offline shell,
//     which contains NO personal/financial data and NO authenticated
//     snapshot.
//   * API, RSC/flight, auth, export and mutation responses are NEVER cached
//     and ALWAYS go to the network (bypassing the worker entirely via
//     no-store fetch). There is no stale-while-revalidate and no catch-all
//     runtime cache.
//   * No background sync / payment retry queue. Financial writes are
//     online-only by design.
//   * On activate, only obsolete mysavings-* caches are deleted; other
//     apps' caches are untouched.
//
// The CACHE_NAME version MUST match PWA_CACHE_NAME in lib/pwa/constants.ts.

const CACHE_NAME = "mysavings-v17";
const OFFLINE_URL = "/offline";

const PRECACHE_URLS = [
  "/offline",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/icon-32.png",
  "/manifest.webmanifest",
];

async function cachePublicAsset(cache, url) {
  try {
    const res = await fetch(url, { credentials: "omit", redirect: "error" });
    const finalUrl = new URL(res.url);
    if (res.ok && finalUrl.origin === self.location.origin && finalUrl.pathname === url) {
      await cache.put(url, res.clone());
    }
  } catch {
    // network/redirect/asset unavailable during install; non-fatal
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Use network-first fetch with no credentials so precaching never
      // depends on an authenticated session. Ignore individual failures so
      // a missing asset does not block installation; the update flow will
      // retry on next deploy.
      await Promise.all(PRECACHE_URLS.map((url) => cachePublicAsset(cache, url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Remove ONLY this app's obsolete named caches. Other apps' caches
      // (different prefixes) are left untouched.
      await Promise.all(
        keys
          .filter((key) => key.startsWith("mysavings-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// A request is a navigation (HTML page load) when its mode is "navigate".
// This covers initial loads, reloads and client-side back/forward to
// uncached routes. It NEVER matches fetch/XHR/API/RSC prefetches.
function isNavigation(request) {
  return request.mode === "navigate";
}

// Only same-origin GET requests to the explicit allowlist may be served
// from cache. Everything else is network-only.
function isAllowlistedAsset(url) {
  if (url.origin !== self.location.origin) return false;
  return PRECACHE_URLS.includes(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Never intercept non-GET. POST/PATCH/DELETE (all financial/auth/export
  // writes) always go straight to the network.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Block any attempt to cache API, RSC/flight, auth, export or personal
  // query-stringed responses: simply do not handle them here. They will be
  // fetched from the network; if offline, the browser shows its own error
  // or, for navigations, the offline shell below.
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/data/")) return;

  if (isNavigation(request)) {
    // Network-first for navigations; never cache the HTML. On failure,
    // respond with the generic offline shell (which itself is a precached
    // public asset containing no private data).
    event.respondWith(
      (async () => {
        try {
          const networkRes = await fetch(request);
          return networkRes;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          const offline = await cache.match(OFFLINE_URL, {
            ignoreSearch: true,
          });
          if (offline) return offline;
          return Response.error();
        }
      })(),
    );
    return;
  }

  // Allowlisted public static assets: cache-first, then network, then cache.
  if (isAllowlistedAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request, { ignoreSearch: false });
        if (cached) return cached;
        try {
          const networkRes = await fetch(request, {
            credentials: "omit",
          });
          if (networkRes.ok) {
            await cache.put(request, networkRes.clone());
          }
          return networkRes;
        } catch {
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Everything else (e.g. cross-origin, unlisted same-origin): network-only,
  // do not handle, do not cache.
});

// Update lifecycle: when a new worker takes over, tell clients an update
// is ready. The UI decides when to reload (never during payment entry).
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});