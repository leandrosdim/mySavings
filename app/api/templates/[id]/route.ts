// PATCH /api/templates/[id] — update a recurring template.
// Editing affects future generation only; existing instances keep their amount.

import { NextResponse, type NextRequest } from "next/server";
import { updateTemplate } from "@/lib/templates/service";
import { validateUpdateTemplateInput } from "@/lib/templates/validation";
import { handlePatch, NO_STORE } from "@/lib/finance-routes";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handlePatch(request, async (owner, body) => {
    const input = validateUpdateTemplateInput({
      name: body.name,
      defaultAmountCents: body.defaultAmountCents,
      dueDayOfMonth: body.dueDayOfMonth,
      active: body.active,
    });
    const result = await updateTemplate(owner.ownerId, id, input);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}