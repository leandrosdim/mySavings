// GET /api/history/[monthKey] — fetch the immutable snapshot + provenance for a closed month.

import { NextResponse, type NextRequest } from "next/server";
import { getClosingSnapshot } from "@/lib/history/service";
import { handleGet, mapServiceError, NO_STORE } from "@/lib/finance-routes";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ monthKey: string }> },
): Promise<NextResponse> {
  const { monthKey } = await params;
  return handleGet(request, async (owner) => {
    try {
      const snapshot = await getClosingSnapshot(owner.ownerId, monthKey);
      return NextResponse.json(
        { snapshot },
        { status: 200, headers: NO_STORE },
      );
    } catch (error) {
      return mapServiceError(error);
    }
  });
}