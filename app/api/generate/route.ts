// POST /api/generate — generate month entries from active templates.
// Idempotent: running twice produces no duplicates.

import { NextResponse, type NextRequest } from "next/server";
import { generateMonthEntries } from "@/lib/generation/service";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (owner, body) => {
    const monthKey =
      typeof body.monthKey === "string" ? body.monthKey : undefined;
    const result = await generateMonthEntries(owner.ownerId, monthKey);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}