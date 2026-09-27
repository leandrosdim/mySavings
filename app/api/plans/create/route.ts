// POST /api/plans — create a monthly plan for the authenticated owner.

import { NextResponse, type NextRequest } from "next/server";
import { createPlan } from "@/lib/months/service";
import { validateCreatePlanInput } from "@/lib/months/validation";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (owner, body) => {
    const input = validateCreatePlanInput({
      monthKey: body.monthKey,
      savingsTargetCents: body.savingsTargetCents ?? 0,
    });
    const result = await createPlan(owner.ownerId, input);
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  });
}