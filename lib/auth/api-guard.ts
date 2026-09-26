import "server-only";
import { NextResponse } from "next/server";
import { resolveSessionDetailed } from "./session";
import type { AuthenticatedSession } from "./session";

export type ApiGuardResult =
  | { ok: true; session: AuthenticatedSession }
  | { ok: false; response: NextResponse };

export async function requireApiSession(): Promise<ApiGuardResult> {
  const outcome = await resolveSessionDetailed();
  if (outcome.status === "valid") {
    return { ok: true, session: outcome.session };
  }
  if (outcome.status === "unavailable") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503 },
      ),
    };
  }
  return {
    ok: false,
    response: NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    ),
  };
}

export async function requireApiUser(): Promise<
  { ok: true; userId: string; email: string } | { ok: false; response: NextResponse }
> {
  const guard = await requireApiSession();
  if (!guard.ok) {
    return { ok: false, response: guard.response };
  }
  return {
    ok: true,
    userId: guard.session.userId,
    email: guard.session.email,
  };
}