"use client";

import { useState, useId } from "react";
import type { Account } from "@/lib/accounts/types";
import type { IncomeExpectation } from "@/lib/income/types";
import type { SettlementMode } from "@/lib/settlements/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Alert } from "@/components/ui/Alert";
import { cardStyle, dividerStyle } from "@/components/ui/styles";
import { formatEurEl, formatEurDelta } from "@/lib/ui/format";
import { parseEurosInput, todayAthensDate, newIdempotencyKey } from "@/lib/ui/form-helpers";
import { receiveIncomeApi } from "@/lib/ui/settlements-api";

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

type ModeChoice = SettlementMode | "";

type ReceiptSheetProps = {
  open: boolean;
  onClose: () => void;
  income: IncomeExpectation;
  accounts: Account[];
  onReceived: () => void;
};

export function ReceiptSheet({
  open,
  onClose,
  income,
  accounts,
  onReceived,
}: ReceiptSheetProps) {
  const pending_cents = income.pendingCents;
  const defaultAmount =
    pending_cents > 0 ? (pending_cents / 100).toString().replace(".", ",") : "";
  const [amountInput, setAmountInput] = useState(defaultAmount);
  const [mode, setMode] = useState<ModeChoice>("");
  const [accountId, setAccountId] = useState<string>(
    income.linkedAccountId ?? "",
  );
  const [businessDate, setBusinessDate] = useState<string>(todayAthensDate());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const amountId = useId();
  const modeId = useId();
  const accountIdId = useId();
  const dateId = useId();

  function reset() {
    setAmountInput(defaultAmount);
    setMode("");
    setAccountId(income.linkedAccountId ?? "");
    setBusinessDate(todayAthensDate());
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  const parsedAmount =
    amountInput.trim() !== "" ? parseEurosInput(amountInput) : null;
  const parsedCents = parsedAmount?.ok ? parsedAmount.cents : null;

  const activeAccounts = accounts.filter((a) => !a.archived);
  const selectedAccount = activeAccounts.find((a) => a.id === accountId) ?? null;

  const previewNewBalance =
    parsedCents !== null && mode === "UPDATE_ACCOUNT" && selectedAccount
      ? selectedAccount.currentBalanceCents === null
        ? parsedCents
        : selectedAccount.currentBalanceCents + parsedCents
      : null;

  const previewPending =
    parsedCents !== null
      ? income.expectedCents - income.receivedCents - parsedCents
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "") {
      setError("Επίλεξε αν το υπόλοιπο του λογαριασμού θα ενημερωθεί ή αν είναι ήδη αντανακλασμένο.");
      return;
    }
    const parsed = parseEurosInput(amountInput);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (parsed.cents <= 0) {
      setError("Το ποσό είσπραξης πρέπει να είναι θετικό.");
      return;
    }
    if (parsed.cents > income.pendingCents) {
      setError(
        `Το ποσό ξεπερνάει το εκκρεμές (${formatEurEl(income.pendingCents)}).`,
      );
      return;
    }
    if (mode === "UPDATE_ACCOUNT" && !accountId) {
      setError("Επίλεξε λογαριασμό για την ενημέρωση υπολοίπου.");
      return;
    }

    setPending(true);
    const result = await receiveIncomeApi({
      incomeExpectationId: income.id,
      amountCents: parsed.cents,
      mode,
      accountId: mode === "UPDATE_ACCOUNT" ? accountId : null,
      businessDate,
      idempotencyKey: newIdempotencyKey("receive"),
    });
    setPending(false);

    if (result.ok) {
      onReceived();
      reset();
    } else {
      setError(result.error);
    }
  }

  const modeLabel =
    mode === "UPDATE_ACCOUNT"
      ? "Ενημέρωση λογαριασμού"
      : mode === "ALREADY_REFLECTED"
        ? "Ήδη αντανακλασμένο"
        : "—";

  return (
    <Sheet
      open={open}
      title={`Είσπραξη: ${income.sourceName}`}
      onClose={handleClose}
      footer={
        <>
          <Button
            type="submit"
            form="receipt-form"
            pending={pending}
            style={{ width: "100%" }}
          >
            {pending ? "Καταχώρηση…" : "Καταχώρηση είσπραξης"}
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
        id="receipt-form"
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
      >
        <div
          style={{
            ...cardStyle,
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            fontSize: "0.9rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ color: "var(--muted)" }}>Αναμενόμενο</span>
            <span style={{ fontWeight: 700 }}>{formatEurEl(income.expectedCents)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ color: "var(--muted)" }}>Ελημμένο</span>
            <span style={{ fontWeight: 600 }}>{formatEurEl(income.receivedCents)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ color: "var(--muted)" }}>Εκκρεμές</span>
            <span style={{ fontWeight: 700, color: "var(--accent)" }}>
              {formatEurEl(income.pendingCents)}
            </span>
          </div>
          <hr style={dividerStyle} />
          <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
            Η χειροκίνητη ανανέωση υπολοίπου δεν σημαίνει αυτόματη είσπραξη.
          </p>
        </div>

        <Field
          label="Ποσό είσπραξης (€)"
          htmlFor={amountId}
          hint={`Προτείνεται το εκκρεμές (${formatEurEl(income.pendingCents)}). Μπορείς να το αλλάξεις.`}
        >
          <Input
            id={amountId}
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            inputMode="decimal"
            placeholder="π.χ. 1500,00"
            autoComplete="off"
            required
            invalid={!!error}
            autoFocus
          />
        </Field>

        <Field
          label="Ημερομηνία συναλλαγής"
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
          />
        </Field>

        <Field
          label="Ενημέρωση υπολοίπου;"
          htmlFor={modeId}
          hint="Επίλεξε αν η είσπραξη θα αυξήσει το υπόλοιπο του λογαριασμού ή αν το τραπεζικό υπόλοιπο την περιλαμβάνει ήδη."
        >
          <select
            id={modeId}
            value={mode}
            onChange={(e) => setMode(e.target.value as ModeChoice)}
            style={selectStyle}
            required
          >
            <option value="">— Επίλεξε —</option>
            <option value="UPDATE_ACCOUNT">
              Ναι, αύξησε το υπόλοιπο του λογαριασμού
            </option>
            <option value="ALREADY_REFLECTED">
              Όχι, είναι ήδη αντανακλασμένο στο τραπεζικό υπόλοιπο
            </option>
          </select>
        </Field>

        {mode === "UPDATE_ACCOUNT" ? (
          <Field
            label="Λογαριασμός"
            htmlFor={accountIdId}
            hint="Ο λογαριασμός του οποίου το υπόλοιπο θα αυξηθεί."
          >
            <select
              id={accountIdId}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              style={selectStyle}
              required
            >
              <option value="">— Επίλεξε —</option>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.currentBalanceCents !== null
                    ? ` (${formatEurEl(a.currentBalanceCents)})`
                    : " (—)"}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {mode === "ALREADY_REFLECTED" ? (
          <Alert tone="info">
            Το υπόλοιπο του λογαριασμού <strong>δεν</strong> θα αλλάξει. Η
            είσπραξη απλώς καταγράφεται ως ήδη αντανακλασμένη μετά από
            χειροκίνητο έλεγχο τράπεζας.
          </Alert>
        ) : null}

        {parsedCents !== null && mode !== "" ? (
          <div
            style={{
              ...cardStyle,
              padding: "0.7rem 0.8rem",
              fontSize: "0.85rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ color: "var(--muted)" }}>Ποσό</span>
              <span style={{ fontWeight: 600 }}>{formatEurEl(parsedCents)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ color: "var(--muted)" }}>Εκκρεμές μετά</span>
              <span
                style={{
                  fontWeight: 600,
                  color:
                    previewPending !== null && previewPending < 0
                      ? "#b91c1c"
                      : "var(--accent)",
                }}
              >
                {previewPending !== null ? formatEurEl(previewPending) : "—"}
              </span>
            </div>
            {mode === "UPDATE_ACCOUNT" && selectedAccount ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                  <span style={{ color: "var(--muted)" }}>
                    {selectedAccount.name} μετά
                  </span>
                  <span
                    style={{
                      fontWeight: 600,
                      color:
                        previewNewBalance !== null && previewNewBalance < 0
                          ? "#b91c1c"
                          : "var(--fg)",
                    }}
                  >
                    {previewNewBalance !== null ? formatEurEl(previewNewBalance) : "—"}
                  </span>
                </div>
                {selectedAccount.currentBalanceCents !== null && previewNewBalance !== null ? (
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                    <span style={{ color: "var(--muted)" }}>Διαφορά</span>
                    <span style={{ fontWeight: 600, color: "var(--accent)" }}>
                      {formatEurDelta(
                        previewNewBalance - selectedAccount.currentBalanceCents,
                      )}
                    </span>
                  </div>
                ) : null}
              </>
            ) : null}
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ color: "var(--muted)" }}>Κατάσταση</span>
              <span style={{ fontWeight: 600 }}>{modeLabel}</span>
            </div>
          </div>
        ) : null}

        {error ? <Alert>{error}</Alert> : null}
      </form>
    </Sheet>
  );
}