// POST /api/settlements/pay — record a partial or full expense payment.
//
// The planned_cents on the obligation is never mutated; only settlements
// grow. UPDATE_ACCOUNT subtracts from the account balance atomically;
// ALREADY_REFLECTED records the payment without a balance change. Overpayment
// is rejected. Idempotency keys deduplicate retries.

import { NextResponse, type NextRequest } from "next/server";
import { payObligation } from "@/lib/settlements/service";
import { validatePayInput } from "@/lib/settlements/validation";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (_owner, body) => {
    const input = validatePayInput({
      obligationId: body.obligationId,
      amountCents: body.amountCents,
      mode: body.mode,
      accountId: body.accountId ?? null,
      businessDate: body.businessDate,
      idempotencyKey: body.idempotencyKey,
    });
    const result = await payObligation(_owner.ownerId, input);
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  });
}