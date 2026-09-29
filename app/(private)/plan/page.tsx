import { verifySession } from "@/lib/auth/dal";
import {
  listPlans,
  currentMonthKeyAthens,
  getPlanByMonth,
} from "@/lib/months/service";
import { listTemplates } from "@/lib/templates/service";
import { PlanPageClient } from "./PlanPageClient";
import type { MonthlyPlan } from "@/lib/months/types";
import type { RecurringTemplate } from "@/lib/templates/types";
import { PlanNotFoundError } from "@/lib/months/types";

type PlanPageProps = {
  searchParams?: Promise<{ month?: string | string[] }>;
};

export const metadata = {
  title: "Μηνιαίο πλάνο",
};

export const dynamic = "force-dynamic";

export default async function PlanPage({
  searchParams,
}: PlanPageProps) {
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

  let selectedPlan: MonthlyPlan | null = null;
  try {
    selectedPlan = await getPlanByMonth(session.userId, selectedMonth);
  } catch (e) {
    if (!(e instanceof PlanNotFoundError)) {
      throw e;
    }
  }

  const templates = await listTemplates(session.userId);

  return (
    <PlanPageClient
      currentMonth={currentMonth}
      selectedMonth={selectedMonth}
      currentPlan={selectedPlan}
      plans={plans}
      templates={templates}
    />
  );
}