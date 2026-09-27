"use client";

import { useState, useId, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { MonthlyPlan } from "@/lib/months/types";
import type { Obligation, ObligationKind } from "@/lib/obligations/types";
import type { IncomeExpectation } from "@/lib/income/types";
import type { Account } from "@/lib/accounts/types";
import type {
  SettlementHistoryEntry,
  ReceiptHistoryEntry,
} from "@/lib/settlements/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Alert } from "@/components/ui/Alert";
import { cardStyle, stickyControls, dividerStyle } from "@/components/ui/styles";
import { formatEurEl } from "@/lib/ui/format";
import { parseEurosInput } from "@/lib/ui/form-helpers";
import {
  createObligationApi,
  updateObligationApi,
  cancelObligationApi,
  releaseObligationApi,
  createIncomeApi,
  updateIncomeApi,
  cancelIncomeApi,
} from "@/lib/ui/activity-api";
import {
  listSettlementHistoryApi,
  listReceiptHistoryApi,
} from "@/lib/ui/settlements-api";
import { PaymentSheet } from "@/components/settlements/PaymentSheet";
import { ReceiptSheet } from "@/components/settlements/ReceiptSheet";
import { ReversalSheet } from "@/components/settlements/ReversalSheet";
import { SettlementHistory } from "@/components/settlements/SettlementHistory";

type ActivityPageClientProps = {
  currentMonth: string;
  plans: MonthlyPlan[];
  obligations: Obligation[];
  reserved: Obligation[];
  income: IncomeExpectation[];
  accounts: Account[];
};

type Tab = "expenses" | "reserves" | "income";

const TAB_LABELS_EL: Record<Tab, string> = {
  expenses: "Έξοδα",
  reserves: "Δεσμεύσεις",
  income: "Έσοδα",
};

const tabButtonStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  minHeight: "2.75rem",
  padding: "0.5rem 0.5rem",
  border: "none",
  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
  backgroundColor: "transparent",
  color: active ? "var(--accent)" : "var(--muted)",
  fontWeight: active ? 700 : 500,
  fontSize: "0.9rem",
  cursor: "pointer",
});

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

