// POST /api/settlements/receive — record a partial or full income receipt.
//
// Mirrors /api/settlements/pay but adds to the account balance for
// UPDATE_ACCOUNT mode. Over-receipt is rejected. Idempotency keys
// deduplicate retries.

import { NextResponse, type NextRequest } from "next/server";
import { receiveIncome } from "@/lib/settlements/service";
import { validateReceiveInput } from "@/lib/settlements/validation";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (_owner, body) => {
    const input = validateReceiveInput({
      incomeExpectationId: body.incomeExpectationId,
      amountCents: body.amountCents,
      mode: body.mode,
      accountId: body.accountId ?? null,
      businessDate: body.businessDate,
      idempotencyKey: body.idempotencyKey,
    });
    const result = await receiveIncome(_owner.ownerId, input);
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  });
}