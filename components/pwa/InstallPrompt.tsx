"use client";

// Install guidance for Android Chrome and iOS Safari "Add to Home Screen".
//
// Privacy/access contract:
//   * Uses the beforeinstallprompt event (Android Chrome, Edge). The prompt
//     is NOT shown automatically; the user must click a button.
//   * Dismissal is remembered in sessionStorage (not localStorage) so it does
//     not persist across sessions and never stores personal data.
//   * iOS does not fire beforeinstallprompt; it shows manual instructions
//     only when the app is not already standalone.
//   * No interruptive repeated prompts. If the user dismisses, the banner
//     stays hidden for the session.
//   * All touch targets >= 2.75rem (44px).

import { useEffect, useState } from "react";
import { secondaryButton } from "@/components/ui/styles";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "mysavings.install.dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac, so also check touch + Mac
  const isIPad =
    /Macintosh/.test(ua) && "ontouchend" in document;
  return /iPhone|iPad|iPod/.test(ua) || isIPad;
}

function initialIos(): boolean {
  if (typeof window === "undefined") return false;
  if (isStandalone()) return false;
  return isIOS();
}

function initialVisible(): boolean {
  if (typeof window === "undefined") return false;
  if (isStandalone()) return false;
  let dismissed = false;
  try {
    dismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // sessionStorage may be unavailable (private mode); treat as not
    // dismissed so the user can still install.
  }
  if (dismissed) return false;
  // On iOS there is no beforeinstallprompt; show manual instructions once.
  return isIOS();
}

export function InstallPrompt() {
  const [deferred, setDeferred] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(initialVisible);
  const [ios] = useState(initialIos);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
      try {
        sessionStorage.setItem(DISMISS_KEY, "1");
      } catch {
        // ignore
      }
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "dismissed") {
        try {
          sessionStorage.setItem(DISMISS_KEY, "1");
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore prompt errors
    } finally {
      setDeferred(null);
      setVisible(false);
    }
  }

  function handleDismiss() {
    setVisible(false);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Εγκατάσταση εφαρμογής"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "0.8rem",
        padding: "0.85rem 1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "0.9rem",
          lineHeight: 1.5,
          color: "var(--fg)",
        }}
      >
        {ios
          ? "Πρόσθεσε το mySavings στην αρχική οθόνη: πάτα Μοίρασμα (Share) και μετά «Στην αρχική οθόνη»."
          : "Εγκατάστησε το mySavings για γρήγορη πρόσβαση από την αρχική οθόνη."}
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {!ios && (
          <button
            type="button"
            onClick={handleInstall}
            style={{ ...secondaryButton, flex: "1 1 auto" }}
          >
            Εγκατάσταση
          </button>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          style={{ ...secondaryButton, flex: "1 0 auto" }}
        >
          Όχι τώρα
        </button>
      </div>
    </div>
  );
}