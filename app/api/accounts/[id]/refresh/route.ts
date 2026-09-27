// POST /api/accounts/[id]/refresh — manually replace the current balance.

import { NextResponse, type NextRequest } from "next/server";
import { refreshBalance } from "@/lib/accounts/service";
import {
  validateBalanceCents,
  validateAsOfDate,
  validateExpectedVersion,
  validateIdempotencyKey,
  validateOptionalReason,
} from "@/lib/accounts/validation";
import { handlePost, NO_STORE } from "@/lib/accounts/routes";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handlePost(request, async (owner, body) => {
    const newBalanceCents = validateBalanceCents(body.newBalanceCents);
    const asOf = validateAsOfDate(body.asOf ?? new Date().toISOString());
    const expectedVersion = validateExpectedVersion(body.expectedVersion);
    const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
    const reason = validateOptionalReason(body.reason);
    const result = await refreshBalance(owner.ownerId, {
      accountId: id,
      newBalanceCents,
      asOf,
      expectedVersion,
      idempotencyKey,
      reason,
    });
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}