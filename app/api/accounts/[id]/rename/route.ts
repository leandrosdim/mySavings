// PATCH /api/accounts/[id]/rename — rename an owner-scoped account.

import { NextResponse, type NextRequest } from "next/server";
import { renameAccount } from "@/lib/accounts/service";
import { validateAccountName } from "@/lib/accounts/validation";
import { handlePost, NO_STORE } from "@/lib/accounts/routes";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handlePost(request, async (owner, body) => {
    const name = validateAccountName(body.name);
    const result = await renameAccount(owner.ownerId, id, name);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}