// GET /api/history — list history summaries (plans + closed snapshot aggregates).

import { NextResponse, type NextRequest } from "next/server";
import { listHistorySummaries } from "@/lib/history/service";
import { handleGet, NO_STORE } from "@/lib/finance-routes";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleGet(request, async (owner) => {
    const summaries = await listHistorySummaries(owner.ownerId);
    return NextResponse.json(
      { summaries },
      { status: 200, headers: NO_STORE },
    );
  });
}