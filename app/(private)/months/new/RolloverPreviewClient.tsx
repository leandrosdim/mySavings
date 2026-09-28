"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { RolloverPreview } from "@/lib/rollover/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Alert } from "@/components/ui/Alert";
import { cardStyle, stickyControls, dividerStyle } from "@/components/ui/styles";
import { formatEurEl } from "@/lib/ui/format";
import { newIdempotencyKey, parseEurosInput } from "@/lib/ui/form-helpers";
import {
  fetchRolloverPreview,
  applyRolloverApi,
} from "@/lib/ui/rollover-api";

type RolloverPreviewClientProps = {
  currentMonth: string;
};

export function RolloverPreviewClient({
  currentMonth,
}: RolloverPreviewClientProps) {
  const router = useRouter();
  const [sourceMonth, setSourceMonth] = useState(currentMonth);
  const [preview, setPreview] = useState<RolloverPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const sourceMonthId = useId();

  async function loadPreview(month: string) {
    setLoading(true);
    setLoadError(null);
    setPreview(null);
    const res = await fetchRolloverPreview(month);
    setLoading(false);
    if (res.ok) {
      setPreview(res.preview);
    } else {
      setLoadError(res.error);
    }
  }

  // Initial load on mount and when the server-provided current month changes.
  // The setState calls live in the async callback (after the first await), so
  // this effect does not synchronously call setState in its body.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchRolloverPreview(currentMonth);
      if (cancelled) return;
      if (res.ok) {
        setPreview(res.preview);
      } else {
        setLoadError(res.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentMonth]);

  function handleRefresh() {
    void loadPreview(sourceMonth);
  }

  function handleSourceChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSourceMonth(e.target.value);
  }

  function handleLoadClick() {
    void loadPreview(sourceMonth);
  }

  function refresh() {
    router.refresh();
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
          Επόμενος μήνας
        </h1>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
          Προεπισκόπηση και καθοδηγούμενη μετάβαση στον επόμενο μήνα.
        </p>
      </div>

      <div style={cardStyle}>
        <Field
          label="Μήνας πηγής (YYYY-MM)"
          htmlFor={sourceMonthId}
          hint="Ο ανοιχτός μήνας από τον οποίο μεταβαινόμαστε."
        >
          <Input
            id={sourceMonthId}
            value={sourceMonth}
            onChange={handleSourceChange}
            inputMode="numeric"
            placeholder="π.χ. 2026-09"
            autoComplete="off"
          />
        </Field>
        <Button
          variant="secondary"
          onClick={handleLoadClick}
          pending={loading}
          style={{ width: "100%" }}
        >
          {loading ? "Φόρτωση…" : "Φόρτωση προεπισκόπησης"}
        </Button>
      </div>

      {loadError ? <Alert tone="warning">{loadError}</Alert> : null}

      {preview ? (
        <PreviewBody
          preview={preview}
          onRefresh={handleRefresh}
          onApply={() => setApplyOpen(true)}
        />
      ) : !loading && !loadError ? (
        <div style={cardStyle}>
          <p
            style={{
              margin: 0,
              fontSize: "0.9rem",
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            Δεν υπάρχουν δεδομένα προεπισκόπησης. Φόρτωσε έναν μήνα πηγής.
          </p>
        </div>
      ) : null}

      <ApplySheet
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        preview={preview}
        onApplied={() => {
          setApplyOpen(false);
          refresh();
        }}
      />
    </>
  );
}

// --- Preview body ---

type PreviewBodyProps = {
  preview: RolloverPreview;
  onRefresh: () => void;
  onApply: () => void;
};

function PreviewBody({ preview, onRefresh, onApply }: PreviewBodyProps) {
  const totalCarry = preview.carryoverObligations.reduce(
    (sum, o) => sum + o.remainingCents,
    0,
  );
  const totalReserved = preview.reservedCarryover.reduce(
    (sum, r) => sum + r.remainingCents,
    0,
  );
  const totalRecurring = preview.recurringInstances.reduce(
    (sum, r) => sum + r.defaultAmountCents,
    0,
  );
  const totalUnresolved = preview.unresolvedIncome.reduce(
    (sum, i) => sum + i.pendingCents,
    0,
  );

  return (
    <>
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
              Μετάβαση
            </span>
            <span
              style={{
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "var(--fg)",
              }}
            >
              {preview.sourceMonthKey} → {preview.targetMonthKey}
            </span>
          </div>
          {preview.targetPlanExists ? (
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
              Ο επόμενος μήνας υπάρχει ήδη
            </span>
          ) : null}
        </div>
        <hr style={dividerStyle} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.3rem",
          }}
        >
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            Προτεινόμενος στόχος αποταμίευσης
          </span>
          <span
            style={{
              fontSize: "1.3rem",
              fontWeight: 800,
              color: "var(--fg)",
            }}
          >
            {preview.sourceHasTarget
              ? formatEurEl(preview.proposedSavingsTargetCents)
              : "—"}
          </span>
          <p
            style={{
              margin: 0,
              fontSize: "0.78rem",
              color: "var(--muted)",
              lineHeight: 1.4,
            }}
          >
            Αντιγράφεται από τον προηγούμενο μήνα· επανεξετάζεται κατά την
            εφαρμογή.
          </p>
        </div>
      </div>

      {/* Recurring instances */}
      <Section
        title="Επαναλαμβανόμενα (νέες εγγραφές)"
        total={totalRecurring}
        empty="Δεν υπάρχουν ενεργά πρότυπα."
      >
        {preview.recurringInstances.map((r) => (
          <PreviewRow
            key={r.templateId}
            title={r.name}
            subtitle={`${kindLabel(r.kind)}${r.dueDayOfMonth ? ` · Λήξη ${r.dueDayOfMonth}` : ""}`}
            amount={r.defaultAmountCents}
            badge={r.alreadyGenerated ? "Υπάρχει ήδη" : "Νέο"}
            badgeTone={r.alreadyGenerated ? "muted" : "accent"}
          />
        ))}
      </Section>

      {/* Carryover obligations */}
      <Section
        title="Μηνυπαίτητες εγγραφές (μεταφορά ανα ID)"
        total={totalCarry}
        empty="Δεν υπάρχουν μη πληρωμένες εγγραφές προς μεταφορά."
      >
        {preview.carryoverObligations.map((o) => (
          <PreviewRow
            key={o.id}
            title={o.title}
            subtitle={`Από ${o.originalMonthKey}${o.fromTemplate ? " · πρότυπο" : " · ελεύθερο"}`}
            amount={o.remainingCents}
            badge={`Πληρώθηκαν ${formatEurEl(o.paidCents)}`}
            badgeTone="muted"
          />
        ))}
      </Section>

      {/* Reserved carryover */}
      <Section
        title="Δεσμεύσεις (μεταφέρονται, όχι διπλότυπες)"
        total={totalReserved}
        empty="Δεν υπάρχουν δεσμεύσεις."
      >
        {preview.reservedCarryover.map((r) => (
          <PreviewRow
            key={r.id}
            title={r.title}
            subtitle={`Από ${r.originalMonthKey}`}
            amount={r.remainingCents}
            badge={`Πληρώθηκαν ${formatEurEl(r.paidCents)}`}
            badgeTone="muted"
          />
        ))}
      </Section>

      {/* Unresolved income */}
      <Section
        title="Εκκρεμή έσοδα (απόφαση)"
        total={totalUnresolved}
        empty="Δεν υπάρχουν μη δεδεγμένα έσοδα."
      >
        <Alert tone="info">
          Τα μη δεδεγμένα έσοδα δεν μεταφέρονται αυτόματα ως νέο αξιόπιστο
          έσοδο. Επίλεξε ποια θα μεταφερθούν κατά την εφαρμογή.
        </Alert>
        {preview.unresolvedIncome.map((i) => (
          <PreviewRow
            key={i.id}
            title={i.sourceName}
            subtitle={`Από ${i.monthKey}`}
            amount={i.pendingCents}
            badge={`Ελήφθη ${formatEurEl(i.receivedCents)}`}
            badgeTone="muted"
          />
        ))}
      </Section>

      <div style={stickyControls}>
        <Button
          variant="primary"
          onClick={onApply}
          style={{ width: "100%" }}
        >
          Εφαρμογή μετάβασης
        </Button>
        <Button
          variant="secondary"
          onClick={onRefresh}
          style={{ width: "100%" }}
        >
          Ανανέωση προεπισκόπησης
        </Button>
      </div>
    </>
  );
}

