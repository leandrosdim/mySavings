"use client";

import { useState, useId } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Alert } from "@/components/ui/Alert";
import { cardStyle } from "@/components/ui/styles";
import { formatEurEl } from "@/lib/ui/format";
import { todayAthensDate, newIdempotencyKey } from "@/lib/ui/form-helpers";
import {
  reverseSettlementApi,
  reverseReceiptApi,
} from "@/lib/ui/settlements-api";
import type {
  SettlementHistoryEntry,
  ReceiptHistoryEntry,
} from "@/lib/settlements/types";

type ReversalKind = "settlement" | "receipt";

type BaseReversalSheetProps = {
  open: boolean;
  onClose: () => void;
  onReversed: () => void;
};

type SettlementReversalSheetProps = BaseReversalSheetProps & {
  kind: "settlement";
  entry: SettlementHistoryEntry;
  obligationTitle: string;
};

type ReceiptReversalSheetProps = BaseReversalSheetProps & {
  kind: "receipt";
  entry: ReceiptHistoryEntry;
  incomeSourceName: string;
};

type ReversalSheetProps = SettlementReversalSheetProps | ReceiptReversalSheetProps;

const selectStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "2.75rem",
  padding: "0.55rem 0.7rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--border)",
  fontSize: "1rem",
  backgroundColor: "var(--card)",
  color: "var(--fg)",
};

export function ReversalSheet(props: ReversalSheetProps) {
  const { open, onClose, onReversed, kind, entry } = props;
  const entityLabel = kind === "settlement" ? "πληρωμής" : "είσπραξης";
  const parentLabel = kind === "settlement" ? props.obligationTitle : props.incomeSourceName;

  const [businessDate, setBusinessDate] = useState<string>(todayAthensDate());
  const [reason, setReason] = useState<string>("");
  const [adjustChoice, setAdjustChoice] = useState<"yes" | "no" | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [needsRefreshDecision, setNeedsRefreshDecision] = useState(false);
  const dateId = useId();
  const reasonId = useId();
  const adjustId = useId();

  function reset() {
    setBusinessDate(todayAthensDate());
    setReason("");
    setAdjustChoice("");
    setError(null);
    setNeedsRefreshDecision(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (entry.reversed) {
      setError("Αυτή η εγγραφή έχει ήδη αναιρεθεί.");
      return;
    }

    let adjustBalanceAfterRefresh: boolean | undefined;
    if (needsRefreshDecision) {
      if (adjustChoice === "") {
        setError("Επίλεξε αν το υπόλοιπο του λογαριασμού θα προσαρμοστεί.");
        return;
      }
      adjustBalanceAfterRefresh = adjustChoice === "yes";
    }

    setPending(true);
    const result =
      kind === "settlement"
        ? await reverseSettlementApi({
            settlementId: entry.id,
            businessDate,
            idempotencyKey: newIdempotencyKey("reverse-settlement"),
            reason: reason.trim() || undefined,
            adjustBalanceAfterRefresh,
          })
        : await reverseReceiptApi({
            receiptId: entry.id,
            businessDate,
            idempotencyKey: newIdempotencyKey("reverse-receipt"),
            reason: reason.trim() || undefined,
            adjustBalanceAfterRefresh,
          });
    setPending(false);

    if (result.ok) {
      onReversed();
      reset();
    } else if (result.requiresRefreshReconciliation) {
      setNeedsRefreshDecision(true);
      setError(null);
    } else {
      setError(result.error);
    }
  }

  const modeLabel =
    entry.mode === "UPDATE_ACCOUNT"
      ? "Ενημέρωση λογαριασμού"
      : "Ήδη αντανακλασμένο";

  return (
    <Sheet
      open={open}
      title={`Αναιρεση ${entityLabel}`}
      onClose={handleClose}
      footer={
        <>
          <Button
            type="submit"
            form="reversal-form"
            variant="danger"
            pending={pending}
            style={{ width: "100%" }}
          >
            {pending ? "Αναιρεση…" : `Ναι, αναιρεση ${entityLabel}`}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            style={{ width: "100%" }}
          >
            Άκυρο
          </Button>
        </>
      }
    >
      <form
        id="reversal-form"
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
      >
        <Alert tone="warning">
          Η αναίρεση δημιουργεί compensating εγγραφή και <strong>δεν</strong>
          διαγράφει το ιστορικό. Η αρχική εγγραφή παραμένει ορατή με σύνδεσμο
          αναίρεσης.
        </Alert>

        <div
          style={{
            ...cardStyle,
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            fontSize: "0.88rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ color: "var(--muted)" }}>{parentLabel}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ color: "var(--muted)" }}>Ποσό</span>
            <span style={{ fontWeight: 700 }}>{formatEurEl(entry.amountCents)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ color: "var(--muted)" }}>Ημερομηνία</span>
            <span style={{ fontWeight: 600 }}>{entry.businessDate}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ color: "var(--muted)" }}>Τύπος</span>
            <span style={{ fontWeight: 600 }}>{modeLabel}</span>
          </div>
        </div>

        <Field
          label="Ημερομηνία αναίρεσης"
          htmlFor={dateId}
          hint="Μορφή YYYY-MM-DD (π.χ. 2026-03-15)."
        >
          <Input
            id={dateId}
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            inputMode="numeric"
            placeholder="π.χ. 2026-03-15"
            autoComplete="off"
            required
            invalid={!!error}
            autoFocus
          />
        </Field>

        <Field
          label="Αιτιολογία (προαιρετικό)"
          htmlFor={reasonId}
          hint="Αιτιολογία για το αρχείο ελέγχου."
        >
          <Input
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            autoComplete="off"
            invalid={!!error}
          />
        </Field>

        {needsRefreshDecision ? (
          <>
            <Alert tone="warning">
              Ο λογαριασμός ανανεώθηκε χειροκίνητα μετά από αυτή την εγγραφή.
              Επίλεξε αν το υπόλοιπο πρέπει να προσαρμοστεί (compensating
              κίνηση) ή αν το τρέχον υπόλοιπο το περιλαμβάνει ήδη.
            </Alert>
            <Field
              label="Προσαρμογή υπολοίπου;"
              htmlFor={adjustId}
              hint="Η επιλογή επηρεάζει μόνο το τρέχον υπόλοιπο, όχι το ιστορικό."
            >
              <select
                id={adjustId}
                value={adjustChoice}
                onChange={(e) => setAdjustChoice(e.target.value as "yes" | "no" | "")}
                style={selectStyle}
                required
              >
                <option value="">— Επίλεξε —</option>
                <option value="yes">Ναι, προσαρμόσε το υπόλοιπο</option>
                <option value="no">Όχι, το υπόλοιπο παραμένει ως έχει</option>
              </select>
            </Field>
          </>
        ) : null}

        {error ? <Alert>{error}</Alert> : null}
      </form>
    </Sheet>
  );
}