// POST /api/history/close — close a month and store an immutable snapshot.

import { NextResponse, type NextRequest } from "next/server";
import { closeMonth } from "@/lib/history/service";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (owner, body) => {
    const monthKey = body.monthKey;
    if (typeof monthKey !== "string") {
      return NextResponse.json(
        { error: "Missing monthKey" },
        { status: 400, headers: NO_STORE },
      );
    }
    const result = await closeMonth(owner.ownerId, monthKey);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}