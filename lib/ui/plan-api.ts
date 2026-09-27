"use client";

// Client-side API helpers for plans and templates.
//
// All helpers POST/PATCH to the real route handlers. Errors are mapped to
// Greek strings for inline display. No financial logic is duplicated here —
// the server validates everything.

import type { MonthlyPlan } from "@/lib/months/types";
import type { RecurringTemplate, TemplateKind } from "@/lib/templates/types";
import type { GenerationResult } from "@/lib/generation/service";
import type { Cents } from "@/lib/finance/money";

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

// --- Plans ---

export type CreatePlanResponse = { plan: MonthlyPlan; generated: boolean };

export async function createPlanApi(input: {
  monthKey: string;
  savingsTargetCents: number;
}): Promise<
  { ok: true; plan: MonthlyPlan; generated: boolean } | { ok: false; error: string }
> {
  const result = await postJson<CreatePlanResponse>("/api/plans/create", {
    monthKey: input.monthKey,
    savingsTargetCents: input.savingsTargetCents,
  });
  if (result.ok) return { ok: true, plan: result.data.plan, generated: result.data.generated };
  return { ok: false, error: result.error };
}

export async function updateTargetApi(
  planId: string,
  savingsTargetCents: number,
): Promise<
  { ok: true; plan: MonthlyPlan } | { ok: false; error: string }
> {
  const result = await patchJson<{ plan: MonthlyPlan }>(
    `/api/plans/${planId}/target`,
    { savingsTargetCents },
  );
  if (result.ok) return { ok: true, plan: result.data.plan };
  return { ok: false, error: result.error };
}

// --- Templates ---

export type CreateTemplateResponse = { template: RecurringTemplate };

export async function createTemplateApi(input: {
  name: string;
  kind: TemplateKind;
  defaultAmountCents: number;
  dueDayOfMonth: number | null;
  active: boolean;
}): Promise<
  { ok: true; template: RecurringTemplate } | { ok: false; error: string }
> {
  const result = await postJson<CreateTemplateResponse>("/api/templates/create", {
    name: input.name,
    kind: input.kind,
    defaultAmountCents: input.defaultAmountCents,
    dueDayOfMonth: input.dueDayOfMonth,
    active: input.active,
  });
  if (result.ok) return { ok: true, template: result.data.template };
  return { ok: false, error: result.error };
}

export async function updateTemplateApi(
  templateId: string,
  input: {
    name?: string;
    defaultAmountCents?: number;
    dueDayOfMonth?: number | null;
    active?: boolean;
  },
): Promise<
  { ok: true; template: RecurringTemplate } | { ok: false; error: string }
> {
  const result = await patchJson<{ template: RecurringTemplate }>(
    `/api/templates/${templateId}`,
    input,
  );
  if (result.ok) return { ok: true, template: result.data.template };
  return { ok: false, error: result.error };
}

// --- Generation ---

export async function generateMonthApi(
  monthKey?: string,
): Promise<
  { ok: true; result: GenerationResult } | { ok: false; error: string }
> {
  const body: Record<string, unknown> = {};
  if (monthKey) body.monthKey = monthKey;
  const result = await postJson<GenerationResult>("/api/generate", body);
  if (result.ok) return { ok: true, result: result.data };
  return { ok: false, error: result.error };
}

export type { Cents };