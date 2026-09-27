"use client";

import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Account } from "@/lib/accounts/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Alert } from "@/components/ui/Alert";
import { cardStyle, stickyControls } from "@/components/ui/styles";
import {
  formatEurEl,
  formatEurDelta,
  freshnessLabel,
} from "@/lib/ui/format";
import {
  renameAccountApi,
  refreshBalanceApi,
  archiveAccountApi,
  transferApi,
} from "@/lib/ui/accounts-api";
import {
  newIdempotencyKey,
  parseEurosInput,
  todayAthensDate,
} from "@/lib/ui/form-helpers";

type AccountDetailClientProps = {
  initialAccount: Account;
  initialReconciliation: {
    needsReconciliation: boolean;
    pendingMovementCount: number;
  };
  otherAccounts: Account[];
};

export function AccountDetailClient({
  initialAccount,
  initialReconciliation,
  otherAccounts,
}: AccountDetailClientProps) {
  const router = useRouter();
  const [account, setAccount] = useState<Account>(initialAccount);
  const [reconciliation] = useState(initialReconciliation);
  const [showRename, setShowRename] = useState(false);
  const [showRefresh, setShowRefresh] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  function refreshAll() {
    router.refresh();
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        <Link
          href="/accounts"
          style={{
            fontSize: "0.85rem",
            color: "var(--accent)",
            textDecoration: "none",
            minHeight: "2.75rem",
            display: "inline-flex",
            alignItems: "center",
            width: "fit-content",
          }}
        >
          ← Όλοι οι λογαριασμοί
        </Link>
        <h1
          style={{
            fontSize: "1.4rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            margin: 0,
            wordBreak: "break-word",
          }}
        >
          {account.name}
        </h1>
        {account.archived ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              padding: "0.2rem 0.6rem",
              borderRadius: "9999px",
              backgroundColor: "#fef2f2",
              color: "#b91c1c",
              fontSize: "0.78rem",
              fontWeight: 600,
              border: "1px solid #fecaca",
              width: "fit-content",
            }}
          >
            Αρχειοθετημένος
          </span>
        ) : null}
      </div>

      <div
        style={{
          ...cardStyle,
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          Τρέχον υπόλοιπο
        </span>
        <span
          style={{
            fontSize: "2rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color:
              account.currentBalanceCents === null
                ? "var(--muted)"
                : account.currentBalanceCents < 0
                  ? "#b91c1c"
                  : "var(--fg)",
          }}
        >
          {account.currentBalanceCents === null
            ? "—"
            : formatEurEl(account.currentBalanceCents)}
        </span>
        <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
          {account.currentBalanceCents === null
            ? "Δεν έχει εισαχθεί υπόλοιπο ακόμη"
            : `Ενημερώθηκε ${freshnessLabel(account.balanceAsOf)}`}
        </span>
      </div>

      {reconciliation.needsReconciliation ? (
        <Alert tone="warning">
          Υπάρχουν {reconciliation.pendingMovementCount} κινήσεις μετά την
          τελευταία ενημέρωση υπολοίπου. Ίσως είναι ήδη αντανακλασμένες στο
          τραπεζικό υπόλοιπο — έλεγξε πριν καταχωρήσεις νέο υπόλοιπο.
        </Alert>
      ) : null}

      {archiveError ? <Alert>{archiveError}</Alert> : null}

      <div style={stickyControls}>
        {!account.archived ? (
          <>
            <Button
              variant="primary"
              onClick={() => setShowRefresh(true)}
              style={{ width: "100%" }}
            >
              Ενημέρωση υπολοίπου
            </Button>
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              <Button
                variant="secondary"
                onClick={() => setShowRename(true)}
                style={{ flex: "1 1 8rem" }}
              >
                Μετονομασία
              </Button>
              {otherAccounts.length >= 1 ? (
                <Button
                  variant="secondary"
                  onClick={() => setShowTransfer(true)}
                  style={{ flex: "1 1 8rem" }}
                >
                  Μεταφορά
                </Button>
              ) : null}
              <Button
                variant="danger"
                onClick={() => {
                  setArchiveError(null);
                  setShowArchive(true);
                }}
                style={{ flex: "1 1 8rem" }}
              >
                Αρχειοθέτηση
              </Button>
            </div>
          </>
        ) : null}
      </div>

      <RenameSheet
        open={showRename}
        onClose={() => setShowRename(false)}
        account={account}
        onRenamed={(updated) => {
          setAccount(updated);
          refreshAll();
          setShowRename(false);
        }}
      />

      <RefreshSheet
        open={showRefresh}
        onClose={() => setShowRefresh(false)}
        account={account}
        onRefreshed={(updated) => {
          setAccount(updated);
          refreshAll();
          setShowRefresh(false);
        }}
      />

      <ArchiveSheet
        open={showArchive}
        onClose={() => setShowArchive(false)}
        account={account}
        onArchived={() => {
          refreshAll();
          router.push("/accounts");
        }}
        onError={(err) => {
          setArchiveError(err);
          setShowArchive(false);
        }}
      />

      {otherAccounts.length >= 1 ? (
        <TransferFromDetailSheet
          open={showTransfer}
          onClose={() => setShowTransfer(false)}
          account={account}
          otherAccounts={otherAccounts}
          onTransferred={() => {
            refreshAll();
            setShowTransfer(false);
          }}
        />
      ) : null}
    </>
  );
}

