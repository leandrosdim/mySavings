"use client";

// Client-side API helpers for obligations (expenses/reserves) and income
// expectations.
//
// All helpers POST/PATCH to the real route handlers. Errors are mapped to
// Greek strings for inline display. No financial logic is duplicated here —
// the server validates everything.

import type { Obligation, ObligationKind } from "@/lib/obligations/types";
import type { IncomeExpectation } from "@/lib/income/types";

export type ApiError = { error: string };

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
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
  try {
    const err = (await res.json()) as ApiError;
    if (err && typeof err.error === "string") errorText = err.error;
  } catch {
    // keep default
  }
  return { ok: false, status: res.status, error: errorText };
}

async function patchJson<T>(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
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

// --- Obligations ---

export async function listObligationsApi(filter?: {
  monthKey?: string;
  kind?: ObligationKind;
  status?: string;
  includeReserved?: boolean;
}): Promise<
  { ok: true; obligations: Obligation[] } | { ok: false; error: string }
> {
  const params = new URLSearchParams();
  if (filter?.monthKey) params.set("monthKey", filter.monthKey);
  if (filter?.kind) params.set("kind", filter.kind);
  if (filter?.status) params.set("status", filter.status);
  if (filter?.includeReserved) params.set("includeReserved", "true");
  const qs = params.toString();
  const url = `/api/obligations${qs ? `?${qs}` : ""}`;
  const result = await getJson<{ obligations: Obligation[] }>(url);
  if (result.ok) return { ok: true, obligations: result.data.obligations };
  return { ok: false, error: result.error };
}

export async function createObligationApi(input: {
  kind: ObligationKind;
  title: string;
  plannedCents: number;
  monthKey: string;
  dueDate?: string | null;
  linkedAccountId?: string | null;
  linkedReserveId?: string | null;
}): Promise<
  { ok: true; obligation: Obligation } | { ok: false; error: string }
> {
  const result = await postJson<{ obligation: Obligation }>(
    "/api/obligations/create",
    {
      kind: input.kind,
      title: input.title,
      plannedCents: input.plannedCents,
      monthKey: input.monthKey,
      dueDate: input.dueDate ?? null,
      linkedAccountId: input.linkedAccountId ?? null,
      linkedReserveId: input.linkedReserveId ?? null,
    },
  );
  if (result.ok) return { ok: true, obligation: result.data.obligation };
  return { ok: false, error: result.error };
}

export async function updateObligationApi(
  obligationId: string,
  input: {
    title?: string;
    plannedCents?: number;
    dueDate?: string | null;
    linkedAccountId?: string | null;
    linkedReserveId?: string | null;
  },
): Promise<
  { ok: true; obligation: Obligation } | { ok: false; error: string }
> {
  const result = await patchJson<{ obligation: Obligation }>(
    `/api/obligations/${obligationId}`,
    input,
  );
  if (result.ok) return { ok: true, obligation: result.data.obligation };
  return { ok: false, error: result.error };
}

export async function cancelObligationApi(
  obligationId: string,
): Promise<
  { ok: true; obligation: Obligation } | { ok: false; error: string }
> {
  const result = await postJson<{ obligation: Obligation }>(
    `/api/obligations/${obligationId}/cancel`,
    {},
  );
  if (result.ok) return { ok: true, obligation: result.data.obligation };
  return { ok: false, error: result.error };
}

export async function deleteReleasedObligationApi(
  obligationId: string,
): Promise<{ ok: true; obligationId: string } | { ok: false; error: string }> {
  const result = await postJson<{ obligationId: string }>(
    `/api/obligations/${obligationId}/delete`,
    {},
  );
  if (result.ok) return { ok: true, obligationId: result.data.obligationId };
  return { ok: false, error: result.error };
}

export async function releaseObligationApi(
  obligationId: string,
): Promise<
  { ok: true; obligation: Obligation } | { ok: false; error: string }
> {
  const result = await postJson<{ obligation: Obligation }>(
    `/api/obligations/${obligationId}/release`,
    {},
  );
  if (result.ok) return { ok: true, obligation: result.data.obligation };
  return { ok: false, error: result.error };
}

// --- Income ---

export async function listIncomeApi(filter?: {
  monthKey?: string;
  status?: string;
}): Promise<
  { ok: true; income: IncomeExpectation[] } | { ok: false; error: string }
> {
  const params = new URLSearchParams();
  if (filter?.monthKey) params.set("monthKey", filter.monthKey);
  if (filter?.status) params.set("status", filter.status);
  const qs = params.toString();
  const url = `/api/income${qs ? `?${qs}` : ""}`;
  const result = await getJson<{ income: IncomeExpectation[] }>(url);
  if (result.ok) return { ok: true, income: result.data.income };
  return { ok: false, error: result.error };
}

export async function createIncomeApi(input: {
  monthKey: string;
  sourceName: string;
  expectedCents: number;
  linkedAccountId?: string | null;
}): Promise<
  { ok: true; income: IncomeExpectation } | { ok: false; error: string }
> {
  const result = await postJson<{ income: IncomeExpectation }>(
    "/api/income/create",
    {
      monthKey: input.monthKey,
      sourceName: input.sourceName,
      expectedCents: input.expectedCents,
      linkedAccountId: input.linkedAccountId ?? null,
    },
  );
  if (result.ok) return { ok: true, income: result.data.income };
  return { ok: false, error: result.error };
}

export async function updateIncomeApi(
  incomeId: string,
  input: {
    sourceName?: string;
    expectedCents?: number;
    linkedAccountId?: string | null;
  },
): Promise<
  { ok: true; income: IncomeExpectation } | { ok: false; error: string }
> {
  const result = await patchJson<{ income: IncomeExpectation }>(
    `/api/income/${incomeId}`,
    input,
  );
  if (result.ok) return { ok: true, income: result.data.income };
  return { ok: false, error: result.error };
}

export async function cancelIncomeApi(
  incomeId: string,
): Promise<
  { ok: true; income: IncomeExpectation } | { ok: false; error: string }
> {
  const result = await postJson<{ income: IncomeExpectation }>(
    `/api/income/${incomeId}/cancel`,
    {},
  );
  if (result.ok) return { ok: true, income: result.data.income };
  return { ok: false, error: result.error };
}