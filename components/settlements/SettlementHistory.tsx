"use client";

import type {
  SettlementHistoryEntry,
  ReceiptHistoryEntry,
} from "@/lib/settlements/types";
import { cardStyle, dividerStyle } from "@/components/ui/styles";
import { formatEurEl } from "@/lib/ui/format";
import { formatDateTimeEl } from "@/lib/ui/format";
import { Button } from "@/components/ui/Button";

type HistoryEntry = SettlementHistoryEntry | ReceiptHistoryEntry;

type SettlementHistoryProps = {
  history: HistoryEntry[];
  isIncome: boolean;
  onReverse: (entry: HistoryEntry) => void;
};

const modeLabel = (mode: string): string =>
  mode === "UPDATE_ACCOUNT" ? "Ενημέρωση λογαριασμού" : "Ήδη αντανακλασμένο";

export function SettlementHistory({
  history,
  isIncome,
  onReverse,
}: SettlementHistoryProps) {
  if (history.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
        {isIncome
          ? "Δεν υπάρχουν εισπράξεις ακόμη."
          : "Δεν υπάρχουν πληρωμές ακόμη."}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {history.map((entry) => {
        const reversed = entry.reversed;
        return (
          <div
            key={entry.id}
            style={{
              ...cardStyle,
              padding: "0.7rem 0.8rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
              fontSize: "0.85rem",
              opacity: reversed ? 0.65 : 1,
              border: reversed
                ? "1px solid var(--border)"
                : "1px solid var(--border)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.5rem",
                alignItems: "baseline",
              }}
            >
              <span style={{ fontWeight: 700, color: "var(--fg)" }}>
                {isIncome ? "Είσπραξη" : "Πληρωμή"} {formatEurEl(entry.amountCents)}
              </span>
              {reversed ? (
                <span
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    color: "#b91c1c",
                  }}
                >
                  Αναιρέθηκε
                </span>
              ) : null}
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                flexWrap: "wrap",
                color: "var(--muted)",
                fontSize: "0.8rem",
              }}
            >
              <span>{entry.businessDate}</span>
              <span>· {modeLabel(entry.mode)}</span>
              <span>· {formatDateTimeEl(entry.recordedAt)}</span>
            </div>
            {entry.reversal ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.15rem",
                  fontSize: "0.8rem",
                  color: "var(--muted)",
                }}
              >
                <hr style={dividerStyle} />
                <span>
                  Αναιρέθηκε: {entry.reversal.businessDate ?? "—"}
                </span>
                <span>{formatDateTimeEl(entry.reversal.recordedAt)}</span>
                {entry.reversal.reason ? (
                  <span>Αιτιολογία: {entry.reversal.reason}</span>
                ) : null}
              </div>
            ) : null}
            {!reversed ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => onReverse(entry)}
                style={{ width: "100%", marginTop: "0.25rem" }}
              >
                {isIncome ? "Αναιρεση είσπραξης" : "Αναιρεση πληρωμής"}
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}