// --- Apply sheet ---

type ApplySheetProps = {
  open: boolean;
  onClose: () => void;
  preview: RolloverPreview | null;
  onApplied: () => void;
};

function ApplySheet({ open, onClose, preview, onApplied }: ApplySheetProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    targetMonthKey: string;
    targetPlanCreated: boolean;
    generatedObligations: number;
    generatedIncome: number;
    carriedObligations: number;
    releasedObligations: number;
    carriedIncome: number;
    replay: boolean;
  } | null>(null);

  if (!preview) return null;

  return (
    <Sheet
      open={open}
      title="Εφαρμογή μετάβασης"
      onClose={() => {
        setError(null);
        setResult(null);
        onClose();
      }}
      footer={
        result ? (
          <Button
            variant="primary"
            onClick={() => {
              onApplied();
              setResult(null);
            }}
            style={{ width: "100%" }}
          >
            Τέλος
          </Button>
        ) : (
          <>
            <Button
              type="submit"
              form="rollover-apply-form"
              pending={pending}
              style={{ width: "100%" }}
            >
              {pending ? "Εφαρμογή…" : "Εφαρμογή"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setError(null);
                setResult(null);
                onClose();
              }}
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
            {result.replay
              ? `Η μετάβαση είχε ήδη εφαρμοστεί (επανάληψη). Μήνας: ${result.targetMonthKey}.`
              : `Η μετάβαση ολοκληρώθηκε για ${result.targetMonthKey}.`}
          </Alert>
          <div style={cardStyle}>
            <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600, color: "var(--fg)" }}>
              Νέες εγγραφές: {result.generatedObligations + result.generatedIncome}
            </p>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
              Μεταφέρθηκαν: {result.carriedObligations} εγγραφές
            </p>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
              Απελευθερώθηκαν: {result.releasedObligations}
            </p>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
              Έσοδα που μεταφέρθηκαν: {result.carriedIncome}
            </p>
          </div>
        </div>
      ) : (
        <ApplyForm
          preview={preview}
          pending={pending}
          error={error}
          onPending={setPending}
          onError={setError}
          onResult={(r) => setResult(r)}
        />
      )}
    </Sheet>
  );
}

