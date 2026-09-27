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

export const metadata = {
  title: "Μηνιαίο πλάνο",
};

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const session = await verifySession();
  const currentMonth = currentMonthKeyAthens();

  let currentPlan: MonthlyPlan | null = null;
  try {
    currentPlan = await getPlanByMonth(session.userId, currentMonth);
  } catch (e) {
    if (e instanceof PlanNotFoundError) {
      currentPlan = null;
    } else {
      throw e;
    }
  }

  const plans = await listPlans(session.userId);
  const templates = await listTemplates(session.userId);

  return (
    <PlanPageClient
      currentMonth={currentMonth}
      currentPlan={currentPlan}
      plans={plans}
      templates={templates}
    />
  );
}