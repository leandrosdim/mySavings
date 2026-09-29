"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { DashboardOverview } from "@/lib/dashboard";
import type { MonthlyPlan } from "@/lib/months/types";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { cardStyle, dividerStyle } from "@/components/ui/styles";
import { formatEurEl, freshnessLabel } from "@/lib/ui/format";

type OverviewClientProps = {
  overview: DashboardOverview;
  plans: MonthlyPlan[];
  currentMonth: string;
};

type Drilldown = "balances" | "income" | "expenses" | "reserves" | "transfers";

const DRILLDOWN_LABELS_EL: Record<Drilldown, string> = {
  balances: "Λογαριασμοί (B)",
  income: "Έσοδα (I)",
  expenses: "Έξοδα (E)",
  reserves: "Δεσμεύσεις (R)",
  transfers: "Εσωτερικές μεταφορές",
};

export function OverviewClient({
  overview,
  plans,
  currentMonth,
}: OverviewClientProps) {
  const router = useRouter();
  const [open, setOpen] = useState<Drilldown | null>(null);

  const f = overview.forecast;

  function refresh() {
    router.refresh();
  }

  // --- Honest empty states first ---
  if (!overview.anyAccountTracked) {
    return (
      <>
        <Header
          monthKey={overview.monthKey}
          plans={plans}
          currentMonth={currentMonth}
        />
        <div style={cardStyle}>
          <p style={emptyParagraphStyle}>
            Δεν υπάρχουν λογαριασμοί ακόμη. Η επισκόπηση χρειάζεται τουλάχιστον
            έναν λογαριασμό με εισαγμένο υπόλοιπο για να δείξει ένα έγκυρο
            πρόβλεψη τέλους μήνα.
          </p>
        </div>
        <Link href="/accounts" style={primaryLinkStyle}>
          Πρόσθεσε τον πρώτο λογαριασμό
        </Link>
      </>
    );
  }

  if (!overview.hasPlan) {
    return (
      <>
        <Header
          monthKey={overview.monthKey}
          plans={plans}
          currentMonth={currentMonth}
        />
        {overview.hasUnenteredBalance ? <UnenteredBalanceAlert /> : null}
        <div style={cardStyle}>
          <p style={emptyParagraphStyle}>
            Δεν υπάρχει πλάνο για {overview.monthKey}. Ορίστε έναν στόχο
            αποταμίευσης για αυτόν τον μήνα για να εμφανιστεί η προστατευμένη
            πρόβλεψη.
          </p>
        </div>
        <Link href="/plan" style={primaryLinkStyle}>
          Ορίσε πλάνο μήνα
        </Link>
      </>
    );
  }

  if (!overview.monthOpen) {
    // Closed plan: no live reconstruction. Step15 snapshots are not available
    // yet, so the comparison stays explicitly unavailable.
    return (
      <>
        <Header
          monthKey={overview.monthKey}
          plans={plans}
          currentMonth={currentMonth}
        />
        <div style={cardStyle}>
          <p style={emptyParagraphStyle}>
            Ο μήνας {overview.monthKey} είναι κλειστός. Η ζωντανή επισκόπηση
            δεν ανακατασκευάζει κλειστούς μήνες από τα σημερινά υπόλοιπα. Το
            σταθερό στιγμιότυπο του μήνα θα είναι διαθέσιμο σε επόμενο βήμα.
          </p>
        </div>
        <Link href="/plan" style={secondaryLinkStyle}>
          Δες το πλάνο
        </Link>
      </>
    );
  }

  // Setup-incomplete: an account exists but was never entered, or target null.
  if (f.setupIncomplete) {
    return (
      <>
        <Header
          monthKey={overview.monthKey}
          plans={plans}
          currentMonth={currentMonth}
        />
        {overview.hasUnenteredBalance ? <UnenteredBalanceAlert /> : null}
        {overview.hasStaleBalance ? <StaleBalanceAlert /> : null}
        <div style={cardStyle}>
          <p style={emptyParagraphStyle}>
            Η ρύθμιση δεν είναι πλήρης. Κάποιος λογαριασμός δεν έχει εισαγμένο
            υπόλοιπο ή λείπει ο στόχος αποταμίευσης. Δεν εμφανίζουμε ένα
            σίγουρο διαθέσιμο ποσό πριν ολοκληρωθεί η ρύθμιση.
          </p>
        </div>
        <DrilldownLists
          overview={overview}
          open={open}
          setOpen={setOpen}
        />
        <Link href="/accounts" style={secondaryLinkStyle}>
          Εισαγωγή υπολοίπων
        </Link>
      </>
    );
  }

  // Full forecast available. Prioritize protected target, shortfall and
  // projected vs cash-backed free-to-spend.
  const target = overview.savingsTargetCents ?? 0;
  const projected = f.projectedFreeToSpend ?? 0;
  const cashBacked = f.cashBackedFreeToSpend ?? 0;
  const shortfall = f.shortfall;
  const hasPendingIncomeCaveat = f.hasPendingIncomeCaveat;

  return (
    <>
      <Header
        monthKey={overview.monthKey}
        plans={plans}
        currentMonth={currentMonth}
      />

      {overview.hasStaleBalance ? <StaleBalanceAlert /> : null}
      {hasPendingIncomeCaveat ? <PendingIncomeAlert /> : null}

      {/* Arithmetic clarity card: step-by-step B - E - R + I - S */}
      <ArithmeticCard
        balancesTotal={f.balancesTotal}
        ordinaryUnpaid={f.ordinaryUnpaid}
        reservedOutstanding={f.reservedOutstanding}
        pendingIncomeRemaining={f.pendingIncomeRemaining}
        savingsTarget={target}
        projectedFreeToSpend={projected}
      />

      {/* Primary card: protected savings target + shortfall */}
      <section style={cardStyle} aria-label="Προστατευμένος στόχος">
        <div style={labelRowStyle}>
          <span style={mutedLabelStyle}>Προστατευμένος στόχος μήνα (S)</span>
        </div>
        <div style={bigAmountStyle}>
          <span style={{ color: "var(--fg)" }}>{formatEurEl(target)}</span>
        </div>
        <p style={hintStyle}>
          Το προστατευόμενο σύνολο τέλους μήνα — όχι μηνιαία κατάθεση ή κίνηση
          λογαριασμού.
        </p>
        <hr style={dividerStyle} />
        <div style={labelRowStyle}>
          <span style={mutedLabelStyle}>Υστέρηση έναντι στόχου</span>
          {shortfall === null ? (
            <span style={{ color: "var(--accent)", fontWeight: 700 }}>
              Καλύπτεται
            </span>
          ) : (
            <span
              style={{
                color: "#b91c1c",
                fontWeight: 800,
                fontSize: "1.05rem",
              }}
            >
              {formatEurEl(shortfall)}
            </span>
          )}
        </div>
        {shortfall !== null ? (
          <p
            style={{
              ...hintStyle,
              color: "#b91c1c",
            }}
          >
            Η πρόβλεψη δείχνει έλλειμμα. Δεν υπάρχει εορταστική κατάσταση για
            αρνητικό αποτέλεσμα — τα αρνητικά ποσά παραμένουν ορατά.
          </p>
        ) : null}
      </section>

      {/* Free-to-spend: projected vs cash-backed */}
      <section style={cardStyle} aria-label="Διάθεσιμο τέλους μήνα">
        <div style={labelRowStyle}>
          <span style={mutedLabelStyle}>Προβλεπόμενο διάθεσιμο</span>
          <span
            style={{
              fontWeight: 800,
              fontSize: "1.1rem",
              color: projected < 0 ? "#b91c1c" : "var(--fg)",
            }}
          >
            {formatEurEl(projected)}
          </span>
        </div>
        <p style={hintStyle}>
          B + I − E − R − S. Περιλαμβάνει έσοδα που αναμένεται ακόμη και δεν
          είναι μετρητά· γι&apos; αυτό βλέπε και το διάθεσιμο από μετρητά.
        </p>
        <hr style={dividerStyle} />
        <div style={labelRowStyle}>
          <span style={mutedLabelStyle}>Διάθεσιμο από μετρητά</span>
          <span
            style={{
              fontWeight: 800,
              fontSize: "1.1rem",
              color: cashBacked < 0 ? "#b91c1c" : "var(--fg)",
            }}
          >
            {formatEurEl(cashBacked)}
          </span>
        </div>
        <p style={hintStyle}>
          B − E − R − S. Χωρίς τα εκκρεμή έσοδα. Αν αυτό είναι αρνητικό, τα
          μετρητά δεν καλύπτουν ήδη τον στόχο ακόμη και αν όλα τα έσοδα
          εισπραχθούν.
        </p>
        <p style={{ ...hintStyle, marginTop: "0.3rem" }}>
          Προβλεπόμενα υπόλοιπα <strong>δεν</strong> είναι πραγματικά
          αποτελέσματα. Είναι προσδοκίες τέλους μήνα με βάση τα σημερινά
          δεδομένα.
        </p>
      </section>

      {/* Formula summary: B / I / E / R / S */}
      <section style={cardStyle} aria-label="Στοιχεία πρόβλεψης">
        <FormulaRow label="Υπόλοιπα (B)" value={f.balancesTotal} />
        <FormulaRow label="Εκκρεμή έσοδα (I)" value={f.pendingIncomeRemaining} />
        <FormulaRow label="Ανείσπρωτα έξοδα (E)" value={f.ordinaryUnpaid} />
        <FormulaRow label="Δεσμεύσεις (R)" value={f.reservedOutstanding} />
        <FormulaRow label="Στόχος (S)" value={target} />
      </section>

      <DrilldownLists
        overview={overview}
        open={open}
        setOpen={setOpen}
      />

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Button variant="secondary" onClick={refresh} style={{ flex: "1 1 auto" }}>
          Ανανέωση
        </Button>
        <Link href="/activity" style={secondaryLinkStyle}>
          Δραστηριότητα
        </Link>
      </div>
    </>
  );
}

