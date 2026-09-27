// POST /api/receipts/reverse — reverse an income receipt.
//
// Creates an immutable income_receipt_reversals row linked to the original.
// If the account was manually refreshed after the receipt, the caller must
// explicitly decide whether to adjust the balance via
// adjustBalanceAfterRefresh.

import { NextResponse, type NextRequest } from "next/server";
import { reverseReceipt } from "@/lib/settlements/service";
import { validateReverseReceiptInput } from "@/lib/settlements/validation";
import { handlePost, NO_STORE } from "@/lib/finance-routes";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (_owner, body) => {
    const input = validateReverseReceiptInput({
      receiptId: body.receiptId,
      businessDate: body.businessDate,
      idempotencyKey: body.idempotencyKey,
      reason: body.reason ?? undefined,
      adjustBalanceAfterRefresh: body.adjustBalanceAfterRefresh,
    });
    const result = await reverseReceipt(_owner.ownerId, input);
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  });
}