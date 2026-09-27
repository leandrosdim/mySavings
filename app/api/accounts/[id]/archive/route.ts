// POST /api/accounts/[id]/archive — archive an owner-scoped account.

import { NextResponse, type NextRequest } from "next/server";
import { archiveAccount } from "@/lib/accounts/service";
import { handlePost, NO_STORE } from "@/lib/accounts/routes";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handlePost(request, async (owner) => {
    const result = await archiveAccount(owner.ownerId, id);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  });
}