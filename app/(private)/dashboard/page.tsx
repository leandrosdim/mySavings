import { verifySession } from "@/lib/auth/dal";
import { currentMonthKeyAthens } from "@/lib/months/service";
import { getDashboardOverview } from "@/lib/dashboard";
import { OverviewClient } from "@/components/overview/OverviewClient";

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

export default async function DashboardPage() {
  const session = await verifySession();
  const currentMonth = currentMonthKeyAthens();
  const overview = await getDashboardOverview(session.userId, currentMonth);
  return <OverviewClient overview={overview} />;
}