// --- Sub-components ---

function Header({
  monthKey,
  plans,
  currentMonth,
}: {
  monthKey: string;
  plans: MonthlyPlan[];
  currentMonth: string;
}) {
  const router = useRouter();
  const sortedPlans = [...plans].sort((a, b) =>
    b.monthKey.localeCompare(a.monthKey),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <h1
        style={{
          fontSize: "1.4rem",
          fontWeight: 800,
          letterSpacing: "-0.02em",
          margin: 0,
        }}
      >
        Επισκόπηση
      </h1>
      <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
        {monthKey} · {monthKey === currentMonth ? "Τρέχων μήνας" : "Επιλεγμένος μήνας"}
      </p>
      <label
        htmlFor="overview-month"
        style={{ fontSize: "0.82rem", color: "var(--muted)" }}
      >
        Μήνας
      </label>
      <select
        id="overview-month"
        value={monthKey}
        onChange={(event) => {
          const selected = event.target.value;
          router.push(`/dashboard?month=${encodeURIComponent(selected)}`);
        }}
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
      >
        {sortedPlans.length === 0 ? (
          <option value={currentMonth}>{currentMonth} (τρέχων)</option>
        ) : (
          sortedPlans.map((plan) => (
            <option key={plan.id} value={plan.monthKey}>
              {plan.monthKey}{plan.status === "closed" ? " (κλειστός)" : ""}
            </option>
          ))
        )}
      </select>
    </div>
  );
}

