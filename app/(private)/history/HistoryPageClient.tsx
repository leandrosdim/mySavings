"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { HistorySummary } from "@/lib/history/types";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Sheet } from "@/components/ui/Sheet";
import { cardStyle, dividerStyle, stickyControls } from "@/components/ui/styles";
import { formatEurEl } from "@/lib/ui/format";
import { closeMonthApi, downloadCsv, downloadJson } from "@/lib/ui/history-api";

type HistoryPageClientProps = {
  currentMonth: string;
  summaries: HistorySummary[];
};

export function HistoryPageClient({
  currentMonth,
  summaries,
}: HistoryPageClientProps) {
  const router = useRouter();
  const [closing, setClosing] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [confirmMonth, setConfirmMonth] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...summaries].sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
    [summaries],
  );

  function refresh() {
    router.refresh();
  }

  async function handleClose(monthKey: string) {
    setConfirmMonth(null);
    setClosing(monthKey);
    setCloseError(null);
    const result = await closeMonthApi(monthKey);
    setClosing(null);
    if (result.ok) {
      refresh();
    } else {
      setCloseError(result.error);
    }
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        <h1
          style={{
            fontSize: "1.4rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Ιστορικό
        </h1>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
          Κλειστά μηνιαία στιγμιότυπα και εξαγωγές.
        </p>
      </div>

      {closeError ? <Alert>{closeError}</Alert> : null}

      {sorted.length === 0 ? (
        <div style={cardStyle}>
          <p
            style={{
              margin: 0,
              fontSize: "0.9rem",
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            Δεν υπάρχουν μηνιαία πλάνα ακόμη. Δημιούργησε ένα πλάνο από την
            σελίδα «Πλάνο» για να ξεκινήσεις.
          </p>
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {sorted.map((s) => {
            const isCurrent = s.monthKey === currentMonth;
            const canClose = s.status === "open" && !isCurrent;
            return (
              <li key={s.id}>
                <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "1.05rem",
                        fontWeight: 700,
                        color: "var(--fg)",
                      }}
                    >
                      {s.monthKey}
                      {isCurrent ? " (τρέχων)" : ""}
                    </span>
                    <span
                      style={{
                        fontSize: "0.82rem",
                        fontWeight: 600,
                        color:
                          s.status === "closed"
                            ? "var(--accent)"
                            : "var(--muted)",
                      }}
                    >
                      {s.status === "closed" ? "Κλειστό" : "Ανοιχτό"}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.25rem",
                      fontSize: "0.85rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                      <span style={{ color: "var(--muted)" }}>Στόχος αποταμίευσης</span>
                      <span style={{ color: "var(--fg)", fontWeight: 600 }}>
                        {formatEurEl(s.savingsTargetCents)}
                      </span>
                    </div>
                    {s.balancesTotalCents !== null ? (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                        <span style={{ color: "var(--muted)" }}>Σύνολο υπολοίπων</span>
                        <span style={{ color: "var(--fg)", fontWeight: 600 }}>
                          {formatEurEl(s.balancesTotalCents)}
                        </span>
                      </div>
                    ) : null}
                    {s.projectedFreeToSpendCents !== null ? (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                        <span style={{ color: "var(--muted)" }}>Ελεύθερο προς δαπάνη</span>
                        <span
                          style={{
                            color:
                              s.projectedFreeToSpendCents < 0
                                ? "#b91c1c"
                                : "var(--accent)",
                            fontWeight: 700,
                          }}
                        >
                          {formatEurEl(s.projectedFreeToSpendCents)}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <hr style={dividerStyle} />

                  <div
                    style={{
                      display: "flex",
                      gap: "0.4rem",
                      flexWrap: "wrap",
                    }}
                  >
                    {s.status === "closed" ? (
                      <Link
                        href={`/history/${s.monthKey}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          minHeight: "2.75rem",
                          padding: "0.4rem 0.8rem",
                          borderRadius: "0.5rem",
                          fontWeight: 600,
                          fontSize: "0.88rem",
                          color: "var(--accent)",
                          textDecoration: "none",
                          border: "1px solid var(--accent)",
                        }}
                      >
                        Λεπτομέρειες
                      </Link>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => downloadCsv(s.monthKey)}
                      style={{ flex: 1, minWidth: "7rem" }}
                    >
                      CSV
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => downloadJson(s.monthKey)}
                      style={{ flex: 1, minWidth: "7rem" }}
                    >
                      JSON
                    </Button>
                    {canClose ? (
                      <Button
                        type="button"
                        variant="danger"
                        pending={closing === s.monthKey}
                        onClick={() => {
                          setCloseError(null);
                          setConfirmMonth(s.monthKey);
                        }}
                        style={{ flex: 1, minWidth: "7rem" }}
                      >
                        {closing === s.monthKey ? "Κλείσιμο…" : "Κλείσιμο"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div style={stickyControls}>
        <Alert tone="info">
          Το κλείσιμο μήνα αποθηκεύει ένα αμετάβλητο στιγμιότυπο. Μεταγενέστερες
          αλλοιώσεις υπολοίπου/στόχου δεν το επηρεάζουν. v1 δεν ανοίγει ξανά
          κλειστούς μήνες.
        </Alert>
      </div>

      {confirmMonth ? (
        <Sheet
          open={true}
          title={`Κλείσιμο ${confirmMonth}`}
          onClose={() => setConfirmMonth(null)}
          footer={
            <>
              <Button
                type="button"
                variant="danger"
                pending={closing === confirmMonth}
                onClick={() => handleClose(confirmMonth)}
                style={{ width: "100%" }}
              >
                {closing === confirmMonth ? "Κλείσιμο…" : "Ναι, κλείσιμο"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmMonth(null)}
                style={{ width: "100%" }}
              >
                Άκυρο
              </Button>
            </>
          }
        >
          <Alert tone="warning">
            Το κλείσιμο του {confirmMonth} αποθηκεύει τα τρέχοντα υπόλοιπα,
            πρόσθεση, δεσμεύσεις και σύνολο πληρωμών ως αμετάβλητο
            στιγμιότυπο. Δεν μπορεί να ανακληθεί στην v1.
          </Alert>
        </Sheet>
      ) : null}
    </>
  );
}