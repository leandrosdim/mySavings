// GET /api/plans — list all monthly plans for the authenticated owner.

import { NextResponse, type NextRequest } from "next/server";
import { listPlans } from "@/lib/months/service";
import { handleGet, NO_STORE } from "@/lib/finance-routes";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleGet(request, async (owner) => {
    const plans = await listPlans(owner.ownerId);
    return NextResponse.json({ plans }, { status: 200, headers: NO_STORE });
  });
}