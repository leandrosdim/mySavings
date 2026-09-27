// GET /api/obligations — list obligations for the authenticated owner.
// Supports optional query params: monthKey, kind, status, includeReserved.

import { NextResponse, type NextRequest } from "next/server";
import { listObligations } from "@/lib/obligations/service";
import { handleGet, NO_STORE } from "@/lib/finance-routes";
import type { ObligationFilter } from "@/lib/obligations/types";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleGet(request, async (owner) => {
    const url = new URL(request.url);
    const filter: ObligationFilter = {};
    const monthKey = url.searchParams.get("monthKey");
    if (monthKey) filter.monthKey = monthKey;
    const kind = url.searchParams.get("kind");
    if (kind === "ordinary" || kind === "reserved") filter.kind = kind;
    const status = url.searchParams.get("status");
    if (status === "active" || status === "settled" || status === "released" || status === "cancelled") {
      filter.status = status;
    }
    const includeReserved = url.searchParams.get("includeReserved");
    if (includeReserved === "true") filter.includeReserved = true;
    const obligations = await listObligations(owner.ownerId, filter);
    return NextResponse.json({ obligations }, { status: 200, headers: NO_STORE });
  });
}