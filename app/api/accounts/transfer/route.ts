// POST /api/accounts/transfer — internal transfer between two owned accounts.

import { NextResponse, type NextRequest } from "next/server";
import { transferBetweenAccounts } from "@/lib/accounts/service";
import {
  validateAccountId,
  validatePositiveCents,
  validateBusinessDate,
  validateIdempotencyKey,
} from "@/lib/accounts/validation";
import { handlePost, NO_STORE } from "@/lib/accounts/routes";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (owner, body) => {
    const fromAccountId = validateAccountId(body.fromAccountId);
    const toAccountId = validateAccountId(body.toAccountId);
    if (fromAccountId === toAccountId) {
      return NextResponse.json(
        { error: "Source and destination accounts must differ" },
        { status: 400, headers: NO_STORE },
      );
    }
    const amountCents = validatePositiveCents(body.amountCents);
    const businessDate = validateBusinessDate(body.businessDate);
    const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
    const result = await transferBetweenAccounts(owner.ownerId, {
      fromAccountId,
      toAccountId,
      amountCents,
      businessDate,
      idempotencyKey,
    });
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  });
}