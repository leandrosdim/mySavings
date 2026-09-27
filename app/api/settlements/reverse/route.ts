// POST /api/settlements/reverse — reverse a settlement (expense payment).
//
// Creates an immutable settlement_reversals row linked to the original. If
// the account was manually refreshed after the settlement, the caller must
// explicitly decide whether to adjust the balance via
// adjustBalanceAfterRefresh.

import { NextResponse, type NextRequest } from "next/server";
import { reverseSettlement } from "@/lib/settlements/service";
import { validateReverseSettlementInput } from "@/lib/settlements/validation";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (_owner, body) => {
    const input = validateReverseSettlementInput({
      settlementId: body.settlementId,
      businessDate: body.businessDate,
      idempotencyKey: body.idempotencyKey,
      reason: body.reason ?? undefined,
      adjustBalanceAfterRefresh: body.adjustBalanceAfterRefresh,
    });
    const result = await reverseSettlement(_owner.ownerId, input);
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  });
}