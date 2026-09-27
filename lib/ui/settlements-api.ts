"use client";

// Client-side API helpers for the settlements backend (Step10 routes).
//
// All helpers POST to the real /api/settlements/* and /api/receipts/* route
// handlers. Responses are typed and errors are mapped to human-readable
// Greek strings for inline display. No financial logic is duplicated here —
// the server validates everything. The RefreshReconciliationRequiredError
// surface (requiresRefreshReconciliation + settlementId) is propagated so the
// UI can prompt for an explicit balance-effect decision.

import type {
  PayResult,
  ReceiveResult,
  ReverseSettlementResult,
  ReverseReceiptResult,
  SettlementHistoryEntry,
  ReceiptHistoryEntry,
  SettlementMode,
} from "@/lib/settlements/types";

export type ApiError = {
  error: string;
  requiresRefreshReconciliation?: boolean;
  settlementId?: string;
};

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      error: string;
      requiresRefreshReconciliation?: boolean;
      settlementId?: string;
    }
> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const data = (await res.json()) as T;
    return { ok: true, data };
  }
  let errorText = `Σφάλμα ${res.status}`;
  let requiresRefreshReconciliation: boolean | undefined;
  let settlementId: string | undefined;
  try {
    const err = (await res.json()) as ApiError;
    if (err && typeof err.error === "string") errorText = err.error;
    if (typeof err.requiresRefreshReconciliation === "boolean") {
      requiresRefreshReconciliation = err.requiresRefreshReconciliation;
    }
    if (typeof err.settlementId === "string") {
      settlementId = err.settlementId;
    }
  } catch {
    // keep default
  }
  return {
    ok: false,
    status: res.status,
    error: errorText,
    requiresRefreshReconciliation,
    settlementId,
  };
}

async function getJson<T>(
  url: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url);
  if (res.ok) {
    const data = (await res.json()) as T;
    return { ok: true, data };
  }
  let errorText = `Σφάλμα ${res.status}`;
  try {
    const err = (await res.json()) as ApiError;
    if (err && typeof err.error === "string") errorText = err.error;
  } catch {
    // keep default
  }
  return { ok: false, status: res.status, error: errorText };
}

// --- Payments (expense settlements) ---

export async function payObligationApi(input: {
  obligationId: string;
  amountCents: number;
  mode: SettlementMode;
  accountId: string | null;
  businessDate: string;
  idempotencyKey: string;
}): Promise<
  | { ok: true; result: PayResult }
  | { ok: false; error: string }
> {
  const result = await postJson<PayResult>("/api/settlements/pay", {
    obligationId: input.obligationId,
    amountCents: input.amountCents,
    mode: input.mode,
    accountId: input.accountId,
    businessDate: input.businessDate,
    idempotencyKey: input.idempotencyKey,
  });
  if (result.ok) return { ok: true, result: result.data };
  return { ok: false, error: result.error };
}

// --- Receipts (income) ---

export async function receiveIncomeApi(input: {
  incomeExpectationId: string;
  amountCents: number;
  mode: SettlementMode;
  accountId: string | null;
  businessDate: string;
  idempotencyKey: string;
}): Promise<
  | { ok: true; result: ReceiveResult }
  | { ok: false; error: string }
> {
  const result = await postJson<ReceiveResult>("/api/settlements/receive", {
    incomeExpectationId: input.incomeExpectationId,
    amountCents: input.amountCents,
    mode: input.mode,
    accountId: input.accountId,
    businessDate: input.businessDate,
    idempotencyKey: input.idempotencyKey,
  });
  if (result.ok) return { ok: true, result: result.data };
  return { ok: false, error: result.error };
}

// --- Reversals ---

export async function reverseSettlementApi(input: {
  settlementId: string;
  businessDate: string;
  idempotencyKey: string;
  reason?: string;
  adjustBalanceAfterRefresh?: boolean;
}): Promise<
  | { ok: true; result: ReverseSettlementResult }
  | {
      ok: false;
      error: string;
      requiresRefreshReconciliation?: boolean;
      settlementId?: string;
    }
> {
  const result = await postJson<ReverseSettlementResult>(
    "/api/settlements/reverse",
    {
      settlementId: input.settlementId,
      businessDate: input.businessDate,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      adjustBalanceAfterRefresh: input.adjustBalanceAfterRefresh,
    },
  );
  if (result.ok) return { ok: true, result: result.data };
  return {
    ok: false,
    error: result.error,
    requiresRefreshReconciliation: result.requiresRefreshReconciliation,
    settlementId: result.settlementId,
  };
}

export async function reverseReceiptApi(input: {
  receiptId: string;
  businessDate: string;
  idempotencyKey: string;
  reason?: string;
  adjustBalanceAfterRefresh?: boolean;
}): Promise<
  | { ok: true; result: ReverseReceiptResult }
  | {
      ok: false;
      error: string;
      requiresRefreshReconciliation?: boolean;
      settlementId?: string;
    }
> {
  const result = await postJson<ReverseReceiptResult>("/api/receipts/reverse", {
    receiptId: input.receiptId,
    businessDate: input.businessDate,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    adjustBalanceAfterRefresh: input.adjustBalanceAfterRefresh,
  });
  if (result.ok) return { ok: true, result: result.data };
  return {
    ok: false,
    error: result.error,
    requiresRefreshReconciliation: result.requiresRefreshReconciliation,
    settlementId: result.settlementId,
  };
}

// --- History ---

export async function listSettlementHistoryApi(
  obligationId: string,
): Promise<
  | { ok: true; settlements: SettlementHistoryEntry[] }
  | { ok: false; error: string }
> {
  const result = await getJson<{ settlements: SettlementHistoryEntry[] }>(
    `/api/obligations/${obligationId}/settlements`,
  );
  if (result.ok) return { ok: true, settlements: result.data.settlements };
  return { ok: false, error: result.error };
}

export async function listReceiptHistoryApi(
  incomeExpectationId: string,
): Promise<
  | { ok: true; receipts: ReceiptHistoryEntry[] }
  | { ok: false; error: string }
> {
  const result = await getJson<{ receipts: ReceiptHistoryEntry[] }>(
    `/api/income/${incomeExpectationId}/receipts`,
  );
  if (result.ok) return { ok: true, receipts: result.data.receipts };
  return { ok: false, error: result.error };
}