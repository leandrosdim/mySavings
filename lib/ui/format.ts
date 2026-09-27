// Greek locale formatting helpers for the UI.
//
// These are pure functions with no React/server-only imports so they are safe
// to reuse in both server and client components and in unit tests. Money is
// formatted using the Greek el-GR convention (comma decimal, space grouping)
// while the underlying stored value is integer cents — no floating-point is
// used here.

import type { Cents } from "@/lib/finance/money";

/** EUR symbol constant used by all currency formatters. */
export const EUR_SYMBOL = "€";

const elInteger = new Intl.NumberFormat("el-GR", {
  maximumFractionDigits: 0,
});

/**
 * Format a Cents value as a Greek EUR string, e.g. 8040 -> "80,40 €".
 * Negative amounts are prefixed with a minus sign. The underlying conversion
 * to euros uses integer math only (floor division and modulo), never
 * floating-point. Accepts plain number for display of computed differences.
 */
export function formatEurEl(centsValue: Cents | number): string {
  const negative = centsValue < 0;
  const abs = Math.abs(centsValue);
  const euros = Math.floor(abs / 100);
  const centsPart = abs % 100;
  const formatted = `${elInteger.format(euros)},${centsPart
    .toString()
    .padStart(2, "0")}`;
  const sign = negative ? "−" : "";
  return `${sign}${formatted} ${EUR_SYMBOL}`;
}

/**
 * Format an absolute Cents value without sign, for preview rows.
 */
export function formatEurAbs(centsValue: Cents | number): string {
  return formatEurEl(Math.abs(centsValue));
}

/**
 * Format a signed difference with an explicit Greek sign prefix.
 * Used for balance-refresh previews: "+50,00 €" or "−30,00 €".
 */
export function formatEurDelta(centsValue: Cents | number): string {
  if (centsValue === 0) return `±0,00 ${EUR_SYMBOL}`;
  const sign = centsValue > 0 ? "+" : "−";
  return `${sign}${formatEurAbs(centsValue)}`;
}

const elDate = new Intl.DateTimeFormat("el-GR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Athens",
});

const elDateTime = new Intl.DateTimeFormat("el-GR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Athens",
});

/** Format an ISO timestamp as a Greek date (Europe/Athens). */
export function formatDateEl(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return elDate.format(d);
}

/** Format an ISO timestamp as a Greek date+time (Europe/Athens). */
export function formatDateTimeEl(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return elDateTime.format(d);
}

/**
 * Compute a short Greek freshness label relative to now.
 * Returns "μόλις τώρα" (<60s), "πριν X λεπτά", "πριν X ώρες",
 * "πριν X μέρες", or the formatted date for older values.
 */
export function freshnessLabel(
  iso: string | null,
  now: number = Date.now(),
): string {
  if (!iso) return "Δεν έχει οριστεί";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Δεν έχει οριστεί";
  const diffMs = now - d.getTime();
  if (diffMs < 0) return formatDateEl(iso) ?? "—";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "μόλις τώρα";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `πριν ${minutes} λεπτ${minutes === 1 ? "ό" : "ά"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `πριν ${hours} ώρ${hours === 1 ? "α" : "ες"}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `πριν ${days} μέρ${days === 1 ? "α" : "ες"}`;
  return formatDateEl(iso) ?? "—";
}