"use client";

// Online/offline awareness. Shows a non-intrusive banner when the device is
// known to be offline. Financial forms read `useOnline()` to disable
// submission while offline — but the server remains the source of truth and
// validates everything regardless.
//
// Privacy contract: no personal data is stored. We only track the boolean
// online state in React memory; nothing is persisted to localStorage or
// caches. There is NO payment retry queue: a blocked submission simply does
// not fire, and the user must retry manually when back online.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type OnlineContextValue = {
  online: boolean;
};

const OnlineContext = createContext<OnlineContextValue>({ online: true });

export function useOnline(): boolean {
  const ctx = useContext(OnlineContext);
  return ctx.online;
}

export function OnlineProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const value = useMemo<OnlineContextValue>(() => ({ online }), [online]);
  return <OnlineContext.Provider value={value}>{children}</OnlineContext.Provider>;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        backgroundColor: "#fffbeb",
        color: "var(--warning)",
        border: "1px solid #fde68a",
        borderRadius: "0.6rem",
        padding: "0.6rem 0.75rem",
        fontSize: "0.85rem",
        lineHeight: 1.5,
      }}
    >
      Χωρίς σύνδεση. Οι οικονομικές εγγραφές είναι απενεργοποιημένες· ξαναδοκίμασε
      όταν επανασυνδεθείς.
    </div>
  );
}