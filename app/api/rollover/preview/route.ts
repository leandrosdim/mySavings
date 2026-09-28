// GET /api/rollover/preview?sourceMonthKey=YYYY-MM — read-only next-month
// preview for the authenticated owner. No writes; no-store semantics.

import { NextResponse, type NextRequest } from "next/server";
import { buildRolloverPreview } from "@/lib/rollover/service";
import { handleGet, NO_STORE } from "@/lib/finance-routes";
import { validateRolloverMonthKey } from "@/lib/rollover/validation";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleGet(request, async (owner) => {
    const url = new URL(request.url);
    const rawSource = url.searchParams.get("sourceMonthKey");
    if (!rawSource) {
      return NextResponse.json(
        { error: "Missing sourceMonthKey query parameter" },
        { status: 400, headers: NO_STORE },
      );
    }
    let sourceMonthKey: string;
    try {
      sourceMonthKey = validateRolloverMonthKey(rawSource);
    } catch {
      return NextResponse.json(
        { error: "Invalid sourceMonthKey" },
        { status: 400, headers: NO_STORE },
      );
    }
    const preview = await buildRolloverPreview(owner.ownerId, sourceMonthKey);
    return NextResponse.json(preview, { status: 200, headers: NO_STORE });
  });
}