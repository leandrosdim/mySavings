import { logout, type LogoutResult } from "@/lib/auth/dal";
import { NextResponse } from "next/server";
import { validateRequestOrigin, getSafeLogoutRedirect } from "@/lib/auth/origin";
import { buildSessionClearCookieHeader } from "@/lib/auth/session";

export async function POST(request: Request): Promise<NextResponse> {
  const originCheck = validateRequestOrigin(request.headers);
  if (!originCheck.valid) {
    // bad_config is a SERVER config fault, not a client forbidden request:
    // respond 503 no-store with a safe config error message and DO NOT clear
    // the cookie (a misconfigured origin gate must not be leveraged to wipe
    // the user's session cookie). missing/malformed/not_configured/mismatch
    // remain genuine client forbidden requests: 403, no Set-Cookie, no-store.
    // A same-site attacker that cannot pass origin validation also cannot
    // legitimately log the user out, and a forced cookie-clear would itself
    // be a cross-site logout CSRF.
    if (originCheck.reason === "bad_config") {
      return new NextResponse(
        JSON.stringify({
          error:
            "Logout is temporarily unavailable due to a server configuration error. Please contact the operator.",
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      );
    }
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result: LogoutResult = await logout();
  const clearCookie = buildSessionClearCookieHeader();
  const redirectUrl = new URL(getSafeLogoutRedirect());

  if (result.dbError) {
    // Honest 503: the server-side session revocation failed. We clear the
    // local cookie (so the user is effectively logged out on this device)
    // but we do NOT return a normal 303 success redirect. The response
    // carries Cache-Control: no-store and a Set-Cookie that clears the
    // session cookie, plus a safe retry/recovery message. The unrevoked
    // server session will expire naturally per SESSION_TTL_SECONDS.
    return new NextResponse(
      JSON.stringify({
        error:
          "Logout partially failed: your local session was cleared, but the server could not revoke the session record. It will expire automatically. Please try signing in again.",
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": clearCookie,
          "Cache-Control": "no-store",
        },
      },
    );
  }

  // Success: revoke committed, cookie cleared. Normal 303 redirect.
  return NextResponse.redirect(redirectUrl, {
    status: 303,
    headers: {
      "Set-Cookie": clearCookie,
      "Cache-Control": "no-store",
    },
  });
}