function UnenteredBalanceAlert() {
  return (
    <Alert tone="warning">
      Κάποιος λογαριασμός δεν έχει εισαγμένο υπόλοιπο. Η πρόβλεψη δεν είναι
      πλήρης μέχρι να εισαχθεί — δεν εμφανίζουμε σίγουρο διαθέσιμο ποσό.
    </Alert>
  );
}

function StaleBalanceAlert() {
  return (
    <Alert tone="warning">
      Κάποιο υπόλοιπο δεν έχει ενημερωθεί εδώ και μέρες. Ενημέρωσε τα
      υπόλοιπα πριν εμπιστευτείς την πρόβλεψη — τα τρέχοντα υπόλοιπα είναι
      χειροκίνητα.
    </Alert>
  );
}

function PendingIncomeAlert() {
  return (
    <Alert tone="info">
      Μέρος των εσόδων είναι εκκρεμές (αναμένεται, όχι μετρητά). Το
      προβλεπόμενο διάθεσιμο εξαρτάται από αυτά· το &quot;διάθεσιμο από
      μετρητά&quot; τα αγνοεί.
    </Alert>
  );
}

function FormulaRow({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "0.5rem",
        padding: "0.3rem 0",
      }}
    >
      <span style={{ fontSize: "0.88rem", color: "var(--muted)" }}>{label}</span>
      <span
        style={{
          fontSize: "0.98rem",
          fontWeight: 700,
          color: value < 0 ? "#b91c1c" : "var(--fg)",
          whiteSpace: "nowrap",
        }}
      >
        {formatEurEl(value)}
      </span>
    </div>
  );
}

