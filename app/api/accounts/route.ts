// GET /api/accounts — list non-archived accounts for the authenticated owner.

import { NextResponse, type NextRequest } from "next/server";
import { listAccounts } from "@/lib/accounts/service";
import { handleGet } from "@/lib/accounts/routes";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleGet(request, async (owner) => {
    const accounts = await listAccounts(owner.ownerId);
    return NextResponse.json({ accounts }, { status: 200, headers: { "Cache-Control": "no-store" } });
  });
}