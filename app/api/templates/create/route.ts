// POST /api/templates/create — create a recurring template.

import { NextResponse, type NextRequest } from "next/server";
import { createTemplate } from "@/lib/templates/service";
import { validateCreateTemplateInput } from "@/lib/templates/validation";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (owner, body) => {
    const input = validateCreateTemplateInput({
      name: body.name,
      kind: body.kind,
      defaultAmountCents: body.defaultAmountCents ?? 0,
      dueDayOfMonth: body.dueDayOfMonth ?? null,
      active: body.active ?? true,
    });
    const result = await createTemplate(owner.ownerId, input);
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  });
}