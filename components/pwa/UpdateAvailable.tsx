"use client";

// "Update available" notice. Tells the user a new version of the app is
// ready, and offers a reload. Reload is NEVER forced: financial forms set a
// global "editing" flag via setPwaUpdatingBlocked() so the reload button is
// disabled (and the controllerchange reload is suppressed) while a payment
// is being entered. The user can reload manually after finishing.

import { useState } from "react";
import { primaryButton, secondaryButton } from "@/components/ui/styles";

let updateBlocked = false;

export function setPwaUpdateBlocked(blocked: boolean): void {
  updateBlocked = blocked;
}

export function isPwaUpdateBlocked(): boolean {
  return updateBlocked;
}

export function UpdateAvailable({
  visible,
  onReload,
  onDismiss,
}: {
  visible: boolean;
  onReload: () => void;
  onDismiss: () => void;
}) {
  if (!visible) return null;
  const blocked = isPwaUpdateBlocked();
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        left: "max(0.75rem, env(safe-area-inset-left))",
        right: "max(0.75rem, env(safe-area-inset-right))",
        bottom: "calc(0.75rem + env(safe-area-inset-bottom))",
        zIndex: 60,
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "0.8rem",
        padding: "0.85rem 1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
        boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
      }}
    >
      <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.5, color: "var(--fg)" }}>
        {blocked
          ? "Διαθέσιμη νέα έκδοση. Ολοκλήρωσε την εγγραφή σου και πάτα «Ανανέωση»."
          : "Διαθέσιμη νέα έκδοση της εφαρμογής."}
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onReload}
          disabled={blocked}
          style={{
            ...primaryButton,
            flex: "1 1 auto",
            cursor: blocked ? "not-allowed" : "pointer",
            opacity: blocked ? 0.6 : 1,
          }}
        >
          Ανανέωση
        </button>
        <button
          type="button"
          onClick={onDismiss}
          style={{ ...secondaryButton, flex: "1 0 auto" }}
        >
          Αργότερα
        </button>
      </div>
    </div>
  );
}

// Hook wrapper for convenience used by PWAProvider.
export function useUpdateVisible() {
  const [visible, setVisible] = useState(false);
  return { visible, setVisible } as const;
}