// POST /api/income/[id]/cancel — cancel an income expectation.
// Rejects if the income has non-reversed receipts (receipt history is never
// deleted). Cancelled income keeps its row and history.

import { NextResponse, type NextRequest } from "next/server";
import { cancelIncome } from "@/lib/income/service";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handlePost(request, async (owner) => {
    const result = await cancelIncome(owner.ownerId, id);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}