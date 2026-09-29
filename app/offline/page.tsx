// Generic offline shell. This page contains NO personal/financial data and
// NO authenticated snapshot. It is the only non-asset the service worker
// precaches and serves when a navigation fails due to no network.
//
// It must render statically (no server session, no DB) so it works with
// `credentials: "omit"` precaching and never depends on an authenticated
// session. robots/noindex is applied via metadata to keep it out of search.

import type { Metadata } from "next";
import { OfflineRetryButton } from "./offline-retry-button";

export const metadata: Metadata = {
  title: "Χωρίς σύνδεση",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main
      style={{
        maxWidth: "30rem",
        margin: "0 auto",
        padding:
          "calc(1.5rem + env(safe-area-inset-top)) 1rem calc(2rem + env(safe-area-inset-bottom))",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        minHeight: "100dvh",
        justifyContent: "center",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        <h1
          style={{
            fontSize: "1.3rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Χωρίς σύνδεση
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "0.95rem",
            color: "var(--muted)",
            lineHeight: 1.55,
          }}
        >
          Το mySavings χρειάζεται σύνδεση στο διαδίκτυο για να διαβάσει ή να
          αλλάξει τα οικονομικά σου. Δεν αποθηκεύει ιδιωτικά δεδομένα στην
          συσκευή σου για χρήση εκτός σύνδεσης.
        </p>
      </header>
      <p
        style={{
          margin: 0,
          fontSize: "0.9rem",
          color: "var(--muted)",
          lineHeight: 1.55,
        }}
      >
        Οι οικονομικές εγγραφές απαιτούν σύνδεση στον διακομιστή· δεν υπάρχουν
        εκκρεμείς πληρωμές που να εκτελούνται αυτόματα όταν επανασυνδεθείς.
      </p>
      <OfflineRetryButton />
    </main>
  );
}