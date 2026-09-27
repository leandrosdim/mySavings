// POST /api/accounts — create a new owner-scoped account.

import { NextResponse, type NextRequest } from "next/server";
import { createAccount } from "@/lib/accounts/service";
import { validateCreateAccountInput } from "@/lib/accounts/validation";
import { handlePost, NO_STORE } from "@/lib/accounts/routes";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePost(request, async (owner, body) => {
    const input = validateCreateAccountInput({
      name: body.name,
      initialBalanceCents: body.initialBalanceCents ?? body.balanceCents ?? null,
      trackBalance: body.trackBalance ?? true,
    });
    const result = await createAccount(owner.ownerId, input);
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  });
}