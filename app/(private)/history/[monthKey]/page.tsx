import { verifySession } from "@/lib/auth/dal";
import { getClosingSnapshot } from "@/lib/history/service";
import { HistoryDetailClient } from "./HistoryDetailClient";
import type { ClosingSnapshot } from "@/lib/history/types";
import { HistoryNotFoundError } from "@/lib/history/types";

export const metadata = {
  title: "Στιγμιότυπο μήνα",
};

export const dynamic = "force-dynamic";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ monthKey: string }>;
}) {
  const { monthKey } = await params;
  const session = await verifySession();
  let snapshot: ClosingSnapshot;
  try {
    snapshot = await getClosingSnapshot(session.userId, monthKey);
  } catch (e) {
    if (e instanceof HistoryNotFoundError) {
      return (
        <div style={{ padding: "1rem" }}>
          <p style={{ color: "var(--muted)" }}>
            Δεν υπάρχει κλειστό στιγμιότυπο για τον {monthKey}.
          </p>
        </div>
      );
    }
    throw e;
  }

  return <HistoryDetailClient snapshot={snapshot} />;
}