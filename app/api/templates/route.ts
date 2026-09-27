// GET /api/templates — list all recurring templates for the authenticated owner.

import { NextResponse, type NextRequest } from "next/server";
import { listTemplates } from "@/lib/templates/service";
import { handleGet, NO_STORE } from "@/lib/finance-routes";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleGet(request, async (owner) => {
    const templates = await listTemplates(owner.ownerId);
    return NextResponse.json({ templates }, { status: 200, headers: NO_STORE });
  });
}