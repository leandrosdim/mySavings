// PATCH /api/plans/[id]/target — update the savings target on an open plan.

import { NextResponse, type NextRequest } from "next/server";
import { updateSavingsTarget } from "@/lib/months/service";
import { validateUpdateTargetInput } from "@/lib/months/validation";
import { handlePatch, NO_STORE } from "@/lib/finance-routes";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handlePatch(request, async (owner, body) => {
    const input = validateUpdateTargetInput({
      planId: id,
      savingsTargetCents: body.savingsTargetCents ?? 0,
    });
    const result = await updateSavingsTarget(owner.ownerId, input);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}