// --- Apply form (separated so its state resets on each sheet open via key) ---

type ApplyFormProps = {
  preview: RolloverPreview;
  pending: boolean;
  error: string | null;
  onPending: (v: boolean) => void;
  onError: (v: string | null) => void;
  onResult: (r: {
    targetMonthKey: string;
    targetPlanCreated: boolean;
    generatedObligations: number;
    generatedIncome: number;
    carriedObligations: number;
    releasedObligations: number;
    carriedIncome: number;
    replay: boolean;
  }) => void;
};

function ApplyForm({
  preview,
  pending,
  error,
  onPending,
  onError,
  onResult,
}: ApplyFormProps) {
  const [targetInput, setTargetInput] = useState(() => {
    const t = preview.proposedSavingsTargetCents;
    return t > 0 ? (t / 100).toString().replace(".", ",") : "0";
  });
  const [releaseIds, setReleaseIds] = useState<Set<string>>(new Set());
  const [carryIncomeIds, setCarryIncomeIds] = useState<Set<string>>(
    () => new Set(preview.unresolvedIncome.map((i) => i.id)),
  );
  const targetId = useId();

  function toggleRelease(id: string) {
    setReleaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCarryIncome(id: string) {
    setCarryIncomeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onError(null);

    const parsed = parseEurosInput(targetInput);
    if (!parsed.ok) {
      onError(parsed.error);
      return;
    }

    onPending(true);
    const res = await applyRolloverApi({
      sourceMonthKey: preview.sourceMonthKey,
      savingsTargetCents: parsed.cents,
      previewDigest: preview.previewDigest,
      releaseChoices: Array.from(releaseIds).map((id) => ({
        obligationId: id,
      })),
      carryIncomeIds: Array.from(carryIncomeIds),
      idempotencyKey: newIdempotencyKey("rollover"),
    });
    onPending(false);

    if (res.ok) {
      onResult({
        targetMonthKey: res.result.targetMonthKey,
        targetPlanCreated: res.result.targetPlanCreated,
        generatedObligations: res.result.generatedObligations,
        generatedIncome: res.result.generatedIncome,
        carriedObligations: res.result.carriedObligations,
        releasedObligations: res.result.releasedObligations,
        carriedIncome: res.result.carriedIncome,
        replay: res.result.replay,
      });
    } else {
      onError(res.error);
    }
  }

  return (
    <form
      id="rollover-apply-form"
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
    >
      <Alert tone="info">
        Η εφαρμογή είναι ατομική και ασφαλής για επανάληψη. Οι λογαριασμοί
        δεν αντιγράφονται· οι μη πληρωμένες εγγραφές μεταφέρονται με το ίδιο
        ID. Αν η πηγή άλλαξε από την προεπισκόπηση, θα ζητηθεί νέα
        ανασκόπηση.
      </Alert>

      <Field
        label="Στόχος αποταμίευσης επόμενου μήνα (€)"
        htmlFor={targetId}
        hint="Προεπιλέγεται από τον προηγούμενο μήνα."
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

      {preview.carryoverObligations.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--fg)" }}>
            Μηνυπαίτητες εγγραφές — απελευθέρωση αντί μεταφορά
          </span>
          {preview.carryoverObligations.map((o) => (
            <ReleaseToggle
              key={o.id}
              id={o.id}
              title={o.title}
              subtitle={`Υπόλοιπο ${formatEurEl(o.remainingCents)}`}
              checked={releaseIds.has(o.id)}
              onChange={() => toggleRelease(o.id)}
            />
          ))}
        </div>
      ) : null}

      {preview.unresolvedIncome.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--fg)" }}>
            Εκκρεμή έσοδα — μεταφορά ως νέο έσοδο
          </span>
          {preview.unresolvedIncome.map((i) => (
            <ReleaseToggle
              key={i.id}
              id={i.id}
              title={i.sourceName}
              subtitle={`Εκκρεμές ${formatEurEl(i.pendingCents)}`}
              checked={carryIncomeIds.has(i.id)}
              onChange={() => toggleCarryIncome(i.id)}
            />
          ))}
        </div>
      ) : null}

      {error ? <Alert>{error}</Alert> : null}
    </form>
  );
}

