// POST /api/obligations/[id]/cancel — cancel an obligation.
// Rejects if the obligation has non-reversed settlements (paid history is
// never deleted). Cancelled obligations keep their row and history.

import { NextResponse, type NextRequest } from "next/server";
import { cancelObligation } from "@/lib/obligations/service";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handlePost(request, async (owner) => {
    const result = await cancelObligation(owner.ownerId, id);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}