function ArithmeticCard({
  balancesTotal,
  ordinaryUnpaid,
  reservedOutstanding,
  pendingIncomeRemaining,
  savingsTarget,
  projectedFreeToSpend,
}: {
  balancesTotal: number;
  ordinaryUnpaid: number;
  reservedOutstanding: number;
  pendingIncomeRemaining: number;
  savingsTarget: number;
  projectedFreeToSpend: number;
}) {
  const totalBeforeTarget =
    balancesTotal - ordinaryUnpaid - reservedOutstanding + pendingIncomeRemaining;
  const difference = totalBeforeTarget - savingsTarget;

  return (
    <section
      style={cardStyle}
      aria-label="Αναλυτική πράξη πρόβλεψης"
    >
      <h2 style={arithmeticHeadingStyle}>Αναλυτική πράξη</h2>
      <ArithmeticRow
        label="Υπόλοιπα τραπεζών (B)"
        value={balancesTotal}
      />
      <ArithmeticRow
        label="Έξοδα που απομένουν (E)"
        value={ordinaryUnpaid}
        sign="−"
      />
      <ArithmeticRow
        label="Δεσμευμένα έξοδα που απομένουν (R)"
        value={reservedOutstanding}
        sign="−"
      />
      <ArithmeticRow
        label="Εκκρεμή έσοδα (I)"
        value={pendingIncomeRemaining}
        sign="+"
        hint="Αναμένεται · δεν είναι μετρητά ακόμη"
      />
      <hr style={dividerStyle} />
      <ArithmeticTotalRow
        label="Σύνολο πριν τον στόχο"
        formula="B − E − R + I"
        value={totalBeforeTarget}
      />
      <ArithmeticRow
        label="Στόχος αποταμίευσης (S)"
        value={savingsTarget}
        sign="−"
      />
      <hr style={dividerStyle} />
      <div style={arithmeticDifferenceRowStyle}>
        <span style={mutedLabelStyle}>Διαφορά από στόχο</span>
        <span
          style={{
            fontWeight: 800,
            fontSize: "1.2rem",
            color: difference < 0 ? "#b91c1c" : "var(--accent)",
            whiteSpace: "nowrap",
          }}
          aria-label={`Διαφορά από στόχο ${formatEurEl(difference)}`}
        >
          {formatEurEl(difference)}
        </span>
      </div>
      <p style={hintStyle}>
        Ισούται με το προβλεπόμενο διάθεσιμο (B + I − E − R − S):{" "}
        <strong>{formatEurEl(projectedFreeToSpend)}</strong>
        {difference === projectedFreeToSpend ? null : (
          <span style={{ color: "#b91c1c" }}> · ασυμφωνία</span>
        )}
      </p>
    </section>
  );
}

function ArithmeticRow({
  label,
  value,
  sign,
  hint,
}: {
  label: string;
  value: number;
  sign?: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "0.5rem",
        padding: "0.35rem 0",
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: "0.9rem", color: "var(--fg)" }}>
        {sign ? (
          <span
            aria-hidden
            style={{ color: "var(--muted)", marginRight: "0.3rem", fontWeight: 700 }}
          >
            {sign}
          </span>
        ) : null}
        {label}
        {hint ? (
          <span style={{ display: "block", fontSize: "0.75rem", color: "var(--muted)" }}>
            {hint}
          </span>
        ) : null}
      </span>
      <span
        style={{
          fontSize: "0.98rem",
          fontWeight: 700,
          color: value < 0 ? "#b91c1c" : "var(--fg)",
          whiteSpace: "nowrap",
        }}
      >
        {formatEurEl(value)}
      </span>
    </div>
  );
}

function ArithmeticTotalRow({
  label,
  formula,
  value,
}: {
  label: string;
  formula: string;
  value: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "0.5rem",
        padding: "0.4rem 0",
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: "0.92rem", fontWeight: 700, color: "var(--fg)" }}>
        {label}
        <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 400, marginLeft: "0.3rem" }}>
          {formula}
        </span>
      </span>
      <span
        style={{
          fontSize: "1.05rem",
          fontWeight: 800,
          color: value < 0 ? "#b91c1c" : "var(--fg)",
          whiteSpace: "nowrap",
        }}
      >
        {formatEurEl(value)}
      </span>
    </div>
  );
}

