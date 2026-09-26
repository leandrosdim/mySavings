import { NextResponse, type NextRequest } from "next/server";
import { unsealData } from "iron-session";

const SESSION_COOKIE_NAME = "mysavings_session";
const SESSION_SECRET_KEY = "SESSION_SECRET";
const PUBLIC_PATHS = new Set(["/", "/login"]);

function readSessionSecret(): string | null {
  const value = process.env[SESSION_SECRET_KEY];
  if (typeof value !== "string" || value.length < 32) {
    return null;
  }
  return value;
}

type SealedPayload = {
  sessionId?: string;
};

async function hasValidSessionCookie(req: NextRequest): Promise<boolean> {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    return false;
  }
  const secret = readSessionSecret();
  if (!secret) {
    return false;
  }
  try {
    const payload = await unsealData<SealedPayload>(cookieValue, {
      password: secret,
    });
    return typeof payload.sessionId === "string" && payload.sessionId.length > 0;
  } catch {
    return false;
  }
}

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.has(path) || path.startsWith("/login");
  const hasSession = await hasValidSessionCookie(req);

  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isPublic && hasSession && path === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};