"use client";

// Client-side API helpers for the accounts backend.
//
// All helpers POST to the real Step06 route handlers. Mutating requests
// include the Origin header so the server-side CSRF/origin check passes in
// dev (TRUSTED_ORIGIN_DEV must match the request origin). Responses are typed
// and errors are mapped to human-readable Greek strings for inline display.
// No financial logic is duplicated here — the server validates everything.

import type {
  Account,
  BalanceRefreshResult,
  TransferResult,
} from "@/lib/accounts/types";
import type { Cents } from "@/lib/finance/money";

export type AccountsApiResponse = {
  accounts: Account[];
};

export type AccountDetailApiResponse = {
  account: Account;
  reconciliation: { needsReconciliation: boolean; pendingMovementCount: number };
};

export type ApiError = {
  error: string;
  currentVersion?: number;
};

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; currentVersion?: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const data = (await res.json()) as T;
    return { ok: true, data };
  }
  let errorText = `Σφάλμα ${res.status}`;
  let currentVersion: number | undefined;
  try {
    const err = (await res.json()) as ApiError;
    if (err && typeof err.error === "string") errorText = err.error;
    if (typeof err.currentVersion === "number") currentVersion = err.currentVersion;
  } catch {
    // keep default
  }
  return { ok: false, status: res.status, error: errorText, currentVersion };
}

async function patchJson<T>(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
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

export type CreateAccountResponse = { account: Account };

export async function createAccountApi(input: {
  name: string;
  initialBalanceCents: number | null;
  trackBalance: boolean;
  idempotencyKey: string;
}): Promise<
  { ok: true; account: Account } | { ok: false; error: string }
> {
  const result = await postJson<CreateAccountResponse>(
    "/api/accounts/create",
    {
      name: input.name,
      initialBalanceCents: input.initialBalanceCents,
      trackBalance: input.trackBalance,
    },
  );
  if (result.ok) return { ok: true, account: result.data.account };
  return { ok: false, error: result.error };
}

export type RenameAccountResponse = { account: Account };

export async function renameAccountApi(
  accountId: string,
  name: string,
): Promise<
  { ok: true; account: Account } | { ok: false; error: string }
> {
  const result = await patchJson<RenameAccountResponse>(
    `/api/accounts/${accountId}/rename`,
    { name },
  );
  if (result.ok) return { ok: true, account: result.data.account };
  return { ok: false, error: result.error };
}

export async function archiveAccountApi(
  accountId: string,
): Promise<
  { ok: true; account: Account } | { ok: false; error: string }
> {
  const result = await postJson<{ account: Account }>(
    `/api/accounts/${accountId}/archive`,
    {},
  );
  if (result.ok) return { ok: true, account: result.data.account };
  return { ok: false, error: result.error };
}

export async function refreshBalanceApi(
  accountId: string,
  input: {
    newBalanceCents: Cents;
    expectedVersion: number;
    idempotencyKey: string;
    reason?: string;
  },
): Promise<
  | { ok: true; result: BalanceRefreshResult }
  | { ok: false; error: string; currentVersion?: number }
> {
  const result = await postJson<BalanceRefreshResult>(
    `/api/accounts/${accountId}/refresh`,
    {
      newBalanceCents: input.newBalanceCents,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    },
  );
  if (result.ok) return { ok: true, result: result.data };
  return {
    ok: false,
    error: result.error,
    currentVersion: result.currentVersion,
  };
}

export async function transferApi(input: {
  fromAccountId: string;
  toAccountId: string;
  amountCents: Cents;
  businessDate: string;
  idempotencyKey: string;
}): Promise<
  | { ok: true; result: TransferResult }
  | { ok: false; error: string }
> {
  const result = await postJson<TransferResult>("/api/accounts/transfer", {
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    amountCents: input.amountCents,
    businessDate: input.businessDate,
    idempotencyKey: input.idempotencyKey,
  });
  if (result.ok) return { ok: true, result: result.data };
  return { ok: false, error: result.error };
}