# PWA — mySavings installable, privacy-safe

Step16 deliverable. This documents the manifest, service worker, install
guidance, offline behavior and update/logout lifecycle.

## Files

- `app/manifest.ts` — Web App Manifest served at `/manifest.webmanifest`
  (Next.js MetadataRoute.Manifest). Stable id, standalone display, Greek
  `lang`, theme `#059669`, real PNG icons (192/512/maskable).
- `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
  `apple-touch-icon.png`, `icon-32.png` — real PNG assets generated with
  PIL; dimensions validated by `file` and tests.
- `public/sw.js` — versioned service worker (`mysavings-v16`).
- `app/offline/page.tsx` + `offline-retry-button.tsx` — generic offline
  shell with NO personal/financial data.
- `lib/pwa/constants.ts` — shared cache name, SW path, scope, precache
  allowlist.
- `components/pwa/PWAProvider.tsx` — root provider bundling SW
  registration, install prompt, offline banner and update toast.
- `components/pwa/ServiceWorkerRegister.tsx` — registers `/sw.js`
  (production + localhost only), exposes update-ready callback.
- `components/pwa/InstallPrompt.tsx` — Android `beforeinstallprompt` and
  iOS manual instructions; dismissal remembered in `sessionStorage`.
- `components/pwa/OfflineNotice.tsx` — `OnlineProvider` context +
  `useOnline()` hook + `OfflineBanner`.
- `components/pwa/UpdateAvailable.tsx` — update toast; reload is
  user-initiated and disabled while a financial submission is pending
  (`setPwaUpdateBlocked` mirrored from `Button`'s `pending` prop).
- `lib/ui/form-helpers.ts` — `offlineSubmitGuard()` blocks financial
  submissions when `navigator.onLine` is false; no retry queue.
- `next.config.ts` — `Cache-Control: no-cache` for `/sw.js` and
  `/manifest.webmanifest`, `Service-Worker-Allowed: /`.
- `tests/pwa/sw-privacy.test.ts`, `offline-guard.test.ts`,
  `manifest.test.ts` — offline unit tests for the privacy invariants.

## Privacy contract

1. The service worker caches ONLY the explicit allowlist in
   `PWA_PRECACHE_URLS` (the offline shell and icon/manifest assets).
2. Navigation requests (HTML pages) are NEVER cached. When the network is
   unavailable, the worker responds with the generic `/offline` shell,
   which contains no personal/financial data and no authenticated
   snapshot.
3. `/api/*`, `/_next/data/*` (RSC/flight), auth, export and mutation
   responses are never intercepted or cached. Non-GET requests (all
   financial writes) bypass the worker entirely.
4. No background sync, no periodic sync, no payment retry queue. Financial
   writes are online-only by design.
5. No session tokens, balances, or form drafts are stored in caches or
   `localStorage` for offline use. Install dismissal uses
   `sessionStorage` only.
6. On activate, only obsolete `mysavings-*` caches are deleted; other
   apps' caches are untouched.

## Update lifecycle

- `ServiceWorkerRegister` detects a waiting worker and calls
  `onUpdateReady`, which shows `UpdateAvailable`.
- Reload is never forced. The reload button is disabled while any
  financial form is pending (`Button` mirrors `pending` into
  `setPwaUpdateBlocked`).
- The user clicks "Ανανέωση" → the waiting worker is told
  `SKIP_WAITING` and the page reloads.

## Logout / same-device A/B

- `clearPwaPrivateState()` is called from `PrivateShell.handleLogout`
  after the server session is revoked. It triggers waiting-worker
  activation and clears in-memory client state.
- Authenticated back navigation and same-device A/B user switching cannot
  display prior user data because authenticated HTML/RSC/API responses
  are never cached by the service worker in the first place.
- Public static assets (icons, offline shell) may remain cached; they are
  not personal.

## Offline UI behavior

- `OfflineBanner` shows a non-intrusive warning when `navigator.onLine`
  is false.
- Financial forms call `offlineSubmitGuard()` at the start of each
  `handleSubmit`; when offline, the submission is blocked with a Greek
  message and no request is fired. The server remains the source of
  truth and validates everything regardless.

## Install guidance

- Android Chrome / Edge: `beforeinstallprompt` is captured and the prompt
  is shown only when the user clicks "Εγκατάσταση".
- iOS Safari: manual "Share → Add to Home Screen" instructions are shown
  when the app is not already standalone.
- Dismissal is remembered for the session (`sessionStorage`); no
  interruptive repeated prompts.

## Physical-device install

Real physical-device install evidence is explicitly pending and is not
claimed from desktop emulation. Desktop browser QA (emulated widths) is
labeled separately in `docs/reviews/Step16-opencode.md`.