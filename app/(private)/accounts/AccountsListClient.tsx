"use client";

import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import type { Account } from "@/lib/accounts/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Alert } from "@/components/ui/Alert";
import { cardStyle, stickyControls } from "@/components/ui/styles";
import {
  formatEurEl,
  freshnessLabel,
} from "@/lib/ui/format";
import {
  createAccountApi,
  transferApi,
} from "@/lib/ui/accounts-api";
import {
  newIdempotencyKey,
  parseEurosInput,
  todayAthensDate,
} from "@/lib/ui/form-helpers";

type AccountsListClientProps = {
  initialAccounts: Account[];
};

export function AccountsListClient({
  initialAccounts,
}: AccountsListClientProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [showCreate, setShowCreate] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  function refreshList() {
    router.refresh();
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.3rem",
        }}
      >
        <h1
          style={{
            fontSize: "1.4rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Λογαριασμοί
        </h1>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
          {accounts.length === 0
            ? "Δεν υπάρχουν λογαριασμοί ακόμη. Δημιούργησε τον πρώτο."
            : `${accounts.length} λογαριασμ${accounts.length === 1 ? "ός" : "οί"}`}
        </p>
      </div>

      {accounts.length === 0 ? (
        <div style={cardStyle}>
          <p
            style={{
              margin: 0,
              fontSize: "0.95rem",
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            Ξεκίνα προσθέτοντας έναν λογαριασμό (π.χ. τραπεζικός, μετρητά).
            Το υπόλοιπο θα ενημερώνεται χειροκίνητα — δεν υπάρχει αυτόματη
            σύνδεση με την τράπεζα.
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
            gap: "0.6rem",
          }}
        >
          {accounts.map((account) => (
            <li key={account.id}>
              <a
                href={`/accounts/${account.id}`}
                style={{
                  ...cardStyle,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.35rem",
                  textDecoration: "none",
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                  }}
                >
                  <span
                    style={{
                      fontSize: "1.05rem",
                      fontWeight: 700,
                      color: "var(--fg)",
                      wordBreak: "break-word",
                    }}
                  >
                    {account.name}
                  </span>
                  <span
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: 700,
                      color:
                        account.currentBalanceCents === null
                          ? "var(--muted)"
                          : account.currentBalanceCents < 0
                            ? "#b91c1c"
                            : "var(--fg)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {account.currentBalanceCents === null
                      ? "—"
                      : formatEurEl(account.currentBalanceCents)}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--muted)",
                    }}
                  >
                    {account.currentBalanceCents === null
                      ? "Δεν έχει εισαχθεί υπόλοιπο"
                      : `Ενημερώθηκε ${freshnessLabel(account.balanceAsOf)}`}
                  </span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      <div style={stickyControls}>
        <Button
          variant="primary"
          onClick={() => setShowCreate(true)}
          style={{ width: "100%" }}
        >
          + Νέος λογαριασμός
        </Button>
        {accounts.length >= 2 ? (
          <Button
            variant="secondary"
            onClick={() => setShowTransfer(true)}
            style={{ width: "100%" }}
          >
            Εσωτερική μεταφορά
          </Button>
        ) : null}
      </div>

      <CreateAccountSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(account) => {
          setAccounts((prev) => [...prev, account]);
          refreshList();
          setShowCreate(false);
        }}
      />

      <TransferSheet
        open={showTransfer}
        onClose={() => setShowTransfer(false)}
        accounts={accounts}
        onTransferred={() => {
          refreshList();
          setShowTransfer(false);
        }}
      />
    </>
  );
}

// --- Create Account Sheet ---

type CreateAccountSheetProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (account: Account) => void;
};

function CreateAccountSheet({
  open,
  onClose,
  onCreated,
}: CreateAccountSheetProps) {
  const [name, setName] = useState("");
  const [balanceInput, setBalanceInput] = useState("");
  const [trackBalance, setTrackBalance] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nameId = useId();

  function reset() {
    setName("");
    setBalanceInput("");
    setTrackBalance(true);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError("Το όνομα λογαριασμού δεν μπορεί να είναι κενό.");
      return;
    }
    if (trimmedName.length > 100) {
      setError("Το όνομα λογαριασμού δεν μπορεί να ξεπερνάει 100 χαρακτήρες.");
      return;
    }

    let initialBalanceCents: number | null = null;
    if (balanceInput.trim() !== "") {
      const parsed = parseEurosInput(balanceInput);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      initialBalanceCents = parsed.cents;
    }

    setPending(true);
    const result = await createAccountApi({
      name: trimmedName,
      initialBalanceCents,
      trackBalance,
      idempotencyKey: newIdempotencyKey("create"),
    });
    setPending(false);

    if (result.ok) {
      onCreated(result.account);
      reset();
    } else {
      setError(result.error);
    }
  }

  return (
    <Sheet
      open={open}
      title="Νέος λογαριασμός"
      onClose={handleClose}
      footer={
        <>
          <Button
            type="submit"
            form="create-account-form"
            pending={pending}
            style={{ width: "100%" }}
          >
            {pending ? "Δημιουργία…" : "Δημιουργία"}
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
        id="create-account-form"
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
      >
        <Field
          label="Όνομα λογαριασμού"
          htmlFor={nameId}
          hint="π.χ. «Τράπεζα Alpha» ή «Μετρητά»"
        >
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
            autoComplete="off"
            invalid={!!error}
            autoFocus
          />
        </Field>

        <Field
          label="Αρχικό υπόλοιπο (προαιρετικό)"
          hint="Άφησε κενό αν δεν έχεις ελέγξει το υπόλοιπο ακόμη. Δώσε ποσό σε ευρώ (π.χ. 1200,50)."
        >
          <Input
            value={balanceInput}
            onChange={(e) => setBalanceInput(e.target.value)}
            inputMode="decimal"
            placeholder="π.χ. 1200,50"
            autoComplete="off"
            invalid={!!error}
          />
        </Field>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.9rem",
            color: "var(--fg)",
            cursor: "pointer",
            minHeight: "2.75rem",
          }}
        >
          <input
            type="checkbox"
            checked={trackBalance}
            onChange={(e) => setTrackBalance(e.target.checked)}
            style={{ width: "1.2rem", height: "1.2rem" }}
          />
          Παρακολούθηση υπολοίπου
        </label>

        {error ? <Alert>{error}</Alert> : null}
      </form>
    </Sheet>
  );
}

