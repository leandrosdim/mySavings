// POST /api/income/create — create a new income expectation.
// The expected_cents is preserved; received/pending are derived from
// non-reversed income_receipts (Step10). No receipt is created here.

import { NextResponse, type NextRequest } from "next/server";
import { createIncome } from "@/lib/income/service";
import { validateCreateIncomeInput } from "@/lib/income/validation";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (owner, body) => {
    const input = validateCreateIncomeInput({
      monthKey: body.monthKey,
      sourceName: body.sourceName,
      expectedCents: body.expectedCents,
      linkedAccountId: body.linkedAccountId ?? null,
    });
    const result = await createIncome(owner.ownerId, input);
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  });
}