"use client";

import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import type { MonthlyPlan } from "@/lib/months/types";
import type { RecurringTemplate, TemplateKind } from "@/lib/templates/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Alert } from "@/components/ui/Alert";
import { cardStyle, stickyControls, dividerStyle } from "@/components/ui/styles";
import { formatEurEl } from "@/lib/ui/format";
import {
  newIdempotencyKey,
  parseEurosInput,
  offlineSubmitGuard,
} from "@/lib/ui/form-helpers";
import {
  createPlanApi,
  updateTargetApi,
  createTemplateApi,
  updateTemplateApi,
  generateMonthApi,
} from "@/lib/ui/plan-api";

type PlanPageClientProps = {
  currentMonth: string;
  currentPlan: MonthlyPlan | null;
  plans: MonthlyPlan[];
  templates: RecurringTemplate[];
};

const KIND_LABELS_EL: Record<TemplateKind, string> = {
  ordinary: "Έξοδο",
  reserved: "Δέσμευση",
  income: "Έσοδο",
};

export function PlanPageClient({
  currentMonth,
  currentPlan,
  plans,
  templates,
}: PlanPageClientProps) {
  const router = useRouter();
  const [showTarget, setShowTarget] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringTemplate | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);

  function refresh() {
    router.refresh();
  }

  const sortedPlans = [...plans].sort((a, b) => b.monthKey.localeCompare(a.monthKey));

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
          Μηνιαίο πλάνο
        </h1>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
          {currentMonth}
        </p>
      </div>

      {/* Current month savings target */}
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Στόχος αποταμίευσης
            </span>
            <span
              style={{
                fontSize: "1.3rem",
                fontWeight: 800,
                color: "var(--fg)",
              }}
            >
              {currentPlan ? formatEurEl(currentPlan.savingsTargetCents) : "—"}
            </span>
          </div>
          <Button
            variant="secondary"
            onClick={() => setShowTarget(true)}
            style={{ flexShrink: 0 }}
          >
            {currentPlan ? "Αλλαγή" : "Ορισμός"}
          </Button>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: "0.8rem",
            color: "var(--muted)",
            lineHeight: 1.4,
          }}
        >
          Προστατευόμενο σύνολο τέλους μήνα — όχι μηνιαία κατάθεση ή κίνηση
          λογαριασμού.
        </p>
      </div>

      {/* Templates section */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "0.5rem",
          }}
        >
          <h2
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              margin: 0,
            }}
          >
            Επαναλαμβανόμενα
          </h2>
          <Button
            variant="secondary"
            onClick={() => {
              setEditingTemplate(null);
              setShowTemplate(true);
            }}
            style={{ flexShrink: 0 }}
          >
            + Νέο
          </Button>
        </div>

        {templates.length === 0 ? (
          <div style={cardStyle}>
            <p
              style={{
                margin: 0,
                fontSize: "0.9rem",
                color: "var(--muted)",
                lineHeight: 1.5,
              }}
            >
              Δεν υπάρχουν πρότυπα ακόμη. Δημιούργησε επαναλαμβανόμενα έξοδα,
              έσοδα ή δεσμεύσεις για αυτόματη δημιουργία κάθε μήνα.
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
            {templates.map((tpl) => (
              <li key={tpl.id}>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTemplate(tpl);
                    setShowTemplate(true);
                  }}
                  style={{
                    ...cardStyle,
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.3rem",
                    textAlign: "left",
                    cursor: "pointer",
                    width: "100%",
                    border: "1px solid var(--border)",
                    opacity: tpl.active ? 1 : 0.55,
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
                      {tpl.name}
                    </span>
                    <span
                      style={{
                        fontSize: "1rem",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        color: "var(--fg)",
                      }}
                    >
                      {formatEurEl(tpl.defaultAmountCents)}
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
                    <span>{KIND_LABELS_EL[tpl.kind]}</span>
                    {tpl.dueDayOfMonth !== null ? (
                      <span>· Λήξη: {tpl.dueDayOfMonth}</span>
                    ) : null}
                    {!tpl.active ? <span>· Ανενεργό</span> : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Generate button */}
      <div style={cardStyle}>
        <p
          style={{
            margin: 0,
            fontSize: "0.85rem",
            color: "var(--muted)",
            lineHeight: 1.5,
            marginBottom: "0.6rem",
          }}
        >
          Δημιούργησε τις εγγραφές του τρέχοντος μήνα από τα ενεργά πρότυπα.
          Ασφαλές για επανάληψη — δεν δημιουργεί διπλότυπες εγγραφές.
        </p>
        <Button
          variant="primary"
          onClick={() => setShowGenerate(true)}
          style={{ width: "100%" }}
        >
          Δημιουργία μηνιαίων εγγραφών
        </Button>
      </div>

      {/* History list */}
      {sortedPlans.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <h2
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              margin: 0,
            }}
          >
            Ιστορικό μηνών
          </h2>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem",
            }}
          >
            {sortedPlans.map((plan) => (
              <li key={plan.id}>
                <div
                  style={{
                    ...cardStyle,
                    padding: "0.7rem 0.8rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      color: "var(--fg)",
                    }}
                  >
                    {plan.monthKey}
                  </span>
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
                        fontSize: "0.88rem",
                        color: "var(--muted)",
                      }}
                    >
                      {formatEurEl(plan.savingsTargetCents)}
                    </span>
                    {plan.status === "closed" ? (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.1rem 0.5rem",
                          borderRadius: "0.4rem",
                          backgroundColor: "var(--accent-weak)",
                          color: "var(--accent)",
                          fontWeight: 600,
                        }}
                      >
                        Κλειστός
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={stickyControls}>
        <Button
          variant="primary"
          onClick={() => setShowTarget(true)}
          style={{ width: "100%" }}
        >
          {currentPlan ? "Αλλαγή στόχου αποταμίευσης" : "Ορισμός στόχου αποταμίευσης"}
        </Button>
      </div>

      {/* Target sheet */}
      <TargetSheet
        open={showTarget}
        onClose={() => setShowTarget(false)}
        currentPlan={currentPlan}
        currentMonth={currentMonth}
        onSaved={() => {
          refresh();
          setShowTarget(false);
        }}
      />

      {/* Template sheet */}
      <TemplateSheet
        open={showTemplate}
        onClose={() => {
          setShowTemplate(false);
          setEditingTemplate(null);
        }}
        editing={editingTemplate}
        onSaved={() => {
          refresh();
          setShowTemplate(false);
          setEditingTemplate(null);
        }}
      />

      {/* Generate sheet */}
      <GenerateSheet
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        currentMonth={currentMonth}
        onGenerated={() => {
          refresh();
          setShowGenerate(false);
        }}
      />
    </>
  );
}

// --- Target Sheet ---

type TargetSheetProps = {
  open: boolean;
  onClose: () => void;
  currentPlan: MonthlyPlan | null;
  currentMonth: string;
  onSaved: () => void;
};

function TargetSheet({
  open,
  onClose,
  currentPlan,
  currentMonth,
  onSaved,
}: TargetSheetProps) {
  const initialTarget = currentPlan?.savingsTargetCents ?? 0;
  const [targetInput, setTargetInput] = useState(
    initialTarget > 0 ? (initialTarget / 100).toString().replace(".", ",") : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const targetId = useId();

  function handleClose() {
    setError(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const onlineCheck = offlineSubmitGuard();
    if (!onlineCheck.ok) {
      setError(onlineCheck.error);
      return;
    }

    const parsed = parseEurosInput(targetInput);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setPending(true);
    if (currentPlan) {
      const result = await updateTargetApi(currentPlan.id, parsed.cents);
      setPending(false);
      if (result.ok) {
        onSaved();
      } else {
        setError(result.error);
      }
    } else {
      const result = await createPlanApi({
        monthKey: currentMonth,
        savingsTargetCents: parsed.cents,
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
      title={currentPlan ? "Αλλαγή στόχου αποταμίευσης" : "Ορισμός στόχου αποταμίευσης"}
      onClose={handleClose}
      footer={
        <>
          <Button
            type="submit"
            form="target-form"
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
        id="target-form"
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
      >
        <Alert tone="info">
          Ο στόχος αποταμίευσης είναι το προστατευόμενο σύνολο τέλους μήνα. Δεν
          είναι μηνιαία κατάθεση ούτε κίνηση λογαριασμού. Ποσό 0 είναι έγκυρο.
        </Alert>
        <Field
          label="Στόχος αποταμίευσης (€)"
          htmlFor={targetId}
          hint="Δώσε ποσό σε ευρώ (π.χ. 5000 ή 5000,00)."
        >
          <Input
            id={targetId}
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            inputMode="decimal"
            placeholder="π.χ. 5000,00"
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

// --- Template Sheet ---

type TemplateSheetProps = {
  open: boolean;
  onClose: () => void;
  editing: RecurringTemplate | null;
  onSaved: () => void;
};

function TemplateSheet({
  open,
  onClose,
  editing,
  onSaved,
}: TemplateSheetProps) {
  const [name, setName] = useState(editing?.name ?? "");
  const [kind, setKind] = useState<TemplateKind>(editing?.kind ?? "ordinary");
  const [amountInput, setAmountInput] = useState(
    editing && editing.defaultAmountCents > 0
      ? (editing.defaultAmountCents / 100).toString().replace(".", ",")
      : "",
  );
  const [dueDay, setDueDay] = useState(
    editing?.dueDayOfMonth !== null && editing?.dueDayOfMonth !== undefined
      ? editing.dueDayOfMonth.toString()
      : "",
  );
  const [active, setActive] = useState(editing?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nameId = useId();
  const kindId = useId();
  const amountId = useId();
  const dueDayId = useId();

  function reset() {
    setName("");
    setKind("ordinary");
    setAmountInput("");
    setDueDay("");
    setActive(true);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const onlineCheck = offlineSubmitGuard();
    if (!onlineCheck.ok) {
      setError(onlineCheck.error);
      return;
    }

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError("Το όνομα δεν μπορεί να είναι κενό.");
      return;
    }
    if (trimmedName.length > 100) {
      setError("Το όνομα δεν μπορεί να ξεπερνάει 100 χαρακτήρες.");
      return;
    }

    const parsed = parseEurosInput(amountInput);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    let dueDayNum: number | null = null;
    if (dueDay.trim() !== "") {
      const n = Number.parseInt(dueDay.trim(), 10);
      if (Number.isNaN(n) || n < 1 || n > 31) {
        setError("Η ημέρα λήξης πρέπει να είναι μεταξύ 1 και 31.");
        return;
      }
      dueDayNum = n;
    }

    setPending(true);
    if (editing) {
      const result = await updateTemplateApi(editing.id, {
        name: trimmedName,
        defaultAmountCents: parsed.cents,
        dueDayOfMonth: dueDayNum,
        active,
      });
      setPending(false);
      if (result.ok) {
        onSaved();
      } else {
        setError(result.error);
      }
    } else {
      const result = await createTemplateApi({
        name: trimmedName,
        kind,
        defaultAmountCents: parsed.cents,
        dueDayOfMonth: dueDayNum,
        active,
      });
      setPending(false);
      if (result.ok) {
        onSaved();
      } else {
        setError(result.error);
      }
    }
  }

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

  return (
    <Sheet
      open={open}
      title={editing ? "Επεξεργασία πρότυπου" : "Νέο πρότυπο"}
      onClose={handleClose}
      footer={
        <>
          <Button
            type="submit"
            form="template-form"
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
        id="template-form"
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
      >
        <Field
          label="Όνομα"
          htmlFor={nameId}
          hint="π.χ. «Ενοίκιο», «Μισθός», «Φόρος»"
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

        {editing ? null : (
          <Field label="Τύπος" htmlFor={kindId}>
            <select
              id={kindId}
              value={kind}
              onChange={(e) => setKind(e.target.value as TemplateKind)}
              style={selectStyle}
              required
            >
              <option value="ordinary">Έξοδο</option>
              <option value="reserved">Δέσμευση</option>
              <option value="income">Έσοδο</option>
            </select>
          </Field>
        )}

        <Field
          label="Ποσό (€)"
          htmlFor={amountId}
          hint="Δώσε ποσό σε ευρώ (π.χ. 800 ή 800,00)."
        >
          <Input
            id={amountId}
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            inputMode="decimal"
            placeholder="π.χ. 800,00"
            autoComplete="off"
            required
            invalid={!!error}
          />
        </Field>

        <Field
          label="Ημέρα λήξης (προαιρετικό)"
          htmlFor={dueDayId}
          hint="Ημέρα του μήνα (1-31). Άφησε κενό αν δεν έχει συγκεκριμένη ημέρα."
        >
          <Input
            id={dueDayId}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            inputMode="numeric"
            placeholder="π.χ. 15"
            autoComplete="off"
            maxLength={2}
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
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            style={{ width: "1.2rem", height: "1.2rem" }}
          />
          Ενεργό
        </label>

        {editing ? (
          <Alert tone="info">
            Η επεξεργασία επηρεάζει μόνο τις μελλοντικές δημιουργίες μηνών.
            Οι υπάρχουσες εγγραφές διατηρούν το αρχικό τους ποσό.
          </Alert>
        ) : null}

        {error ? <Alert>{error}</Alert> : null}
      </form>
    </Sheet>
  );
}

// --- Generate Sheet ---

type GenerateSheetProps = {
  open: boolean;
  onClose: () => void;
  currentMonth: string;
  onGenerated: () => void;
};

function GenerateSheet({
  open,
  onClose,
  currentMonth,
  onGenerated,
}: GenerateSheetProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    generatedObligations: number;
    generatedIncome: number;
    skippedObligations: number;
    skippedIncome: number;
  } | null>(null);

  function handleClose() {
    setError(null);
    setResult(null);
    onClose();
  }

  async function handleGenerate() {
    setError(null);
    setPending(true);
    const res = await generateMonthApi(currentMonth);
    setPending(false);
    if (res.ok) {
      setResult({
        generatedObligations: res.result.generatedObligations,
        generatedIncome: res.result.generatedIncome,
        skippedObligations: res.result.skippedObligations,
        skippedIncome: res.result.skippedIncome,
      });
    } else {
      setError(res.error);
    }
  }

  function handleConfirm() {
    onGenerated();
    setResult(null);
  }

  return (
    <Sheet
      open={open}
      title="Δημιουργία μηνιαίων εγγραφών"
      onClose={handleClose}
      footer={
        result ? (
          <>
            <Button
              variant="primary"
              onClick={handleConfirm}
              style={{ width: "100%" }}
            >
              Τέλος
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              pending={pending}
              onClick={handleGenerate}
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
        )
      }
    >
      {result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <Alert tone="info">
            Δημιουργία ολοκληρώθηκε για {currentMonth}.
          </Alert>
          <div style={cardStyle}>
            <p
              style={{
                margin: 0,
                fontSize: "0.9rem",
                color: "var(--fg)",
                fontWeight: 600,
              }}
            >
              Νέες εγγραφές: {result.generatedObligations + result.generatedIncome}
            </p>
            <p
              style={{
                margin: "0.2rem 0 0",
                fontSize: "0.82rem",
                color: "var(--muted)",
              }}
            >
              Existing που προσπεράστηκαν: {result.skippedObligations + result.skippedIncome}
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <Alert tone="info">
            Δημιουργεί εγγραφές για τον μήνα {currentMonth} από τα ενεργά
            πρότυπα. Η λειτουργία είναι ασφαλής για επανάληψη — δεν δημιουργεί
            διπλότυπες εγγραφές.
          </Alert>
          {error ? <Alert>{error}</Alert> : null}
        </div>
      )}
    </Sheet>
  );
}