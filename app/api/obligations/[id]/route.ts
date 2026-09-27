// PATCH /api/obligations/[id] — update an obligation.
// Enforces revision rules: planned_cents cannot be lowered below the
// already-paid amount. Paid history is never deleted.

import { NextResponse, type NextRequest } from "next/server";
import { updateObligation } from "@/lib/obligations/service";
import { validateUpdateObligationInput } from "@/lib/obligations/validation";
import { handlePatch, NO_STORE } from "@/lib/finance-routes";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handlePatch(request, async (owner, body) => {
    const input = validateUpdateObligationInput({
      title: body.title,
      plannedCents: body.plannedCents,
      dueDate: body.dueDate,
      linkedAccountId: body.linkedAccountId,
    });
    const result = await updateObligation(owner.ownerId, id, input);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}