export function ActivityPageClient({
  currentMonth,
  plans,
  obligations,
  reserved,
  income,
  accounts,
}: ActivityPageClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("expenses");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [showForm, setShowForm] = useState(false);
  const [editingObligation, setEditingObligation] = useState<Obligation | null>(null);
  const [editingIncome, setEditingIncome] = useState<IncomeExpectation | null>(null);
  const [detailItem, setDetailItem] = useState<
    | { type: "obligation"; data: Obligation }
    | { type: "income"; data: IncomeExpectation }
    | null
  >(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [reversalTarget, setReversalTarget] = useState<
    | {
        kind: "settlement";
        entry: SettlementHistoryEntry;
        obligationTitle: string;
      }
    | {
        kind: "receipt";
        entry: ReceiptHistoryEntry;
        incomeSourceName: string;
      }
    | null
  >(null);

  function refresh() {
    router.refresh();
  }

  const sortedPlans = useMemo(
    () => [...plans].sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
    [plans],
  );

  const activeAccounts = accounts.filter((a) => !a.archived);

  const currentObligations = useMemo(
    () => (tab === "expenses" ? obligations : tab === "reserves" ? reserved : []),
    [tab, obligations, reserved],
  );
  const currentIncome = useMemo(
    () => (tab === "income" ? income : []),
    [tab, income],
  );

  const totalPlanned = useMemo(
    () => currentObligations.reduce((sum, o) => sum + o.plannedCents, 0),
    [currentObligations],
  );
  const totalPaid = useMemo(
    () => currentObligations.reduce((sum, o) => sum + o.paidCents, 0),
    [currentObligations],
  );
  const totalRemaining = totalPlanned - totalPaid;

  const totalExpected = useMemo(
    () => currentIncome.reduce((sum, i) => sum + i.expectedCents, 0),
    [currentIncome],
  );
  const totalReceived = useMemo(
    () => currentIncome.reduce((sum, i) => sum + i.receivedCents, 0),
    [currentIncome],
  );
  const totalPending = totalExpected - totalReceived;

  function handleOpenCreate() {
    setEditingObligation(null);
    setEditingIncome(null);
    setShowForm(true);
  }

  function handleEditObligation(o: Obligation) {
    setEditingObligation(o);
    setEditingIncome(null);
    setDetailItem(null);
    setShowForm(true);
  }

  function handleEditIncome(i: IncomeExpectation) {
    setEditingIncome(i);
    setEditingObligation(null);
    setDetailItem(null);
    setShowForm(true);
  }

  function handleTapObligation(o: Obligation) {
    setDetailItem({ type: "obligation", data: o });
  }

  function handleTapIncome(i: IncomeExpectation) {
    setDetailItem({ type: "income", data: i });
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
          Δραστηριότητα
        </h1>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
          {selectedMonth}
        </p>
      </div>

      {/* Month selector */}
      <div style={cardStyle}>
        <Field label="Μήνας" hint="Επίλεξε μήνα για προβολή εγγραφών.">
          <select
            value={selectedMonth}
            onChange={(e) => {
              setSelectedMonth(e.target.value);
              refresh();
            }}
            style={selectStyle}
          >
            {sortedPlans.length === 0 ? (
              <option value={currentMonth}>{currentMonth} (τρέχων)</option>
            ) : (
              sortedPlans.map((p) => (
                <option key={p.id} value={p.monthKey}>
                  {p.monthKey}
                  {p.status === "closed" ? " (κλειστός)" : ""}
                </option>
              ))
            )}
          </select>
        </Field>
      </div>

      {/* Tab filter */}
      <div
        role="tablist"
        aria-label="Τύπος εγγραφών"
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {(Object.keys(TAB_LABELS_EL) as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => setTab(t)}
            style={tabButtonStyle(tab === t)}
          >
            {TAB_LABELS_EL[t]}
          </button>
        ))}
      </div>

      {/* Summary card */}
      <div style={cardStyle}>
        {tab === "income" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                Αναμενομένο
              </span>
              <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--fg)" }}>
                {formatEurEl(totalExpected)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                Ελημμένο
              </span>
              <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--fg)" }}>
                {formatEurEl(totalReceived)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                Εκκρεμές
              </span>
              <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--accent)" }}>
                {formatEurEl(totalPending)}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                Σχεδιασμένο
              </span>
              <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--fg)" }}>
                {formatEurEl(totalPlanned)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                Πληρωμένο
              </span>
              <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--fg)" }}>
                {formatEurEl(totalPaid)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                Υπόλοιπο
              </span>
              <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--accent)" }}>
                {formatEurEl(totalRemaining)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* List */}
      {tab === "income" ? (
        currentIncome.length === 0 ? (
          <div style={cardStyle}>
            <p
              style={{
                margin: 0,
                fontSize: "0.9rem",
                color: "var(--muted)",
                lineHeight: 1.5,
              }}
            >
              Δεν υπάρχουν έσοδα για αυτόν τον μήνα. Πρόσθεσε έσοδο ή
              δημιούργησε εγγραφές από τα πρότυπα.
            </p>
          </div>
        ) : (
          <EntryList
            items={currentIncome.map((i) => ({
              id: i.id,
              title: i.sourceName,
              plannedCents: i.expectedCents,
              paidCents: i.receivedCents,
              remainingCents: i.pendingCents,
              dueDate: null,
              status: i.status,
              isIncome: true,
            }))}
            onTap={(id) => {
              const item = income.find((i) => i.id === id);
              if (item) handleTapIncome(item);
            }}
          />
        )
      ) : (
        currentObligations.length === 0 ? (
          <div style={cardStyle}>
            <p
              style={{
                margin: 0,
                fontSize: "0.9rem",
                color: "var(--muted)",
                lineHeight: 1.5,
              }}
            >
              {tab === "reserves"
                ? "Δεν υπάρχουν δεσμεύσεις για αυτόν τον μήνα."
                : "Δεν υπάρχουν έξοδα για αυτόν τον μήνα. Πρόσθεσε έξοδο ή δημιούργησε εγγραφές από τα πρότυπα."}
            </p>
          </div>
        ) : (
          <EntryList
            items={currentObligations.map((o) => ({
              id: o.id,
              title: o.title,
              plannedCents: o.plannedCents,
              paidCents: o.paidCents,
              remainingCents: o.remainingCents,
              dueDate: o.dueDate,
              status: o.status,
              isIncome: false,
            }))}
            onTap={(id) => {
              const item = currentObligations.find((o) => o.id === id);
              if (item) handleTapObligation(item);
            }}
          />
        )
      )}

      <div style={stickyControls}>
        <Button
          variant="primary"
          onClick={handleOpenCreate}
          style={{ width: "100%" }}
        >
          + {tab === "income" ? "Νέο έσοδο" : tab === "reserves" ? "Νέα δέσμευση" : "Νέο έξοδο"}
        </Button>
      </div>

      {/* Create/Edit form sheet */}
      {tab === "income" ? (
        <IncomeFormSheet
          open={showForm}
          onClose={() => {
            setShowForm(false);
            setEditingIncome(null);
          }}
          editing={editingIncome}
          monthKey={selectedMonth}
          accounts={activeAccounts}
          onSaved={() => {
            refresh();
            setShowForm(false);
            setEditingIncome(null);
          }}
        />
      ) : (
        <ObligationFormSheet
          open={showForm}
          onClose={() => {
            setShowForm(false);
            setEditingObligation(null);
          }}
          editing={editingObligation}
          monthKey={selectedMonth}
          kind={tab === "reserves" ? "reserved" : "ordinary"}
          accounts={activeAccounts}
          reserves={reserved}
          onSaved={() => {
            refresh();
            setShowForm(false);
            setEditingObligation(null);
          }}
        />
      )}

      {/* Detail sheet */}
      {detailItem?.type === "obligation" ? (
        <ObligationDetailSheet
          obligation={detailItem.data}
          accounts={activeAccounts}
          onClose={() => setDetailItem(null)}
          onEdit={() => handleEditObligation(detailItem.data)}
          onCanceled={() => {
            refresh();
            setDetailItem(null);
          }}
          onReleased={() => {
            refresh();
            setDetailItem(null);
          }}
          onPay={() => setShowPayment(true)}
          onReverse={(entry) =>
            setReversalTarget({
              kind: "settlement",
              entry,
              obligationTitle: detailItem.data.title,
            })
          }
        />
      ) : detailItem?.type === "income" ? (
        <IncomeDetailSheet
          income={detailItem.data}
          accounts={activeAccounts}
          onClose={() => setDetailItem(null)}
          onEdit={() => handleEditIncome(detailItem.data)}
          onCanceled={() => {
            refresh();
            setDetailItem(null);
          }}
          onReceive={() => setShowReceipt(true)}
          onReverse={(entry) =>
            setReversalTarget({
              kind: "receipt",
              entry,
              incomeSourceName: detailItem.data.sourceName,
            })
          }
        />
      ) : null}

      {detailItem?.type === "obligation" && showPayment ? (
        <PaymentSheet
          open={showPayment}
          onClose={() => setShowPayment(false)}
          obligation={detailItem.data}
          accounts={activeAccounts}
          onPaid={() => {
            refresh();
            setShowPayment(false);
            setDetailItem(null);
          }}
        />
      ) : null}

      {detailItem?.type === "income" && showReceipt ? (
        <ReceiptSheet
          open={showReceipt}
          onClose={() => setShowReceipt(false)}
          income={detailItem.data}
          accounts={activeAccounts}
          onReceived={() => {
            refresh();
            setShowReceipt(false);
            setDetailItem(null);
          }}
        />
      ) : null}

      {reversalTarget ? (
        reversalTarget.kind === "settlement" ? (
          <ReversalSheet
            open={true}
            kind="settlement"
            entry={reversalTarget.entry}
            obligationTitle={reversalTarget.obligationTitle}
            onClose={() => setReversalTarget(null)}
            onReversed={() => {
              refresh();
              setReversalTarget(null);
              setDetailItem(null);
            }}
          />
        ) : (
          <ReversalSheet
            open={true}
            kind="receipt"
            entry={reversalTarget.entry}
            incomeSourceName={reversalTarget.incomeSourceName}
            onClose={() => setReversalTarget(null)}
            onReversed={() => {
              refresh();
              setReversalTarget(null);
              setDetailItem(null);
            }}
          />
        )
      ) : null}
    </>
  );
}

