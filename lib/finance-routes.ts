// Shared route-handler helpers for the plan and template APIs.
//
// Mirrors lib/accounts/routes.ts but handles PlanServiceError and
// TemplateServiceError hierarchies. Every route handler:
// 1. Validates the request origin (CSRF protection for mutating routes).
// 2. Resolves the authenticated owner from the server session via
//    requireApiUser — never from client input.
// 3. Maps service errors to appropriate HTTP responses.

import { NextResponse, type NextRequest } from "next/server";
import { requireApiUser } from "./auth/api-guard";
import { validateRequestOrigin } from "./auth/origin";
import {
  PlanServiceError,
  PlanValidationError,
  PlanNotFoundError,
  PlanConflictError,
  ClosedMonthError as PlanClosedMonthError,
} from "./months/types";
import {
  TemplateServiceError,
  TemplateValidationError,
  TemplateNotFoundError,
  TemplateConflictError,
} from "./templates/types";
import {
  ObligationServiceError,
  ObligationValidationError,
  ObligationNotFoundError,
  ObligationConflictError,
  ClosedMonthError as ObligationClosedMonthError,
  SettledHistoryError,
} from "./obligations/types";
import {
  IncomeServiceError,
  IncomeValidationError,
  IncomeNotFoundError,
  IncomeConflictError,
  IncomeClosedMonthError,
  ReceiptHistoryError,
} from "./income/types";
import {
  SettlementServiceError,
  SettlementValidationError,
  SettlementNotFoundError,
  SettlementConflictError,
  IdempotencyConflictError as SettlementIdempotencyConflictError,
  OverpaymentError,
  ClosedMonthError as SettlementClosedMonthError,
  AlreadyReversedError,
  RefreshReconciliationRequiredError,
} from "./settlements/types";
import {
  RolloverServiceError,
  RolloverValidationError,
  RolloverConflictError,
  RolloverClosedMonthError,
  RolloverStalePreviewError,
  RolloverIdempotencyConflictError,
} from "./rollover/types";
import type { OwnerId } from "./months/types";

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

/** Map a Plan, Template, Obligation or Income service error to a JSON NextResponse. */
export function mapServiceError(error: unknown): NextResponse {
  if (
    error instanceof PlanValidationError ||
    error instanceof TemplateValidationError ||
    error instanceof ObligationValidationError ||
    error instanceof IncomeValidationError
  ) {
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: NO_STORE },
    );
  }
  if (
    error instanceof PlanNotFoundError ||
    error instanceof TemplateNotFoundError ||
    error instanceof ObligationNotFoundError ||
    error instanceof IncomeNotFoundError
  ) {
    return NextResponse.json(
      { error: error.message },
      { status: 404, headers: NO_STORE },
    );
  }
  if (
    error instanceof PlanConflictError ||
    error instanceof TemplateConflictError ||
    error instanceof ObligationConflictError ||
    error instanceof IncomeConflictError
  ) {
    return NextResponse.json(
      { error: error.message },
      { status: 409, headers: NO_STORE },
    );
  }
  if (
    error instanceof PlanClosedMonthError ||
    error instanceof ObligationClosedMonthError ||
    error instanceof IncomeClosedMonthError
  ) {
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: NO_STORE },
    );
  }
  if (error instanceof SettledHistoryError || error instanceof ReceiptHistoryError) {
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: NO_STORE },
    );
  }
  if (
    error instanceof SettlementIdempotencyConflictError ||
    error instanceof SettlementConflictError
  ) {
    return NextResponse.json(
      { error: error.message },
      { status: 409, headers: NO_STORE },
    );
  }
  if (error instanceof OverpaymentError) {
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: NO_STORE },
    );
  }
  if (error instanceof AlreadyReversedError) {
    return NextResponse.json(
      { error: error.message },
      { status: 409, headers: NO_STORE },
    );
  }
  if (error instanceof RefreshReconciliationRequiredError) {
    const body: { error: string; requiresRefreshReconciliation: boolean; settlementId?: string } = {
      error: error.message,
      requiresRefreshReconciliation: true,
    };
    if (error.settlementId !== null) {
      body.settlementId = error.settlementId;
    }
    return NextResponse.json(body, { status: 409, headers: NO_STORE });
  }
  if (
    error instanceof SettlementValidationError ||
    error instanceof SettlementNotFoundError ||
    error instanceof SettlementClosedMonthError
  ) {
    const status = error instanceof SettlementNotFoundError ? 404 : 400;
    return NextResponse.json(
      { error: error.message },
      { status, headers: NO_STORE },
    );
  }
  if (
    error instanceof RolloverValidationError ||
    error instanceof RolloverConflictError
  ) {
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: NO_STORE },
    );
  }
  if (error instanceof RolloverClosedMonthError) {
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: NO_STORE },
    );
  }
  if (error instanceof RolloverStalePreviewError) {
    return NextResponse.json(
      {
        error: error.message,
        stalePreview: true,
      },
      { status: 409, headers: NO_STORE },
    );
  }
  if (error instanceof RolloverIdempotencyConflictError) {
    return NextResponse.json(
      { error: error.message },
      { status: 409, headers: NO_STORE },
    );
  }
  if (
    error instanceof PlanServiceError ||
    error instanceof TemplateServiceError ||
    error instanceof ObligationServiceError ||
    error instanceof IncomeServiceError ||
    error instanceof SettlementServiceError ||
    error instanceof RolloverServiceError
  ) {
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
export async function parseJsonBody(
  request: NextRequest,
): Promise<Record<string, unknown> | null> {
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

/** Wrap an authenticated POST handler with origin check + error mapping. */
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

/** Wrap an authenticated PATCH handler with origin check + error mapping. */
export async function handlePatch(
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