// --- Small UI helpers components ---

function Section({
  title,
  total,
  empty,
  children,
}: {
  title: string;
  total: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "0.5rem",
        }}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>
          {title}
        </h2>
        <span style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
          {formatEurEl(total)}
        </span>
      </div>
      {total === 0 && Array.isArray(children) && children.length === 0 ? (
        <div style={cardStyle}>
          <p
            style={{
              margin: 0,
              fontSize: "0.85rem",
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            {empty}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function PreviewRow({
  title,
  subtitle,
  amount,
  badge,
  badgeTone,
}: {
  title: string;
  subtitle: string;
  amount: number;
  badge?: string;
  badgeTone?: "muted" | "accent";
}) {
  return (
    <div
      style={{
        ...cardStyle,
        padding: "0.7rem 0.8rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
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
            fontSize: "0.95rem",
            fontWeight: 600,
            color: "var(--fg)",
            wordBreak: "break-word",
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: "0.95rem",
            fontWeight: 700,
            whiteSpace: "nowrap",
            color: "var(--fg)",
          }}
        >
          {formatEurEl(amount)}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          flexWrap: "wrap",
          alignItems: "center",
          fontSize: "0.78rem",
          color: "var(--muted)",
        }}
      >
        <span>{subtitle}</span>
        {badge ? (
          <span
            style={{
              padding: "0.05rem 0.45rem",
              borderRadius: "0.35rem",
              backgroundColor:
                badgeTone === "accent" ? "var(--accent-weak)" : "var(--bg)",
              color: badgeTone === "accent" ? "var(--accent)" : "var(--muted)",
              fontWeight: 600,
            }}
          >
            {badge}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ReleaseToggle({
  id,
  title,
  subtitle,
  checked,
  onChange,
}: {
  id: string;
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        fontSize: "0.9rem",
        color: "var(--fg)",
        cursor: "pointer",
        minHeight: "2.75rem",
        padding: "0.3rem 0",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ width: "1.2rem", height: "1.2rem", flexShrink: 0 }}
        aria-label={`${title} ${subtitle}`}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
          {subtitle}
        </span>
      </span>
    </label>
  );
}

function kindLabel(kind: "ordinary" | "reserved" | "income"): string {
  if (kind === "ordinary") return "Έξοδο";
  if (kind === "reserved") return "Δέσμευση";
  return "Έσοδο";
}