// --- Rename Sheet ---

type RenameSheetProps = {
  open: boolean;
  onClose: () => void;
  account: Account;
  onRenamed: (account: Account) => void;
};

function RenameSheet({ open, onClose, account, onRenamed }: RenameSheetProps) {
  const [name, setName] = useState(account.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nameId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Το όνομα δεν μπορεί να είναι κενό.");
      return;
    }
    if (trimmed.length > 100) {
      setError("Το όνομα δεν μπορεί να ξεπερνάει 100 χαρακτήρες.");
      return;
    }
    setPending(true);
    const result = await renameAccountApi(account.id, trimmed);
    setPending(false);
    if (result.ok) {
      onRenamed(result.account);
    } else {
      setError(result.error);
    }
  }

  return (
    <Sheet
      open={open}
      title="Μετονομασία λογαριασμού"
      onClose={onClose}
      footer={
        <>
          <Button
            type="submit"
            form="rename-form"
            pending={pending}
            style={{ width: "100%" }}
          >
            {pending ? "Αποθήκευση…" : "Αποθήκευση"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            style={{ width: "100%" }}
          >
            Άκυρο
          </Button>
        </>
      }
    >
      <form
        id="rename-form"
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
      >
        <Field label="Όνομα λογαριασμού" htmlFor={nameId}>
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
        {error ? <Alert>{error}</Alert> : null}
      </form>
    </Sheet>
  );
}

// --- Refresh Balance Sheet ---

type RefreshSheetProps = {
  open: boolean;
  onClose: () => void;
  account: Account;
  onRefreshed: (account: Account) => void;
};

