// Shared route-handler helpers for the accounts API.
//
// Every accounts route handler:
// 1. Validates the request origin (CSRF protection for mutating routes).
// 2. Resolves the authenticated owner from the server session via
//    requireApiUser — never from client input.
// 3. Maps AccountServiceError subclasses to appropriate HTTP responses.

import { NextResponse, type NextRequest } from "next/server";
import { requireApiUser } from "../auth/api-guard";
import { validateRequestOrigin } from "../auth/origin";
import {
  AccountServiceError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ArchiveRestrictedError,
  IdempotencyConflictError,
} from "./types";
import type { OwnerId } from "./types";

export const NO_STORE = { "Cache-Control": "no-store" };

export type AuthenticatedOwner = { ownerId: OwnerId; email: string };

/** Resolve the authenticated owner or return a 401/503 NextResponse. */
export async function resolveOwner(): Promise<
  { ok: true; owner: AuthenticatedOwner } | { ok: false; response: NextResponse }
> {
  const guard = await requireApiUser();
  if (!guard.ok) {
    return { ok: false, response: guard.response };
  }
  return { ok: true, owner: { ownerId: guard.userId, email: guard.email } };
}

/** Validate the request origin for mutating routes. Returns null on success, or a 403/503 response. */
export function checkOrigin(request: NextRequest): NextResponse | null {
  const originCheck = validateRequestOrigin(request.headers);
  if (originCheck.valid) {
    return null;
  }
  if (originCheck.reason === "bad_config") {
    return NextResponse.json(
      { error: "Service temporarily unavailable due to a configuration error" },
      { status: 503, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    { error: "Forbidden" },
    { status: 403, headers: NO_STORE },
  );
}

/** Map an AccountServiceError to a JSON NextResponse. */
export function mapServiceError(error: unknown): NextResponse {
  if (error instanceof ValidationError) {
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: NO_STORE },
    );
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json(
      { error: error.message },
      { status: 404, headers: NO_STORE },
    );
  }
  if (error instanceof ConflictError) {
    const body: { error: string; currentVersion?: number } = { error: error.message };
    if (error.currentVersion !== null) {
      body.currentVersion = error.currentVersion;
    }
    return NextResponse.json(body, { status: 409, headers: NO_STORE });
  }
  if (error instanceof ArchiveRestrictedError) {
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: NO_STORE },
    );
  }
  if (error instanceof IdempotencyConflictError) {
    return NextResponse.json(
      { error: error.message },
      { status: 409, headers: NO_STORE },
    );
  }
  if (error instanceof AccountServiceError) {
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500, headers: NO_STORE },
  );
}

/** Parse a JSON request body safely. Returns null on parse failure. */
export async function parseJsonBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return null;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Wrap an authenticated handler with origin check + error mapping. */
export async function handlePost(
  request: NextRequest,
  fn: (owner: AuthenticatedOwner, body: Record<string, unknown>) => Promise<NextResponse>,
): Promise<NextResponse> {
  const originResponse = checkOrigin(request);
  if (originResponse) {
    return originResponse;
  }
  const ownerResult = await resolveOwner();
  if (!ownerResult.ok) {
    return ownerResult.response;
  }
  const body = await parseJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE },
    );
  }
  try {
    return await fn(ownerResult.owner, body);
  } catch (error) {
    return mapServiceError(error);
  }
}

/** Wrap an authenticated GET handler with error mapping (no origin check needed for reads). */
export async function handleGet(
  request: NextRequest,
  fn: (owner: AuthenticatedOwner) => Promise<NextResponse>,
): Promise<NextResponse> {
  const ownerResult = await resolveOwner();
  if (!ownerResult.ok) {
    return ownerResult.response;
  }
  try {
    return await fn(ownerResult.owner);
  } catch (error) {
    return mapServiceError(error);
  }
}