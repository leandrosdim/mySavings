// GET /api/accounts/[id] — fetch a single owner-scoped account.

import { NextResponse, type NextRequest } from "next/server";
import { getAccount, getReconciliationState } from "@/lib/accounts/service";
import { handleGet, mapServiceError, NO_STORE } from "@/lib/accounts/routes";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handleGet(request, async (owner) => {
    try {
      const account = await getAccount(owner.ownerId, id);
      const reconciliation = await getReconciliationState(owner.ownerId, id);
      return NextResponse.json(
        { account, reconciliation },
        { status: 200, headers: NO_STORE },
      );
    } catch (error) {
      return mapServiceError(error);
    }
  });
}