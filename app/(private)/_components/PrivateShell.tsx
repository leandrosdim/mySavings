"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { pageMaxWidth } from "@/components/ui/styles";
import { Alert } from "@/components/ui/Alert";

type PrivateShellProps = {
  email: string;
  children: ReactNode;
};

export function PrivateShell({ email, children }: PrivateShellProps) {
  const router = useRouter();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "manual",
      });
      if (res.status === 303 || res.status === 0) {
        router.push("/login");
        router.refresh();
        return;
      }
      if (res.status === 503) {
        let msg =
          "Η αποσύνδεση απέτυχε μερικώς. Η τοπική συνεδρία καθαρίστηκε, αλλά ο διακομιστής δεν μπόρεσε να την ανακαλέσει. Δοκίμασε ξανά.";
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          // keep default
        }
        setLogoutError(msg);
        setLoggingOut(false);
        return;
      }
      // Unexpected status: still try to redirect to login
      router.push("/login");
      router.refresh();
    } catch {
      // fetch itself failed (network). Clear error and let user retry.
      setLogoutError(
        "Σφάλμα δικτύου κατά την αποσύνδεση. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.",
      );
      setLoggingOut(false);
    }
  }

  return (
    <div style={pageMaxWidth}>
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.6rem",
          paddingBottom: "0.5rem",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "1.1rem",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "var(--fg)",
            }}
          >
            mySavings
          </span>
          <nav
            aria-label="Κύρια πλοήγηση"
            style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}
          >
            <Link
              href="/dashboard"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: "2.75rem",
                padding: "0.4rem 0.8rem",
                borderRadius: "0.5rem",
                fontWeight: 600,
                fontSize: "0.9rem",
                color: "var(--accent)",
                textDecoration: "none",
                backgroundColor: "var(--accent-weak)",
              }}
            >
              Επισκόπηση
            </Link>
            <Link
              href="/accounts"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: "2.75rem",
                padding: "0.4rem 0.8rem",
                borderRadius: "0.5rem",
                fontWeight: 600,
                fontSize: "0.9rem",
                color: "var(--fg)",
                textDecoration: "none",
              }}
            >
              Λογαριασμοί
            </Link>
            <Link
              href="/plan"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: "2.75rem",
                padding: "0.4rem 0.8rem",
                borderRadius: "0.5rem",
                fontWeight: 600,
                fontSize: "0.9rem",
                color: "var(--fg)",
                textDecoration: "none",
              }}
            >
              Πλάνο
            </Link>
            <Link
              href="/months/new"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: "2.75rem",
                padding: "0.4rem 0.8rem",
                borderRadius: "0.5rem",
                fontWeight: 600,
                fontSize: "0.9rem",
                color: "var(--fg)",
                textDecoration: "none",
              }}
            >
              Επόμενος
            </Link>
            <Link
              href="/activity"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: "2.75rem",
                padding: "0.4rem 0.8rem",
                borderRadius: "0.5rem",
                fontWeight: 600,
                fontSize: "0.9rem",
                color: "var(--fg)",
                textDecoration: "none",
              }}
            >
              Δραστηριότητα
            </Link>
          </nav>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "0.82rem",
              color: "var(--muted)",
              wordBreak: "break-all",
            }}
            aria-label="Συνδεδεμένος χρήστης"
          >
            {email}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            style={{
              minHeight: "2.75rem",
              padding: "0.4rem 0.9rem",
              borderRadius: "0.5rem",
              fontWeight: 600,
              fontSize: "0.88rem",
              border: "1px solid var(--border)",
              backgroundColor: "var(--card)",
              color: "var(--fg)",
              cursor: loggingOut ? "not-allowed" : "pointer",
              opacity: loggingOut ? 0.6 : 1,
            }}
          >
            {loggingOut ? "Αποσύνδεση…" : "Αποσύνδεση"
            }
          </button>
        </div>
        {logoutError ? <Alert tone="warning">{logoutError}</Alert> : null}
      </header>
      <main style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
        {children}
      </main>
    </div>
  );
}