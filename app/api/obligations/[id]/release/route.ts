// POST /api/obligations/[id]/release — release the unpaid remainder of an
// obligation. The status transitions to 'released'; planned_cents is
// preserved and paid history is never deleted. The outstanding unpaid amount
// is un-protected from the spendable calculation. Audited. Rejected on a
// closed month. Cancelled obligations cannot be released.

import { NextResponse, type NextRequest } from "next/server";
import { releaseObligation } from "@/lib/obligations/service";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handlePost(request, async (owner) => {
    const result = await releaseObligation(owner.ownerId, id);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}