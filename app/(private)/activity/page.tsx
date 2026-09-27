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

export const metadata = {
  title: "Δραστηριότητα",
};

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const session = await verifySession();
  const currentMonth = currentMonthKeyAthens();

  const plans = await listPlans(session.userId);
  const obligations = await listObligations(session.userId, {
    monthKey: currentMonth,
    includeReserved: false,
  });
  const reserved = await listObligations(session.userId, {
    monthKey: currentMonth,
    kind: "reserved",
  });
  const income = await listIncome(session.userId, {
    monthKey: currentMonth,
  });
  const accounts = await listAllAccounts(session.userId);

  return (
    <ActivityPageClient
      currentMonth={currentMonth}
      plans={plans}
      obligations={obligations}
      reserved={reserved}
      income={income}
      accounts={accounts}
    />
  );
}