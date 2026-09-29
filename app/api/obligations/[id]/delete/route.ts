// POST /api/obligations/[id]/delete — permanently delete a released
// obligation that has no payment history. Paid history is never deleted.

import { NextResponse, type NextRequest } from "next/server";
import { deleteReleasedObligation } from "@/lib/obligations/service";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handlePost(request, async (owner) => {
    const result = await deleteReleasedObligation(owner.ownerId, id);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}
