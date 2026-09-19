import type { ReactNode } from "react";

type PillProps = {
  children: ReactNode;
};

function Pill({ children }: PillProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.3rem 0.7rem",
        borderRadius: "9999px",
        backgroundColor: "var(--accent-weak)",
        color: "#065f46",
        fontSize: "0.78rem",
        fontWeight: 600,
        lineHeight: 1.2,
        letterSpacing: "0.01em",
        border: "1px solid #a7f3d0",
      }}
    >
      <span
        aria-hidden
        style={{
          width: "0.45rem",
          height: "0.45rem",
          borderRadius: "9999px",
          backgroundColor: "var(--accent)",
        }}
      />
      {children}
    </span>
  );
}

type FeatureProps = {
  title: string;
  children: ReactNode;
};

function Feature({ title, children }: FeatureProps) {
  return (
    <section
      style={{
        borderTop: "1px solid var(--border)",
        paddingTop: "1.1rem",
      }}
    >
      <h2
        style={{
          fontSize: "1.02rem",
          fontWeight: 700,
          margin: "0 0 0.4rem",
          color: "var(--fg)",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          margin: 0,
          fontSize: "0.95rem",
          lineHeight: 1.55,
          color: "var(--muted)",
        }}
      >
        {children}
      </p>
    </section>
  );
}

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: "30rem",
        margin: "0 auto",
        padding: "1.25rem 1rem 3rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.4rem",
      }}
    >
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.8rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.65rem",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "2.4rem",
              height: "2.4rem",
              borderRadius: "0.7rem",
              backgroundColor: "var(--accent)",
              flexShrink: 0,
            }}
          >
            <svg
              width="1.5rem"
              height="1.5rem"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M5 12.5l4 4L19 7"
                stroke="white"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <h1
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                letterSpacing: "-0.02em",
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              mySavings
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "0.82rem",
                color: "var(--muted)",
              }}
            >
              Προστασία αποταμιεύσεων πρώτα
            </p>
          </div>
        </div>

        <Pill>Υπό θεμελίωση · Δεν έχει ρυθμιστεί</Pill>
      </header>

      <p
        style={{
          fontSize: "1.06rem",
          lineHeight: 1.6,
          margin: 0,
          color: "var(--fg)",
        }}
      >
        Το mySavings αντικαθιστά το μηνιαίο Excel με ένα κινητό-πρώτο εργαλείο
        σχεδιασμένο γύρω από έναν στόχο: να διατηρεί τις αποταμιεύσεις σου
        προστατευμένες κάθε μήνα, πριν από κάθε άλλη απόφαση.
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1.1rem",
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "0.9rem",
          padding: "1.15rem 1.1rem",
        }}
      >
        <Feature title="Στόχος αποταμιεύσεων">
          Το προστατευμένο ποσό είναι ο πυρήνας: το ανέπαφο σύνολο που θέλεις να
          έχεις στο τέλος του μήνα, όχι μια απλή κατάθεση.
        </Feature>
        <Feature title="Μερικές πληρωμές">
          Καταγράφονται τμηματικές πληρωμές εξόδων με διατήρηση του planned
          ποσού και σαφή υπόλοιπο έως τον πλήρη συμψηφισμό.
        </Feature>
        <Feature title="Ιδιωτικός χώρος χρήστη">
          Κάθε χρήστης έχει εντελώς ξεχωριστά οικονομικά. Δεν υπάρχουν κοινές
          οθόνες ή πρόσβαση μεταξύ χρήστες — (προσεχώς).
        </Feature>
      </div>

      <div
        role="note"
        style={{
          fontSize: "0.84rem",
          lineHeight: 1.5,
          color: "var(--warning)",
          backgroundColor: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: "0.7rem",
          padding: "0.75rem 0.85rem",
        }}
      >
        Αυτό είναι το στάδιο θεμελίωσης. Η σύνδεση, η βάση δεδομένων και οι
        πραγματικές λειτουργίες δεν έχουν ρυθμιστεί ακόμη. Δεν εμφανίζονται
        υποθετικά υπόλοιπα ή έλεγχοι πληρωμών.
      </div>
    </main>
  );
}