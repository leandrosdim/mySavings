"use client";

// Registers the versioned service worker (/sw.js) on the client and exposes
// the update lifecycle via a callback. The worker itself is privacy-safe and
// allowlisted (see public/sw.js).
//
// Behavior:
//   * Registers only in production builds and only in secure contexts
//     (https or localhost). In dev the worker is intentionally NOT registered
//     to avoid caching static assets that change on every HMR.
//   * Detects a waiting worker on registration and on controllerchange, and
//     invokes onUpdateReady(). The UI decides when to reload (never during
//     payment entry).
//   * Never throws into the React tree: all worker APIs are try/caught.

import { useEffect } from "react";
import { PWA_SW_PATH, PWA_SCOPE } from "@/lib/pwa/constants";

export type ServiceWorkerRegisterProps = {
  onUpdateReady?: () => void;
};

export function ServiceWorkerRegister({
  onUpdateReady,
}: ServiceWorkerRegisterProps) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Only register in production or on localhost (secure context). In dev,
    // the Next dev server changes assets on HMR and caching them breaks the
    // loop.
    const isDev = process.env.NODE_ENV !== "production";
    const isLocalhost =
      location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (isDev && !isLocalhost) return;

    let cancelled = false;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register(PWA_SW_PATH, {
          scope: PWA_SCOPE,
          updateViaCache: "none",
        });

        // A new worker is waiting to activate.
        const notify = () => {
          if (reg.waiting) {
            onUpdateReady?.();
          }
        };
        notify();
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && reg.waiting) {
              onUpdateReady?.();
            }
          });
        });

        // Also catch controller changes from skipWaiting().
        const onControllerChange = () => {
          if (navigator.serviceWorker.controller) {
            onUpdateReady?.();
          }
        };
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          onControllerChange,
        );

        return () => {
          navigator.serviceWorker.removeEventListener(
            "controllerchange",
            onControllerChange,
          );
        };
      } catch {
        // Registration failure is non-fatal: the app still works online.
      }
    };

    const promise = register();
    return () => {
      cancelled = true;
      void promise.then((cleanup) => {
        if (!cancelled) cleanup?.();
      });
    };
  }, [onUpdateReady]);

  return null;
}