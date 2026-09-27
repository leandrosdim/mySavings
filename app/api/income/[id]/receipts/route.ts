// GET /api/income/[id]/receipts — list the chronological receipt history for
// an income expectation, including reversal linkage. Owner-scoped.

import { NextResponse, type NextRequest } from "next/server";
import { listReceiptsForIncome } from "@/lib/settlements/service";
import { handleGet, NO_STORE } from "@/lib/finance-routes";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handleGet(request, async (owner) => {
    const history = await listReceiptsForIncome(owner.ownerId, id);
    return NextResponse.json(
      { receipts: history },
      { status: 200, headers: NO_STORE },
    );
  });
}