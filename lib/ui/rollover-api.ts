"use client";

// Client-side API helpers for the month rollover preview/apply flow.
//
// All helpers call the real route handlers. Errors are mapped to Greek strings
// for inline display. No financial logic is duplicated here — the server
// validates everything.

import type {
  RolloverPreview,
  ApplyRolloverResult,
  ReleaseChoice,
} from "@/lib/rollover/types";
import type { Cents } from "@/lib/finance/money";

export type ApiError = { error: string };

async function getJson<T>(
  url: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; stalePreview?: boolean }> {
  const res = await fetch(url, { method: "GET" });
  if (res.ok) {
    const data = (await res.json()) as T;
    return { ok: true, data };
  }
  let errorText = `Σφάλμα ${res.status}`;
  let stalePreview: boolean | undefined;
  try {
    const err = (await res.json()) as ApiError & { stalePreview?: boolean };
    if (err && typeof err.error === "string") errorText = err.error;
    if (err && typeof err.stalePreview === "boolean") stalePreview = err.stalePreview;
  } catch {
    // keep default
  }
  return { ok: false, status: res.status, error: errorText, stalePreview };
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; stalePreview?: boolean }> {
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
  let stalePreview: boolean | undefined;
  try {
    const err = (await res.json()) as ApiError & { stalePreview?: boolean };
    if (err && typeof err.error === "string") errorText = err.error;
    if (err && typeof err.stalePreview === "boolean") stalePreview = err.stalePreview;
  } catch {
    // keep default
  }
  return { ok: false, status: res.status, error: errorText, stalePreview };
}

export async function fetchRolloverPreview(
  sourceMonthKey: string,
): Promise<
  { ok: true; preview: RolloverPreview } | { ok: false; error: string }
> {
  const result = await getJson<RolloverPreview>(
    `/api/rollover/preview?sourceMonthKey=${encodeURIComponent(sourceMonthKey)}`,
  );
  if (result.ok) return { ok: true, preview: result.data };
  return { ok: false, error: result.error };
}

export async function applyRolloverApi(input: {
  sourceMonthKey: string;
  savingsTargetCents: Cents;
  previewDigest: string;
  releaseChoices: ReleaseChoice[];
  carryIncomeIds: string[];
  idempotencyKey: string;
}): Promise<
  | { ok: true; result: ApplyRolloverResult }
  | { ok: false; error: string; stalePreview?: boolean }
> {
  const result = await postJson<ApplyRolloverResult>("/api/rollover/apply", {
    sourceMonthKey: input.sourceMonthKey,
    savingsTargetCents: input.savingsTargetCents,
    previewDigest: input.previewDigest,
    releaseChoices: input.releaseChoices,
    carryIncomeIds: input.carryIncomeIds,
    idempotencyKey: input.idempotencyKey,
  });
  if (result.ok) return { ok: true, result: result.data };
  return { ok: false, error: result.error, stalePreview: result.stalePreview };
}