// --- Transfer Sheet ---

type TransferSheetProps = {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  onTransferred: () => void;
};

function TransferSheet({
  open,
  onClose,
  accounts,
  onTransferred,
}: TransferSheetProps) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fromIdId = useId();
  const toIdId = useId();
  const amountId = useId();

  function reset() {
    setFromId("");
    setToId("");
    setAmountInput("");
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  const fromAccount = accounts.find((a) => a.id === fromId);
  const toAccount = accounts.find((a) => a.id === toId);
  const parsedAmount = amountInput.trim() !== "" ? parseEurosInput(amountInput) : null;
  const previewFrom =
    fromAccount && parsedAmount?.ok
      ? (fromAccount.currentBalanceCents ?? 0) - parsedAmount.cents
      : null;
  const previewTo =
    toAccount && parsedAmount?.ok
      ? (toAccount.currentBalanceCents ?? 0) + parsedAmount.cents
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!fromId || !toId) {
      setError("Επίλεξε λογαριασμό προορισμού και προέλευσης.");
      return;
    }
    if (fromId === toId) {
      setError("Η προέλευση και ο προορισμός πρέπει να είναι διαφορετικοί.");
      return;
    }
    const parsed = parseEurosInput(amountInput);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (parsed.cents <= 0) {
      setError("Το ποσό μεταφοράς πρέπει να είναι θετικό.");
      return;
    }

    setPending(true);
    const result = await transferApi({
      fromAccountId: fromId,
      toAccountId: toId,
      amountCents: parsed.cents,
      businessDate: todayAthensDate(),
      idempotencyKey: newIdempotencyKey("transfer"),
    });
    setPending(false);

    if (result.ok) {
      onTransferred();
      reset();
    } else {
      setError(result.error);
    }
  }

  const activeAccounts = accounts.filter((a) => !a.archived);

  return (
    <Sheet
      open={open}
      title="Εσωτερική μεταφορά"
      onClose={handleClose}
      footer={
        <>
          <Button
            type="submit"
            form="transfer-form"
            pending={pending}
            style={{ width: "100%" }}
          >
            {pending ? "Μεταφορά…" : "Μεταφορά"}
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
        id="transfer-form"
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
      >
        <Alert tone="info">
          Η εσωτερική μεταφορά δεν είναι έσοδο ή έξοδο. Μετακινεί χρήματα μεταξύ
          των δικών σου λογαριασμών — το σύνολο δεν αλλάζει.
        </Alert>

        <Field label="Από λογαριασμό" htmlFor={fromIdId}>
          <select
            id={fromIdId}
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            style={{
              width: "100%",
              minHeight: "2.75rem",
              padding: "0.55rem 0.7rem",
              borderRadius: "0.5rem",
              border: "1px solid var(--border)",
              fontSize: "1rem",
              backgroundColor: "var(--card)",
              color: "var(--fg)",
            }}
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

        <Field label="Προς λογαριασμό" htmlFor={toIdId}>
          <select
            id={toIdId}
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            style={{
              width: "100%",
              minHeight: "2.75rem",
              padding: "0.55rem 0.7rem",
              borderRadius: "0.5rem",
              border: "1px solid var(--border)",
              fontSize: "1rem",
              backgroundColor: "var(--card)",
              color: "var(--fg)",
            }}
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

        <Field
          label="Ποσό"
          htmlFor={amountId}
          hint="Δώσε ποσό σε ευρώ (π.χ. 500 ή 500,00)."
        >
          <Input
            id={amountId}
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            inputMode="decimal"
            placeholder="π.χ. 500,00"
            autoComplete="off"
            required
            invalid={!!error}
          />
        </Field>

        {previewFrom !== null && fromAccount ? (
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.5rem",
              }}
            >
              <span style={{ color: "var(--muted)" }}>
                {fromAccount.name} μετά:
              </span>
              <span
                style={{
                  fontWeight: 600,
                  color: previewFrom < 0 ? "#b91c1c" : "var(--fg)",
                }}
              >
                {formatEurEl(previewFrom)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.5rem",
              }}
            >
              <span style={{ color: "var(--muted)" }}>
                {toAccount?.name} μετά:
              </span>
              <span
                style={{
                  fontWeight: 600,
                  color: (previewTo ?? 0) < 0 ? "#b91c1c" : "var(--fg)",
                }}
              >
                {previewTo !== null ? formatEurEl(previewTo) : "—"}
              </span>
            </div>
          </div>
        ) : null}

        {error ? <Alert>{error}</Alert> : null}
      </form>
    </Sheet>
  );
}