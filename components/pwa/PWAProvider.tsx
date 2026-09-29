"use client";

// PWA root provider: bundles service-worker registration, install guidance,
// offline awareness and the versioned-update notice. Mount once in the root
// layout.
//
// Logout cache cleanup: call clearPwaPrivateState() from the logout flow. It
// removes ONLY this app's in-memory/client state and asks the waiting worker
// to activate the new version. It does NOT wipe public static assets (they
// can remain cached and are not personal). Authenticated back-navigation and
// same-device A/B user switching must not display prior user data because
// the app never caches authenticated HTML/RSC/API responses in the first
// place; clearing in-memory React state plus the server session is enough.

import { useCallback, useState, type ReactNode } from "react";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";
import { InstallPrompt } from "./InstallPrompt";
import { OfflineBanner, OnlineProvider } from "./OfflineNotice";
import { UpdateAvailable } from "./UpdateAvailable";

export function PWAProvider({ children }: { children: ReactNode }) {
  const [updateVisible, setUpdateVisible] = useState(false);

  const handleUpdateReady = useCallback(() => {
    setUpdateVisible(true);
  }, []);

  const handleReload = useCallback(() => {
    // Ask the waiting worker to activate, then reload.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          const waiting = reg?.waiting;
          if (waiting) {
            waiting.postMessage("SKIP_WAITING");
          }
        })
        .catch(() => {
          // ignore
        })
        .finally(() => {
          location.reload();
        });
    } else {
      location.reload();
    }
  }, []);

  return (
    <OnlineProvider>
      <ServiceWorkerRegister onUpdateReady={handleUpdateReady} />
      {children}
      <OfflineBanner />
      <InstallPrompt />
      <UpdateAvailable
        visible={updateVisible}
        onReload={handleReload}
        onDismiss={() => setUpdateVisible(false)}
      />
    </OnlineProvider>
  );
}

// Called from the logout flow after the server session is revoked. Clears
// in-memory client state only; public static caches remain.
export async function clearPwaPrivateState(): Promise<void> {
  if (typeof window === "undefined") return;
  // Trigger update activation if a new worker is waiting, so the next sign-in
  // starts from the latest version. Errors are non-fatal.
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.waiting) {
        reg.waiting.postMessage("SKIP_WAITING");
      }
    }
  } catch {
    // ignore
  }
}