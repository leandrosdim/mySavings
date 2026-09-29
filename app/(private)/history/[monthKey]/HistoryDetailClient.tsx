"use client";

import Link from "next/link";
import type { ClosingSnapshot } from "@/lib/history/types";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { cardStyle, dividerStyle } from "@/components/ui/styles";
import { formatEurEl, formatDateTimeEl } from "@/lib/ui/format";
import { downloadCsv, downloadJson } from "@/lib/ui/history-api";

type HistoryDetailClientProps = {
  snapshot: ClosingSnapshot;
};

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
      <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{label}</span>
      <span
        style={{
          fontSize: "0.95rem",
          fontWeight: 700,
          color: accent ? "var(--accent)" : "var(--fg)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: "0.95rem",
        fontWeight: 700,
        margin: "0 0 0.4rem 0",
        color: "var(--fg)",
      }}
    >
      {children}
    </h2>
  );
}

export function HistoryDetailClient({ snapshot }: HistoryDetailClientProps) {
  const prov = snapshot.provenance;
  const projected = snapshot.projectedFreeToSpendCents;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        <Link
          href="/history"
          style={{
            fontSize: "0.85rem",
            color: "var(--accent)",
            textDecoration: "none",
            minHeight: "2.75rem",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          ← Ιστορικό
        </Link>
        <h1
          style={{
            fontSize: "1.4rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          {snapshot.monthKey}
        </h1>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
          Κλεισμένο {formatDateTimeEl(snapshot.closedAt)}
        </p>
      </div>

      <div style={cardStyle}>
        <Row label="Σύνολο υπολοίπων" value={formatEurEl(snapshot.balancesTotalCents)} />
        {snapshot.balancesAsOf ? (
          <Row
            label="Ενημερώθηκε"
            value={formatDateTimeEl(snapshot.balancesAsOf) ?? "—"}
          />
        ) : null}
        <hr style={dividerStyle} />
        <Row label="Εκκρεμές έσοδο" value={formatEurEl(snapshot.pendingIncomeRemainingCents)} />
        <Row label="Απλήρωτα έξοδα" value={formatEurEl(snapshot.ordinaryUnpaidCents)} />
        <Row label="Δεσμεύσεις" value={formatEurEl(snapshot.reservedOutstandingCents)} />
        <Row label="Στόχος αποταμίευσης" value={formatEurEl(snapshot.savingsTargetCents)} />
        <hr style={dividerStyle} />
        <Row label="Σύνολο πληρωμών" value={formatEurEl(snapshot.settlementTotalCents)} />
        {projected !== null ? (
          <Row
            label="Ελεύθερο προς δαπάνη"
            value={formatEurEl(projected)}
            accent={projected >= 0}
          />
        ) : null}
        {snapshot.cashBackedFreeToSpendCents !== null ? (
          <Row
            label="Ελεύθερο μετρητών"
            value={formatEurEl(snapshot.cashBackedFreeToSpendCents)}
          />
        ) : null}
      </div>

      {prov ? (
        <>
          {prov.accounts.length > 0 ? (
            <div style={cardStyle}>
              <SectionTitle>Λογαριασμοί ({prov.accounts.length})</SectionTitle>
              {prov.accounts.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    fontSize: "0.88rem",
                    padding: "0.2rem 0",
                  }}
                >
                  <span style={{ color: "var(--fg)", wordBreak: "break-word" }}>
                    {a.name}
                  </span>
                  <span style={{ fontWeight: 600, color: "var(--fg)", whiteSpace: "nowrap" }}>
                    {a.balanceCents === null ? "—" : formatEurEl(a.balanceCents)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {prov.ordinaryExpenses.length > 0 ? (
            <div style={cardStyle}>
              <SectionTitle>Έξοδα ({prov.ordinaryExpenses.length})</SectionTitle>
              {prov.ordinaryExpenses.map((o) => (
                <div
                  key={o.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.15rem",
                    padding: "0.3rem 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                    }}
                  >
                    <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--fg)", wordBreak: "break-word" }}>
                      {o.title}
                    </span>
                    <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--fg)", whiteSpace: "nowrap" }}>
                      {formatEurEl(o.plannedCents)}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--muted)", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span>Πληρωμένο: {formatEurEl(o.paidCents)}</span>
                    <span>· Υπόλοιπο: {formatEurEl(o.remainingCents)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {prov.reservedCommitments.length > 0 ? (
            <div style={cardStyle}>
              <SectionTitle>Δεσμεύσεις ({prov.reservedCommitments.length})</SectionTitle>
              {prov.reservedCommitments.map((o) => (
                <div
                  key={o.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    fontSize: "0.88rem",
                    padding: "0.2rem 0",
                  }}
                >
                  <span style={{ color: "var(--fg)", wordBreak: "break-word" }}>
                    {o.title}
                  </span>
                  <span style={{ fontWeight: 600, color: "var(--fg)", whiteSpace: "nowrap" }}>
                    {formatEurEl(o.remainingCents)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {prov.income.length > 0 ? (
            <div style={cardStyle}>
              <SectionTitle>Έσοδα ({prov.income.length})</SectionTitle>
              {prov.income.map((i) => (
                <div
                  key={i.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.15rem",
                    padding: "0.3rem 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                    }}
                  >
                    <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--fg)", wordBreak: "break-word" }}>
                      {i.sourceName}
                    </span>
                    <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--fg)", whiteSpace: "nowrap" }}>
                      {formatEurEl(i.expectedCents)}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--muted)", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span>Ελημμένο: {formatEurEl(i.receivedCents)}</span>
                    <span>· Εκκρεμές: {formatEurEl(i.pendingCents)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <Alert tone="info">Δεν αποθηκεύτηκε provenance για αυτό το στιγμιότυπο.</Alert>
      )}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => downloadCsv(snapshot.monthKey)}
          style={{ flex: 1, minWidth: "8rem" }}
        >
          CSV
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => downloadJson(snapshot.monthKey)}
          style={{ flex: 1, minWidth: "8rem" }}
        >
          JSON
        </Button>
      </div>

      <Alert tone="info">
        Το στιγμιότυπο είναι αμετάβλητο. Μεταγενέστερες αλλοιώσεις υπολοίπου,
        στόχου ή πληρωμών δεν το επηρεάζουν.
      </Alert>
    </>
  );
}