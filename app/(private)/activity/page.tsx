import { verifySession } from "@/lib/auth/dal";
import {
  listPlans,
  currentMonthKeyAthens,
} from "@/lib/months/service";
import { listObligations } from "@/lib/obligations/service";
import { listIncome } from "@/lib/income/service";
import { listAllAccounts } from "@/lib/accounts/service";
import { ActivityPageClient } from "./ActivityPageClient";
import type { MonthlyPlan } from "@/lib/months/types";
import type { Obligation } from "@/lib/obligations/types";
import type { IncomeExpectation } from "@/lib/income/types";
import type { Account } from "@/lib/accounts/types";

type ActivityPageProps = {
  searchParams?: Promise<{ month?: string | string[] }>;
};

export const metadata = {
  title: "Δραστηριότητα",
};

export const dynamic = "force-dynamic";

export default async function ActivityPage({
  searchParams,
}: ActivityPageProps) {
  const session = await verifySession();
  const currentMonth = currentMonthKeyAthens();

  const plans = await listPlans(session.userId);
  const params = searchParams ? await searchParams : {};
  const requestedMonth =
    typeof params.month === "string" ? params.month : null;
  const selectedMonth =
    requestedMonth === currentMonth ||
    (requestedMonth !== null && plans.some((p) => p.monthKey === requestedMonth))
      ? requestedMonth
      : currentMonth;
  const obligations = await listObligations(session.userId, {
    monthKey: selectedMonth,
    includeReserved: false,
  });
  const reserved = await listObligations(session.userId, {
    monthKey: selectedMonth,
    kind: "reserved",
  });
  const income = await listIncome(session.userId, {
    monthKey: selectedMonth,
  });
  const accounts = await listAllAccounts(session.userId);

  return (
    <ActivityPageClient
      currentMonth={currentMonth}
      selectedMonth={selectedMonth}
      plans={plans}
      obligations={obligations}
      reserved={reserved}
      income={income}
      accounts={accounts}
    />
  );
}