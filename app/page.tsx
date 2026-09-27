import type { ReactNode } from "react";
import { getOptionalSession } from "@/lib/auth/dal";
import { redirect } from "next/navigation";

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

export default async function HomePage() {
  const session = await getOptionalSession();
  if (session) {
    redirect("/accounts");
  }

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

        <Pill>Ιδιωτικός χώρος · Συνδέσου για να ξεκινήσεις</Pill>
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
          Θα καταγράφεις κάθε πληρωμή ξεχωριστά, χωρίς να χάνεται το αρχικό
          ποσό του εξόδου. Θα βλέπεις τι πλήρωσες και πόσο απομένει.
        </Feature>
        <Feature title="Ιδιωτικός χώρος χρήστη">
          Κάθε χρήστης θα έχει τον δικό του ιδιωτικό χώρο, χωρίς κοινές
          οθόνες ή πρόσβαση στα οικονομικά άλλου χρήστη.
        </Feature>
      </div>

      <a
        href="/login"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "2.75rem",
          padding: "0.6rem 1.1rem",
          borderRadius: "0.6rem",
          backgroundColor: "var(--accent)",
          color: "white",
          fontWeight: 600,
          fontSize: "0.95rem",
          textDecoration: "none",
        }}
      >
        Σύνδεση
      </a>
    </main>
  );
}