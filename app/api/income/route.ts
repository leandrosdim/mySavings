// GET /api/income — list income expectations for the authenticated owner.
// Supports optional query params: monthKey, status.

import { NextResponse, type NextRequest } from "next/server";
import { listIncome } from "@/lib/income/service";
import { handleGet, NO_STORE } from "@/lib/finance-routes";
import type { IncomeFilter } from "@/lib/income/types";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleGet(request, async (owner) => {
    const url = new URL(request.url);
    const filter: IncomeFilter = {};
    const monthKey = url.searchParams.get("monthKey");
    if (monthKey) filter.monthKey = monthKey;
    const status = url.searchParams.get("status");
    if (status === "active" || status === "received" || status === "cancelled") {
      filter.status = status;
    }
    const income = await listIncome(owner.ownerId, filter);
    return NextResponse.json({ income }, { status: 200, headers: NO_STORE });
  });
}