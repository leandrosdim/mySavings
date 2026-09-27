// POST /api/obligations/create — create a new obligation (ordinary expense or
// reserved commitment). The planned_cents is immutable once written; partial
// settlements do not zero it. An ordinary expense may link to a reserved
// commitment via linkedReserveId for presentation (counted once in R, not E).

import { NextResponse, type NextRequest } from "next/server";
import { createObligation } from "@/lib/obligations/service";
import { validateCreateObligationInput } from "@/lib/obligations/validation";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (owner, body) => {
    const input = validateCreateObligationInput({
      kind: body.kind,
      title: body.title,
      plannedCents: body.plannedCents,
      monthKey: body.monthKey,
      dueDate: body.dueDate ?? null,
      linkedAccountId: body.linkedAccountId ?? null,
      linkedReserveId: body.linkedReserveId ?? null,
    });
    const result = await createObligation(owner.ownerId, input);
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  });
}