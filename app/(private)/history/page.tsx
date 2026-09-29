import { verifySession } from "@/lib/auth/dal";
import { listHistorySummaries } from "@/lib/history/service";
import { currentMonthKeyAthens } from "@/lib/months/service";
import { HistoryPageClient } from "./HistoryPageClient";
import type { HistorySummary } from "@/lib/history/types";

export const metadata = {
  title: "Ιστορικό",
};

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const session = await verifySession();
  const currentMonth = currentMonthKeyAthens();
  const summaries: HistorySummary[] = await listHistorySummaries(
    session.userId,
  );

  return (
    <HistoryPageClient
      currentMonth={currentMonth}
      summaries={summaries}
    />
  );
}