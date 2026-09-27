// GET /api/obligations/[id]/settlements — list the chronological settlement
// history for an obligation, including reversal linkage. Owner-scoped.

import { NextResponse, type NextRequest } from "next/server";
import { listSettlementsForObligation } from "@/lib/settlements/service";
import { handleGet, NO_STORE } from "@/lib/finance-routes";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handleGet(request, async (owner) => {
    const history = await listSettlementsForObligation(owner.ownerId, id);
    return NextResponse.json(
      { settlements: history },
      { status: 200, headers: NO_STORE },
    );
  });
}