function DrilldownLists({
  overview,
  open,
  setOpen,
}: {
  overview: DashboardOverview;
  open: Drilldown | null;
  setOpen: (d: Drilldown | null) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>
        Λεπτομέρειες πρόβλεψης
      </h2>
      <DrilldownSection
        id="balances"
        label={DRILLDOWN_LABELS_EL.balances}
        open={open === "balances"}
        onToggle={() => setOpen(open === "balances" ? null : "balances")}
      >
        <BalancesList overview={overview} />
      </DrilldownSection>
      <DrilldownSection
        id="income"
        label={DRILLDOWN_LABELS_EL.income}
        open={open === "income"}
        onToggle={() => setOpen(open === "income" ? null : "income")}
      >
        <IncomeList overview={overview} />
      </DrilldownSection>
      <DrilldownSection
        id="expenses"
        label={DRILLDOWN_LABELS_EL.expenses}
        open={open === "expenses"}
        onToggle={() => setOpen(open === "expenses" ? null : "expenses")}
      >
        <ExpensesList overview={overview} />
      </DrilldownSection>
      <DrilldownSection
        id="reserves"
        label={DRILLDOWN_LABELS_EL.reserves}
        open={open === "reserves"}
        onToggle={() => setOpen(open === "reserves" ? null : "reserves")}
      >
        <ReservesList overview={overview} />
      </DrilldownSection>
      <DrilldownSection
        id="transfers"
        label={DRILLDOWN_LABELS_EL.transfers}
        open={open === "transfers"}
        onToggle={() => setOpen(open === "transfers" ? null : "transfers")}
      >
        <TransfersList overview={overview} />
      </DrilldownSection>
    </div>
  );
}