function RefreshSheet({
  open,
  onClose,
  account,
  onRefreshed,
}: RefreshSheetProps) {
  const router = useRouter();
  const [balanceInput, setBalanceInput] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [staleVersion, setStaleVersion] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const balanceId = useId();
  const reasonId = useId();

  function reset() {
    setBalanceInput("");
    setReason("");
    setError(null);
    setStaleVersion(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  const parsed = balanceInput.trim() !== "" ? parseEurosInput(balanceInput) : null;
  const previewDiff =
    parsed?.ok && account.currentBalanceCents !== null
      ? parsed.cents - account.currentBalanceCents
      : null;
  const previewNew =
    parsed?.ok ? parsed.cents : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStaleVersion(null);

    const parsedResult = parseEurosInput(balanceInput);
    if (!parsedResult.ok) {
      setError(parsedResult.error);
      return;
    }

    setPending(true);
    const expectedVersion = staleVersion ?? account.version;
    const result = await refreshBalanceApi(account.id, {
      newBalanceCents: parsedResult.cents,
      expectedVersion,
      idempotencyKey: newIdempotencyKey("refresh"),
      reason: reason.trim() || undefined,
    });
    setPending(false);

    if (result.ok) {
      onRefreshed({
        ...account,
        currentBalanceCents: result.result.newBalanceCents,
        balanceAsOf: result.result.asOf,
        version: result.result.newVersion,
      });
      reset();
    } else {
      if (result.currentVersion !== undefined) {
        setStaleVersion(result.currentVersion);
        setError(
          "Ο λογαριασμός άλλαξε στο μεταξύ. Έλεγξε το τρέχον υπόλοιπο και δοκίμασε ξανά.",
        );
      } else {
        setError(result.error);
      }
    }
  }

  return (
    <Sheet
      open={open}
      title="Ενημέρωση υπολοίπου"
      onClose={handleClose}
      footer={
        <>
          <Button
            type="submit"
            form="refresh-form"
            pending={pending}
            style={{ width: "100%" }}
          >
            {pending ? "Ενημέρωση…" : "Αντικατάσταση υπολοίπου"}
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
        id="refresh-form"
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
      >
        <Alert tone="warning">
          Αυτή η ενέργεια <strong>αντικαθιστά</strong> το τρέχον υπόλοιπο με ό,τι
          καταχωρήσεις. Δεν δημιουργεί έσοδο ή έξοδο και δεν τακτοποιεί
          πληρωμές. Καταχώρησε το πραγματικό τραπεζικό/μετρητών υπόλοιπο όπως το
          βλέπεις τώρα.
        </Alert>

        <div
          style={{
            ...cardStyle,
            padding: "0.7rem 0.8rem",
            fontSize: "0.85rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.2rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "0.5rem",
            }}
          >
            <span style={{ color: "var(--muted)" }}>Τρέχον:</span>
            <span style={{ fontWeight: 600 }}>
              {account.currentBalanceCents === null
                ? "Δεν έχει οριστεί"
                : formatEurEl(account.currentBalanceCents)}
            </span>
          </div>
          {previewNew !== null ? (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                }}
              >
                <span style={{ color: "var(--muted)" }}>Νέο:</span>
                <span style={{ fontWeight: 600 }}>{formatEurEl(previewNew)}</span>
              </div>
              {previewDiff !== null ? (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                  }}
                >
                  <span style={{ color: "var(--muted)" }}>Διαφορά:</span>
                  <span
                    style={{
                      fontWeight: 600,
                      color:
                        previewDiff > 0
                          ? "var(--accent)"
                          : previewDiff < 0
                            ? "#b91c1c"
                            : "var(--muted)",
                    }}
                  >
                    {formatEurDelta(previewDiff)}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <Field
          label="Νέο υπόλοιπο"
          htmlFor={balanceId}
          hint="Δώσε ποσό σε ευρώ (π.χ. 1234,56). Θα αντικαταστήσει το τρέχον."
        >
          <Input
            id={balanceId}
            value={balanceInput}
            onChange={(e) => setBalanceInput(e.target.value)}
            inputMode="decimal"
            placeholder="π.χ. 1234,56"
            autoComplete="off"
            required
            invalid={!!error}
            autoFocus
          />
        </Field>

        <Field
          label="Σχόλιο (προαιρετικό)"
          htmlFor={reasonId}
          hint="Αιτιολογία για το αρχείο ελέγχου, π.χ. «έλεγχος τράπεζας»."
        >
          <Input
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            autoComplete="off"
          />
        </Field>

        {staleVersion !== null ? (
          <Alert tone="warning">
            {error ?? "Ο λογαριασμός ενημερώθηκε από άλλη ενέργεια. Το παρακάτω "
              + "τρέχον υπόλοιπο είναι πλέον αναλυόμενο."}
            <br />
            <button
              type="button"
              onClick={() => router.refresh()}
              style={{
                marginTop: "0.4rem",
                background: "none",
                border: "none",
                color: "var(--accent)",
                fontWeight: 600,
                cursor: "pointer",
                textDecoration: "underline",
                fontSize: "0.85rem",
              }}
            >
              Φόρτωση εκ νέου
            </button>
          </Alert>
        ) : error ? (
          <Alert>{error}</Alert>
        ) : null}
      </form>
    </Sheet>
  );
}

// --- Archive Sheet ---

type ArchiveSheetProps = {
  open: boolean;
  onClose: () => void;
  account: Account;
  onArchived: () => void;
  onError: (error: string) => void;
};

function ArchiveSheet({
  open,
  onClose,
  account,
  onArchived,
  onError,
}: ArchiveSheetProps) {
  const [pending, setPending] = useState(false);

  async function handleArchive() {
    setPending(true);
    const result = await archiveAccountApi(account.id);
    setPending(false);
    if (result.ok) {
      onArchived();
    } else {
      onError(result.error);
    }
  }

  return (
    <Sheet
      open={open}
      title="Αρχειοθέτηση λογαριασμού"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="danger"
            pending={pending}
            onClick={handleArchive}
            style={{ width: "100%" }}
          >
            {pending ? "Αρχειοθέτηση…" : "Ναι, αρχειοθέτηση"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            style={{ width: "100%" }}
          >
            Άκυρο
          </Button>
        </>
      }
    >
      <Alert tone="warning">
        Η αρχειοθέτηση κρύβει τον λογαριασμό από την κύρια λίστα. Δεν διαγράφει
        το ιστορικό κινήσεων. Μπορείς να αρχειοθετήσεις μόνο λογαριασμούς με
        μηδενικό ή μη ορισμένο υπόλοιπο.
      </Alert>
      <p style={{ fontSize: "0.9rem", color: "var(--muted)", margin: 0 }}>
        Λογαριασμός: <strong>{account.name}</strong>
        <br />
        Υπόλοιπο:{" "}
        {account.currentBalanceCents === null
          ? "Δεν έχει οριστεί"
          : formatEurEl(account.currentBalanceCents)}
      </p>
    </Sheet>
  );
}

// --- Transfer from Detail Sheet ---

type TransferFromDetailSheetProps = {
  open: boolean;
  onClose: () => void;
  account: Account;
  otherAccounts: Account[];
  onTransferred: () => void;
};

function TransferFromDetailSheet({
  open,
  onClose,
  account,
  otherAccounts,
  onTransferred,
}: TransferFromDetailSheetProps) {
  const [direction, setDirection] = useState<"from" | "to">("from");
  const [otherId, setOtherId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const otherIdId = useId();
  const amountId = useId();

  function reset() {
    setDirection("from");
    setOtherId("");
    setAmountInput("");
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  const otherAccount = otherAccounts.find((a) => a.id === otherId);
  const parsedAmount =
    amountInput.trim() !== "" ? parseEurosInput(amountInput) : null;

  const fromAccount =
    direction === "from" ? account : otherAccount;
  const toAccount =
    direction === "from" ? otherAccount : account;

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

    if (!otherId) {
      setError("Επίλεξε λογαριασμό προορισμού.");
      return;
    }
    const parsed = parseEurosInput(amountInput);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (parsed.cents <= 0) {
      setError("Το ποσό πρέπει να είναι θετικό.");
      return;
    }

    const finalFromId = direction === "from" ? account.id : otherId;
    const finalToId = direction === "from" ? otherId : account.id;

    setPending(true);
    const result = await transferApi({
      fromAccountId: finalFromId,
      toAccountId: finalToId,
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

  return (
    <Sheet
      open={open}
      title="Μεταφορά"
      onClose={handleClose}
      footer={
        <>
          <Button
            type="submit"
            form="transfer-detail-form"
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
        id="transfer-detail-form"
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
      >
        <Alert tone="info">
          Η μεταφορά δεν είναι έσοδο ή έξοδο — μετακινεί χρήματα μεταξύ των
          δικών σου λογαριασμών.
        </Alert>

        <div
          style={{
            display: "flex",
            gap: "0.4rem",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={() => setDirection("from")}
            style={{
              flex: "1 1 8rem",
              minHeight: "2.75rem",
              padding: "0.5rem 0.8rem",
              borderRadius: "0.5rem",
              fontWeight: 600,
              fontSize: "0.88rem",
              border:
                direction === "from"
                  ? "2px solid var(--accent)"
                  : "1px solid var(--border)",
              backgroundColor:
                direction === "from" ? "var(--accent-weak)" : "var(--card)",
              color: direction === "from" ? "var(--accent)" : "var(--fg)",
              cursor: "pointer",
            }}
          >
            Από αυτόν
          </button>
          <button
            type="button"
            onClick={() => setDirection("to")}
            style={{
              flex: "1 1 8rem",
              minHeight: "2.75rem",
              padding: "0.5rem 0.8rem",
              borderRadius: "0.5rem",
              fontWeight: 600,
              fontSize: "0.88rem",
              border:
                direction === "to"
                  ? "2px solid var(--accent)"
                  : "1px solid var(--border)",
              backgroundColor:
                direction === "to" ? "var(--accent-weak)" : "var(--card)",
              color: direction === "to" ? "var(--accent)" : "var(--fg)",
              cursor: "pointer",
            }}
          >
            Προς αυτόν
          </button>
        </div>

        <Field
          label={
            direction === "from" ? "Προς λογαριασμό" : "Από λογαριασμό"
          }
          htmlFor={otherIdId}
        >
          <select
            id={otherIdId}
            value={otherId}
            onChange={(e) => setOtherId(e.target.value)}
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
            {otherAccounts.map((a) => (
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
            {previewTo !== null && toAccount ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                }}
              >
                <span style={{ color: "var(--muted)" }}>
                  {toAccount.name} μετά:
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    color: previewTo < 0 ? "#b91c1c" : "var(--fg)",
                  }}
                >
                  {formatEurEl(previewTo)}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <Alert>{error}</Alert> : null}
      </form>
    </Sheet>
  );
}