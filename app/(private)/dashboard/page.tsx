import { verifySession } from "@/lib/auth/dal";
import { currentMonthKeyAthens, listPlans } from "@/lib/months/service";
import { getDashboardOverview } from "@/lib/dashboard";
import { OverviewClient } from "@/components/overview/OverviewClient";

type DashboardPageProps = {
  searchParams?: Promise<{ month?: string | string[] }>;
};

export const metadata = {
  title: "Επισκόπηση",
};

export const dynamic = "force-dynamic";

// Private server-rendered finance: never cache. The (private) layout already
// requires an authenticated session; this page adds no-store semantics via
// force-dynamic so no authenticated HTML/RSC response is persisted in any
// shared cache.
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
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
  const overview = await getDashboardOverview(session.userId, selectedMonth);
  return (
    <OverviewClient
      overview={overview}
      plans={plans}
      currentMonth={currentMonth}
    />
  );
}