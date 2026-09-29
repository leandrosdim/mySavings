// GET /api/exports/json?month=YYYY-MM — private owner-filtered JSON backup.
//
// No-store headers, UTF-8. Owner-scoped; no secrets, no auth/session columns.
// Restore/import is NOT automatic and is out of v1 scope.

import { NextResponse, type NextRequest } from "next/server";
import { exportMonthJson } from "@/lib/exports/service";
import { resolveOwner, NO_STORE } from "@/lib/finance-routes";

const MONTH_KEY_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const ownerResult = await resolveOwner();
  if (!ownerResult.ok) {
    return ownerResult.response;
  }
  const monthKey = request.nextUrl.searchParams.get("month");
  if (typeof monthKey !== "string" || !MONTH_KEY_RE.test(monthKey)) {
    return NextResponse.json(
      { error: "Missing or invalid month parameter (expected YYYY-MM)" },
      { status: 400, headers: NO_STORE },
    );
  }
  try {
    const json = await exportMonthJson(ownerResult.owner.ownerId, monthKey);
    return new NextResponse(json, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="mysavings-${monthKey}.json"`,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Export failed" },
      { status: 500, headers: NO_STORE },
    );
  }
}