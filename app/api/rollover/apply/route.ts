// POST /api/rollover/apply — apply a validated rollover atomically.
// Idempotent via owner-scoped idempotency key; stale preview is rejected.

import { NextResponse, type NextRequest } from "next/server";
import { applyRollover } from "@/lib/rollover/service";
import { validateApplyRolloverInput } from "@/lib/rollover/validation";
import { handlePost, NO_STORE } from "@/lib/finance-routes";
import type { Cents } from "@/lib/finance/money";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (owner, body) => {
    const input = validateApplyRolloverInput({
      sourceMonthKey: body.sourceMonthKey as string,
      savingsTargetCents: body.savingsTargetCents as Cents,
      previewDigest: body.previewDigest as string,
      releaseChoices: body.releaseChoices as { obligationId: string }[],
      carryIncomeIds: body.carryIncomeIds as string[],
      idempotencyKey: body.idempotencyKey as string,
    });
    const result = await applyRollover(owner.ownerId, input);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}