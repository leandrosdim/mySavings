"use client";

// Client-side API helpers for history and exports.

import type {
  HistorySummary,
  ClosingSnapshot,
} from "@/lib/history/types";

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

// --- History ---

export async function listHistoryApi(): Promise<
  { ok: true; summaries: HistorySummary[] } | { ok: false; error: string }
> {
  const result = await getJson<{ summaries: HistorySummary[] }>("/api/history");
  if (result.ok) return { ok: true, summaries: result.data.summaries };
  return { ok: false, error: result.error };
}

export async function getSnapshotApi(
  monthKey: string,
): Promise<
  { ok: true; snapshot: ClosingSnapshot } | { ok: false; error: string }
> {
  const result = await getJson<{ snapshot: ClosingSnapshot }>(
    `/api/history/${monthKey}`,
  );
  if (result.ok) return { ok: true, snapshot: result.data.snapshot };
  return { ok: false, error: result.error };
}

export async function closeMonthApi(
  monthKey: string,
): Promise<
  { ok: true; snapshot: ClosingSnapshot } | { ok: false; error: string }
> {
  const result = await postJson<{ snapshot: ClosingSnapshot }>(
    "/api/history/close",
    { monthKey },
  );
  if (result.ok) return { ok: true, snapshot: result.data.snapshot };
  return { ok: false, error: result.error };
}

// --- Exports ---

/**
 * Trigger a browser download for an authenticated export URL.
 *
 * Uses a temporary anchor element with the `download` attribute so the browser
 * treats the navigation as a file download rather than a route transition.
 * The authenticated session cookie is sent automatically because the request
 * is same-origin.
 */
function triggerDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Trigger a browser download for the CSV export of a month. */
export function downloadCsv(monthKey: string): void {
  triggerDownload(`/api/exports/csv?month=${encodeURIComponent(monthKey)}`);
}

/** Trigger a browser download for the JSON backup of a month. */
export function downloadJson(monthKey: string): void {
  triggerDownload(`/api/exports/json?month=${encodeURIComponent(monthKey)}`);
}