function DrilldownSection({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={cardStyle}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          width: "100%",
          minHeight: "2.75rem",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
          font: "inherit",
          color: "var(--fg)",
          fontWeight: 700,
          fontSize: "0.95rem",
          textAlign: "left",
        }}
      >
        <span>{label}</span>
        <span aria-hidden style={{ color: "var(--muted)" }}>
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? (
        <div
          id={`${id}-panel`}
          style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function BalancesList({ overview }: { overview: DashboardOverview }) {
  if (overview.accounts.length === 0) {
    return <EmptyHint text="Δεν υπάρχουν λογαριασμοί." />;
  }
  return (
    <ul style={listStyle}>
      {overview.accounts.map((a) => (
        <li key={a.id}>
          <Link
            href={`/accounts/${a.id}`}
            style={{ ...rowLinkStyle, flexDirection: "column", gap: "0.2rem", alignItems: "flex-start" }}
          >
            <span
              style={{
                fontSize: "0.95rem",
                fontWeight: 600,
                color: "var(--fg)",
              }}
            >
              {a.balanceCents === null
                ? "—"
                : formatEurEl(a.balanceCents)}
            </span>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
              {a.balanceCents === null
                ? "Δεν έχει εισαχθεί υπόλοιπο"
                : `Ενημερώθηκε ${freshnessLabel(a.balanceAsOf)}`}
              {a.stale && a.balanceCents !== null ? " · πιθανώς παλιό" : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function IncomeList({ overview }: { overview: DashboardOverview }) {
  if (overview.income.length === 0) {
    return <EmptyHint text="Δεν υπάρχουν έσοδα για αυτόν τον μήνα." />;
  }
  return (
    <ul style={listStyle}>
      {overview.income.map((i) => (
        <li key={i.id}>
          <div style={rowStyle}>
            <span style={{ fontSize: "0.92rem", color: "var(--fg)" }}>
              {i.sourceName}
            </span>
            <span
              style={{
                fontSize: "0.92rem",
                fontWeight: 700,
                color: "var(--fg)",
                whiteSpace: "nowrap",
              }}
            >
              {formatEurEl(i.pendingCents)}
            </span>
          </div>
          <div style={subRowStyle}>
            <span>αναμένεται {formatEurEl(i.expectedCents)}</span>
            <span>εισπράχθηκε {formatEurEl(i.receivedCents)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ExpensesList({ overview }: { overview: DashboardOverview }) {
  if (overview.ordinaryExpenses.length === 0) {
    return <EmptyHint text="Δεν υπάρχουν έξοδα για αυτόν τον μήνα." />;
  }
  return (
    <ul style={listStyle}>
      {overview.ordinaryExpenses.map((o) => (
        <li key={o.id}>
          <Link href="/activity" style={rowLinkStyle}>
            <span style={{ fontSize: "0.92rem", color: "var(--fg)" }}>
              {o.title}
              {o.linkedReserveId ? " · συνδεδεμένη δέσμευση" : ""}
            </span>
            <span
              style={{
                fontSize: "0.92rem",
                fontWeight: 700,
                color: o.remainingCents < 0 ? "#b91c1c" : "var(--fg)",
                whiteSpace: "nowrap",
              }}
            >
              {formatEurEl(o.remainingCents)}
            </span>
          </Link>
          <div style={subRowStyle}>
            <span>πρόγραμμα {formatEurEl(o.plannedCents)}</span>
            <span>πληρώθηκε {formatEurEl(o.paidCents)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ReservesList({ overview }: { overview: DashboardOverview }) {
  if (overview.reservedCommitments.length === 0) {
    return <EmptyHint text="Δεν υπάρχουν δεσμεύσεις για αυτόν τον μήνα." />;
  }
  return (
    <ul style={listStyle}>
      {overview.reservedCommitments.map((r) => (
        <li key={r.id}>
          <Link href="/activity" style={rowLinkStyle}>
            <span style={{ fontSize: "0.92rem", color: "var(--fg)" }}>
              {r.title}
              {r.dueDate ? ` · λήξη ${r.dueDate}` : ""}
            </span>
            <span
              style={{
                fontSize: "0.92rem",
                fontWeight: 700,
                color: r.remainingCents < 0 ? "#b91c1c" : "var(--fg)",
                whiteSpace: "nowrap",
              }}
            >
              {formatEurEl(r.remainingCents)}
            </span>
          </Link>
          <div style={subRowStyle}>
            <span>προστατευόμενο {formatEurEl(r.plannedCents)}</span>
            <span>πληρώθηκε {formatEurEl(r.paidCents)}</span>
          </div>
          {r.status === "released" ? (
            <div style={{ ...subRowStyle, color: "var(--muted)" }}>
              <span>αποδεσμευμένο — δεν προστατεύεται πια</span>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function TransfersList({ overview }: { overview: DashboardOverview }) {
  if (overview.transfers.length === 0) {
    return (
      <EmptyHint text="Δεν υπάρχουν εσωτερικές μεταφορές για αυτόν τον μήνα." />
    );
  }
  return (
    <ul style={listStyle}>
      {overview.transfers.map((t) => (
        <li key={t.id}>
          <div style={rowStyle}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              {t.fromAccountId} → {t.toAccountId}
            </span>
            <span
              style={{
                fontSize: "0.92rem",
                fontWeight: 700,
                color: "var(--fg)",
                whiteSpace: "nowrap",
              }}
            >
              {formatEurEl(t.amountCents)}
            </span>
          </div>
          <p style={hintStyle}>
            Εσωτερική μεταφορά — δεν είναι έσοδο ή έξοδο. Δεν επηρεάζει το
            σύνολο B.
          </p>
        </li>
      ))}
    </ul>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
      {text}
    </p>
  );
}

// --- Styles ---

const emptyParagraphStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.95rem",
  color: "var(--muted)",
  lineHeight: 1.5,
};

const mutedLabelStyle: React.CSSProperties = {
  fontSize: "0.85rem",
  color: "var(--muted)",
  fontWeight: 600,
};

const bigAmountStyle: React.CSSProperties = {
  fontSize: "1.5rem",
  fontWeight: 800,
  letterSpacing: "-0.02em",
  margin: "0.2rem 0",
};

const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8rem",
  color: "var(--muted)",
  lineHeight: 1.4,
};

const arithmeticHeadingStyle: React.CSSProperties = {
  fontSize: "1.1rem",
  fontWeight: 800,
  margin: "0 0 0.4rem 0",
  letterSpacing: "-0.01em",
};

const arithmeticDifferenceRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "0.5rem",
  flexWrap: "wrap",
  padding: "0.4rem 0",
};

const labelRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "0.5rem",
  flexWrap: "wrap",
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.45rem",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "0.5rem",
};

const rowLinkStyle: React.CSSProperties = {
  ...rowStyle,
  textDecoration: "none",
  color: "inherit",
};

const subRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "0.5rem",
  fontSize: "0.78rem",
  color: "var(--muted)",
  marginTop: "0.1rem",
};

const primaryLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "2.75rem",
  padding: "0.6rem 1.1rem",
  borderRadius: "0.6rem",
  backgroundColor: "var(--accent)",
  color: "white",
  fontWeight: 600,
  fontSize: "0.95rem",
  textDecoration: "none",
};

const secondaryLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "2.75rem",
  padding: "0.6rem 1.1rem",
  borderRadius: "0.6rem",
  backgroundColor: "var(--card)",
  color: "var(--fg)",
  fontWeight: 600,
  fontSize: "0.95rem",
  border: "1px solid var(--border)",
  textDecoration: "none",
};