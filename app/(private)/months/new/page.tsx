import { verifySession } from "@/lib/auth/dal";
import { currentMonthKeyAthens } from "@/lib/months/service";
import { RolloverPreviewClient } from "./RolloverPreviewClient";

export const metadata = {
  title: "Επόμενος μήνας",
};

export const dynamic = "force-dynamic";

// Private server-rendered finance: never cache. The (private) layout already
// requires an authenticated session; this page adds no-store semantics via
// force-dynamic so no authenticated HTML/RSC response is persisted in any
// shared cache.
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function RolloverPreviewPage() {
  const session = await verifySession();
  const currentMonth = currentMonthKeyAthens();
  return <RolloverPreviewClient currentMonth={currentMonth} />;
}