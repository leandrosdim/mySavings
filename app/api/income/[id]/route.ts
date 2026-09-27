// PATCH /api/income/[id] — update an income expectation.
// Enforces revision rules: expected_cents cannot be lowered below the
// already-received amount. Receipt history is never deleted.

import { NextResponse, type NextRequest } from "next/server";
import { updateIncome } from "@/lib/income/service";
import { validateUpdateIncomeInput } from "@/lib/income/validation";
import { handlePatch, NO_STORE } from "@/lib/finance-routes";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handlePatch(request, async (owner, body) => {
    const input = validateUpdateIncomeInput({
      sourceName: body.sourceName,
      expectedCents: body.expectedCents,
      linkedAccountId: body.linkedAccountId,
    });
    const result = await updateIncome(owner.ownerId, id, input);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}