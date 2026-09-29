"use client";

// Client-side helpers for form state: idempotency key generation and
// euro-to-cents parsing that mirrors lib/finance/money.parseEur.

import { parseEur, type Cents } from "@/lib/finance/money";

/** Generate a random idempotency key for a mutating operation. */
export function newIdempotencyKey(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

/**
 * Parse a euro string into Cents, returning an error message on failure
 * (Greek). Does not throw — suitable for inline form validation.
 */
export function parseEurosInput(
  raw: string,
): { ok: true; cents: Cents } | { ok: false; error: string } {
  try {
    const c = parseEur(raw);
    return { ok: true, cents: c };
  } catch {
    return {
      ok: false,
      error: "Μη έγκυρο ποσό. Χρησιμοποίησε μορφή όπως 80 ή 80,00.",
    };
  }
}

/** Format today's date as YYYY-MM-DD in Europe/Athens. */
export function todayAthensDate(): string {
  const now = new Date();
  const athens = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Athens",
  });
  return athens.format(now);
}

/**
 * Online-only guard for financial submissions. Returns true and a Greek
 * error message when the device is known to be offline. The server remains
 * the source of truth and validates everything regardless; this guard only
 * prevents firing a request that is certain to fail and avoids any local
 * retry queue. There is intentionally NO background replay.
 */
export function offlineSubmitGuard(): { ok: false; error: string } | { ok: true } {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      ok: false,
      error:
        "Χωρίς σύνδεση: η οικονομική εγγραφή απαιτεί σύνδεση στον διακομιστή. Δοκίμασε ξανά όταν επανασυνδεθείς.",
    };
  }
  return { ok: true };
}