// --- Entry list ---

type EntryListItem = {
  id: string;
  title: string;
  plannedCents: number;
  paidCents: number;
  remainingCents: number;
  dueDate: string | null;
  status: string;
  isIncome: boolean;
};

function EntryList({
  items,
  onTap,
}: {
  items: EntryListItem[];
  onTap: (id: string) => void;
}) {
  return (
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
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onTap(item.id)}
            style={{
              ...cardStyle,
              display: "flex",
              flexDirection: "column",
              gap: "0.3rem",
              textAlign: "left",
              cursor: "pointer",
              width: "100%",
              border: "1px solid var(--border)",
              opacity: item.status === "cancelled" ? 0.55 : 1,
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
                  fontSize: "1rem",
                  fontWeight: 700,
                  color: "var(--fg)",
                  wordBreak: "break-word",
                }}
              >
                {item.title}
              </span>
              <span
                style={{
                  fontSize: "1rem",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  color: "var(--fg)",
                }}
              >
                {formatEurEl(item.plannedCents)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                flexWrap: "wrap",
                fontSize: "0.78rem",
                color: "var(--muted)",
              }}
            >
              {item.isIncome ? (
                <>
                  <span>Ελημμένο: {formatEurEl(item.paidCents)}</span>
                  <span>· Εκκρεμές: {formatEurEl(item.remainingCents)}</span>
                </>
              ) : (
                <>
                  <span>Πληρωμένο: {formatEurEl(item.paidCents)}</span>
                  <span>· Υπόλοιπο: {formatEurEl(item.remainingCents)}</span>
                </>
              )}
              {item.dueDate ? <span>· Λήξη: {item.dueDate}</span> : null}
              {item.status === "cancelled" ? <span>· Ακυρώθηκε</span> : null}
              {item.status === "settled" ? <span>· Εξοφλήθηκε</span> : null}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// --- Obligation form sheet ---

type ObligationFormSheetProps = {
  open: boolean;
  onClose: () => void;
  editing: Obligation | null;
  monthKey: string;
  kind: ObligationKind;
  accounts: Account[];
  reserves: Obligation[];
  onSaved: () => void;
};

function ObligationFormSheet({
  open,
  onClose,
  editing,
  monthKey,
  kind,
  accounts,
  reserves,
  onSaved,
}: ObligationFormSheetProps) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [amountInput, setAmountInput] = useState(
    editing && editing.plannedCents > 0
      ? (editing.plannedCents / 100).toString().replace(".", ",")
      : "",
  );
  const [dueDate, setDueDate] = useState(editing?.dueDate ?? "");
  const [accountId, setAccountId] = useState(editing?.linkedAccountId ?? "");
  const [linkedReserveId, setLinkedReserveId] = useState(
    editing?.linkedReserveId ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const titleId = useId();
  const amountId = useId();
  const dueDateId = useId();
  const accountIdId = useId();
  const reserveIdId = useId();

  const activeReserves = reserves.filter(
    (r) => r.status !== "cancelled" && r.status !== "released",
  );

  function reset() {
    setTitle("");
    setAmountInput("");
    setDueDate("");
    setAccountId("");
    setLinkedReserveId("");
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setError("Ο τίτλος δεν μπορεί να είναι κενός.");
      return;
    }
    if (trimmedTitle.length > 200) {
      setError("Ο τίτλος δεν μπορεί να ξεπερνάει 200 χαρακτήρες.");
      return;
    }

    const parsed = parseEurosInput(amountInput);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    // When linking an ordinary expense to a reserve, the amount must match
    // the reserve's planned amount (one canonical liability).
    const reserveId = linkedReserveId || null;
    if (reserveId && kind === "ordinary") {
      const linked = activeReserves.find((r) => r.id === reserveId);
      if (linked && linked.plannedCents !== parsed.cents) {
        setError(
          `Το ποσό πρέπει να ταιριάζει με τη δεσμευμένη («${linked.title}»): ${formatEurEl(linked.plannedCents)}.`,
        );
        return;
      }
    }

    setPending(true);
    if (editing) {
      const result = await updateObligationApi(editing.id, {
        title: trimmedTitle,
        plannedCents: parsed.cents,
        dueDate: dueDate.trim() || null,
        linkedAccountId: accountId || null,
        linkedReserveId: reserveId,
      });
      setPending(false);
      if (result.ok) {
        onSaved();
      } else {
        setError(result.error);
      }
    } else {
      const result = await createObligationApi({
        kind,
        title: trimmedTitle,
        plannedCents: parsed.cents,
        monthKey,
        dueDate: dueDate.trim() || null,
        linkedAccountId: accountId || null,
        linkedReserveId: reserveId,
      });
      setPending(false);
      if (result.ok) {
        onSaved();
      } else {
        setError(result.error);
      }
    }
  }

  const kindLabel = kind === "reserved" ? "δέσμευση" : "έξοδο";

  return (
    <Sheet
      open={open}
      title={editing ? `Επεξεργασία ${kindLabel}ός` : `Νέο ${kindLabel}`}
      onClose={handleClose}
      footer={
        <>
          <Button
            type="submit"
            form="obligation-form"
            pending={pending}
            style={{ width: "100%" }}
          >
            {pending ? "Αποθήκευση…" : "Αποθήκευση"}
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
        id="obligation-form"
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
      >
        <Field
          label="Τίτλος"
          htmlFor={titleId}
          hint="π.χ. «Ενοίκιο», «Βενζίνη», «Φόρος»"
        >
          <Input
            id={titleId}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            autoComplete="off"
            invalid={!!error}
            autoFocus
          />
        </Field>

        <Field
          label="Ποσό (€)"
          htmlFor={amountId}
          hint="Δώσε ποσό σε ευρώ (π.χ. 80 ή 80,00). Το ποσό δεν μηδενίζεται με μερικές πληρωμές."
        >
          <Input
            id={amountId}
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            inputMode="decimal"
            placeholder="π.χ. 80,00"
            autoComplete="off"
            required
            invalid={!!error}
          />
        </Field>

        <Field
          label="Ημερομηνία λήξης (προαιρετικό)"
          htmlFor={dueDateId}
          hint="Μορφή YYYY-MM-DD (π.χ. 2026-03-15)."
        >
          <Input
            id={dueDateId}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            inputMode="numeric"
            placeholder="π.χ. 2026-03-15"
            autoComplete="off"
            invalid={!!error}
          />
        </Field>

        {accounts.length > 0 ? (
          <Field
            label="Λογαριασμός (προαιρετικό)"
            htmlFor={accountIdId}
            hint="Συνδέσε με λογαριασμό για μελλοντική πληρωμή."
          >
            <select
              id={accountIdId}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              style={selectStyle}
            >
              <option value="">— Κανένας —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {kind === "ordinary" && activeReserves.length > 0 ? (
          <Field
            label="Σύνδεση με δέσμευση (προαιρετικό)"
            htmlFor={reserveIdId}
            hint="Συνδέσε αυτό το έξοδο με δεσμευμένη υποχρέωση. Το ποσό πρέπει να ταιριάζει. Μετράται μία φορά στη δέσμευση, όχι διπλά."
          >
            <select
              id={reserveIdId}
              value={linkedReserveId}
              onChange={(e) => {
                setLinkedReserveId(e.target.value);
                const linked = activeReserves.find(
                  (r) => r.id === e.target.value,
                );
                if (linked) {
                  setAmountInput(
                    (linked.plannedCents / 100).toString().replace(".", ","),
                  );
                }
              }}
              style={selectStyle}
            >
              <option value="">— Κανένας —</option>
              {activeReserves.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} ({formatEurEl(r.plannedCents)})
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {error ? <Alert>{error}</Alert> : null}
      </form>
    </Sheet>
  );
}

// --- Income form sheet ---

type IncomeFormSheetProps = {
  open: boolean;
  onClose: () => void;
  editing: IncomeExpectation | null;
  monthKey: string;
  accounts: Account[];
  onSaved: () => void;
};

function IncomeFormSheet({
  open,
  onClose,
  editing,
  monthKey,
  accounts,
  onSaved,
}: IncomeFormSheetProps) {
  const [sourceName, setSourceName] = useState(editing?.sourceName ?? "");
  const [amountInput, setAmountInput] = useState(
    editing && editing.expectedCents > 0
      ? (editing.expectedCents / 100).toString().replace(".", ",")
      : "",
  );
  const [accountId, setAccountId] = useState(editing?.linkedAccountId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sourceId = useId();
  const amountId = useId();
  const accountIdId = useId();

  function reset() {
    setSourceName("");
    setAmountInput("");
    setAccountId("");
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = sourceName.trim();
    if (trimmedName.length === 0) {
      setError("Η πηγή δεν μπορεί να είναι κενή.");
      return;
    }
    if (trimmedName.length > 200) {
      setError("Η πηγή δεν μπορεί να ξεπερνάει 200 χαρακτήρες.");
      return;
    }

    const parsed = parseEurosInput(amountInput);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setPending(true);
    if (editing) {
      const result = await updateIncomeApi(editing.id, {
        sourceName: trimmedName,
        expectedCents: parsed.cents,
        linkedAccountId: accountId || null,
      });
      setPending(false);
      if (result.ok) {
        onSaved();
      } else {
        setError(result.error);
      }
    } else {
      const result = await createIncomeApi({
        monthKey,
        sourceName: trimmedName,
        expectedCents: parsed.cents,
        linkedAccountId: accountId || null,
      });
      setPending(false);
      if (result.ok) {
        onSaved();
      } else {
        setError(result.error);
      }
    }
  }

  return (
    <Sheet
      open={open}
      title={editing ? "Επεξεργασία εσόδου" : "Νέο έσοδο"}
      onClose={handleClose}
      footer={
        <>
          <Button
            type="submit"
            form="income-form"
            pending={pending}
            style={{ width: "100%" }}
          >
            {pending ? "Αποθήκευση…" : "Αποθήκευση"}
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
        id="income-form"
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
      >
        <Alert tone="info">
          Το έσοδο δείχνει αναμενόμενο, ελημμένο και εκκρεμές. Η χειροκίνητη
          ανανέωση υπολοίπου δεν σημαίνει αυτόματη είσπραξη.
        </Alert>

        <Field
          label="Πηγή"
          htmlFor={sourceId}
          hint="π.χ. «Μισθός», «Επίδομα»"
        >
          <Input
            id={sourceId}
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            maxLength={200}
            required
            autoComplete="off"
            invalid={!!error}
            autoFocus
          />
        </Field>

        <Field
          label="Ποσό (€)"
          htmlFor={amountId}
          hint="Δώσε ποσό σε ευρώ (π.χ. 1500 ή 1500,00)."
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
          />
        </Field>

        {accounts.length > 0 ? (
          <Field
            label="Λογαριασμός (προαιρετικό)"
            htmlFor={accountIdId}
            hint="Συνδέσε με λογαριασμό για μελλοντική είσπραξη."
          >
            <select
              id={accountIdId}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              style={selectStyle}
            >
              <option value="">— Κανένας —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {error ? <Alert>{error}</Alert> : null}
      </form>
    </Sheet>
  );
}

// --- Obligation detail sheet ---

function ObligationDetailSheet({
  obligation,
  accounts,
  onClose,
  onEdit,
  onCanceled,
  onReleased,
  onPay,
  onReverse,
}: {
  obligation: Obligation;
  accounts: Account[];
  onClose: () => void;
  onEdit: () => void;
  onCanceled: () => void;
  onReleased: () => void;
  onPay: () => void;
  onReverse: (entry: SettlementHistoryEntry) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<SettlementHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listSettlementHistoryApi(obligation.id).then((result) => {
      if (cancelled) return;
      setHistoryLoading(false);
      if (result.ok) {
        setHistory(result.settlements);
        setHistoryError(null);
      } else {
        setHistoryError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [obligation.id]);

  async function handleCancel() {
    setError(null);
    setPending(true);
    const result = await cancelObligationApi(obligation.id);
    setPending(false);
    if (result.ok) {
      onCanceled();
    } else {
      setError(result.error);
    }
  }

  async function handleRelease() {
    setError(null);
    setPending(true);
    const result = await releaseObligationApi(obligation.id);
    setPending(false);
    if (result.ok) {
      onReleased();
    } else {
      setError(result.error);
      setConfirmRelease(false);
    }
  }

  const canPay =
    obligation.status !== "cancelled" &&
    obligation.status !== "released" &&
    obligation.remainingCents > 0;
  const canRelease =
    obligation.status !== "cancelled" &&
    obligation.status !== "released" &&
    obligation.remainingCents > 0;

  return (
    <Sheet
      open={true}
      title={obligation.title}
      onClose={onClose}
      footer={
        <>
          {obligation.status !== "cancelled" && obligation.status !== "released" ? (
            <>
              {canPay ? (
                <Button
                  variant="primary"
                  onClick={onPay}
                  style={{ width: "100%" }}
                >
                  Πληρωμή
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={onEdit}
                style={{ width: "100%" }}
              >
                Επεξεργασία
              </Button>
              {canRelease ? (
                confirmRelease ? (
                  <>
                    <Alert tone="warning">
                      Η απελευθέρωση καταργεί την προστασία του υπόλοιπου ποσού
                      ({formatEurEl(obligation.remainingCents)}). Το
                      σχεδιασμένο ποσό και το ιστορικό πληρωμών παραμένουν.
                    </Alert>
                    <Button
                      variant="danger"
                      onClick={handleRelease}
                      pending={pending}
                      style={{ width: "100%" }}
                    >
                      {pending ? "Απελευθέρωση…" : "Ναι, απελευθέρωση"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setConfirmRelease(false)}
                      style={{ width: "100%" }}
                    >
                      Άκυρο απελευθέρωσης
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="danger"
                    onClick={() => {
                      setError(null);
                      setConfirmRelease(true);
                    }}
                    style={{ width: "100%" }}
                  >
                    Απελευθέρωση υπολοίπου
                  </Button>
                )
              ) : null}
              {!confirmRelease ? (
                <Button
                  variant="danger"
                  onClick={handleCancel}
                  pending={pending}
                  style={{ width: "100%" }}
                >
                  {pending ? "Ακύρωση…" : "Ακύρωση εγγραφής"}
                </Button>
              ) : null}
            </>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            style={{ width: "100%" }}
          >
            Κλείσιμο
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Σχεδιασμένο
            </span>
            <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--fg)" }}>
              {formatEurEl(obligation.plannedCents)}
            </span>
          </div>
          <hr style={dividerStyle} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Πληρωμένο
            </span>
            <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--fg)" }}>
              {formatEurEl(obligation.paidCents)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Υπόλοιπο
            </span>
            <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--accent)" }}>
              {formatEurEl(obligation.remainingCents)}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.85rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ color: "var(--muted)" }}>Τύπος</span>
            <span style={{ color: "var(--fg)" }}>
              {obligation.kind === "reserved" ? "Δέσμευση" : "Έξοδο"}
            </span>
          </div>
          {obligation.dueDate ? (
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ color: "var(--muted)" }}>Λήξη</span>
              <span style={{ color: "var(--fg)" }}>{obligation.dueDate}</span>
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ color: "var(--muted)" }}>Κατάσταση</span>
            <span style={{ color: "var(--fg)" }}>
              {obligation.status === "active"
                ? "Ενεργό"
                : obligation.status === "settled"
                  ? "Εξοφλημένο"
                  : obligation.status === "cancelled"
                    ? "Ακυρώθηκε"
                    : "Απελευθερώθηκε"}
            </span>
          </div>
        </div>

        <div>
          <h3
            style={{
              fontSize: "0.9rem",
              fontWeight: 700,
              margin: "0 0 0.4rem 0",
              color: "var(--fg)",
            }}
          >
            Ιστορικό πληρωμών
          </h3>
          {historyLoading ? (
            <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
              Φόρτωση…
            </p>
          ) : historyError ? (
            <Alert>{historyError}</Alert>
          ) : (
            <SettlementHistory
              history={history}
              isIncome={false}
              onReverse={onReverse}
            />
          )}
        </div>

        <Alert tone="info">
          Το σχεδιασμένο ποσό δεν μηδενίζεται με μερικές πληρωμές. Οι
          πληρωμές καταγράφονται με ρητή επιλογή ενημέρωσης υπολοίπου.
        </Alert>

        {error ? <Alert>{error}</Alert> : null}
      </div>
    </Sheet>
  );
}

// --- Income detail sheet ---

function IncomeDetailSheet({
  income,
  accounts,
  onClose,
  onEdit,
  onCanceled,
  onReceive,
  onReverse,
}: {
  income: IncomeExpectation;
  accounts: Account[];
  onClose: () => void;
  onEdit: () => void;
  onCanceled: () => void;
  onReceive: () => void;
  onReverse: (entry: ReceiptHistoryEntry) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<ReceiptHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listReceiptHistoryApi(income.id).then((result) => {
      if (cancelled) return;
      setHistoryLoading(false);
      if (result.ok) {
        setHistory(result.receipts);
        setHistoryError(null);
      } else {
        setHistoryError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [income.id]);

  async function handleCancel() {
    setError(null);
    setPending(true);
    const result = await cancelIncomeApi(income.id);
    setPending(false);
    if (result.ok) {
      onCanceled();
    } else {
      setError(result.error);
    }
  }

  const canReceive =
    income.status !== "cancelled" && income.pendingCents > 0;

  return (
    <Sheet
      open={true}
      title={income.sourceName}
      onClose={onClose}
      footer={
        <>
          {income.status !== "cancelled" ? (
            <>
              {canReceive ? (
                <Button
                  variant="primary"
                  onClick={onReceive}
                  style={{ width: "100%" }}
                >
                  Είσπραξη
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={onEdit}
                style={{ width: "100%" }}
              >
                Επεξεργασία
              </Button>
              <Button
                variant="danger"
                onClick={handleCancel}
                pending={pending}
                style={{ width: "100%" }}
              >
                {pending ? "Ακύρωση…" : "Ακύρωση εγγραφής"}
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            style={{ width: "100%" }}
          >
            Κλείσιμο
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Αναμενόμενο
            </span>
            <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--fg)" }}>
              {formatEurEl(income.expectedCents)}
            </span>
          </div>
          <hr style={dividerStyle} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Ελημμένο
            </span>
            <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--fg)" }}>
              {formatEurEl(income.receivedCents)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Εκκρεμές
            </span>
            <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--accent)" }}>
              {formatEurEl(income.pendingCents)}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.85rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ color: "var(--muted)" }}>Μήνας</span>
            <span style={{ color: "var(--fg)" }}>{income.monthKey}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ color: "var(--muted)" }}>Κατάσταση</span>
            <span style={{ color: "var(--fg)" }}>
              {income.status === "active"
                ? "Ενεργό"
                : income.status === "received"
                  ? "Ελημμένο"
                  : "Ακυρώθηκε"}
            </span>
          </div>
        </div>

        <div>
          <h3
            style={{
              fontSize: "0.9rem",
              fontWeight: 700,
              margin: "0 0 0.4rem 0",
              color: "var(--fg)",
            }}
          >
            Ιστορικό εισπράξεων
          </h3>
          {historyLoading ? (
            <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
              Φόρτωση…
            </p>
          ) : historyError ? (
            <Alert>{historyError}</Alert>
          ) : (
            <SettlementHistory
              history={history}
              isIncome={true}
              onReverse={onReverse}
            />
          )}
        </div>

        <Alert tone="info">
          Το έσοδο δείχνει αναμενόμενο, ελημμένο και εκκρεμές. Η χειροκίνητη
          ανανέωση υπολοίπου δεν σημαίνει αυτόματη είσπραξη.
        </Alert>

        {error ? <Alert>{error}</Alert> : null}
      </div>
    </Sheet>
  );
}