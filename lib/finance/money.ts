/**
 * Exact-cent money module for mySavings.
 *
 * EUR amounts are stored and computed as branded integer cents to avoid any
 * floating-point financial arithmetic. A {@link Cents} value is a plain
 * `number` at runtime branded at compile time so it cannot be confused with an
 * arbitrary number. All arithmetic is checked against safe-integer bounds.
 *
 * Parsing accepts the Greek/European decimal conventions (comma or dot
 * separator, leading sign, surrounding whitespace) but rejects ambiguous
 * thousand grouping, exponent notation, excess precision and non-finite
 * values. See {@link parseEur} for the explicit input rules.
 *
 * This module is pure: it has no database, session, network or React imports
 * and performs no I/O. It is safe to use in tests, server actions and client
 * components alike.
 *
 * @module lib/finance/money
 */

/**
 * Branded integer-cent amount. Always a safe integer within
 * [{@link MIN_CENTS}, {@link MAX_CENTS}]. Negative values are valid (e.g.
 * negative account balances); payment amounts must be strictly positive and
 * are validated at the call site.
 */
export type Cents = number & { readonly __brand: "Cents" };

/** Safe-integer upper bound for a {@link Cents} value. */
export const MAX_CENTS = Number.MAX_SAFE_INTEGER as Cents;

/** Safe-integer lower bound for a {@link Cents} value. */
export const MIN_CENTS = Number.MIN_SAFE_INTEGER as Cents;

/** Error thrown for any invalid money operation or input. */
export class CentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CentsError";
  }
}

function isSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value)
  );
}

/** Type guard: true when `value` is a safe integer within bounds. */
export function isCents(value: unknown): value is Cents {
  return isSafeInteger(value) && value >= MIN_CENTS && value <= MAX_CENTS;
}

function assertCents(value: number): asserts value is Cents {
  if (!isSafeInteger(value)) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new CentsError("Expected a finite integer number of cents");
    }
    if (!Number.isFinite(value)) {
      throw new CentsError("Expected a finite number of cents");
    }
    throw new CentsError(`Expected an integer number of cents, got ${value}`);
  }
  if (value < MIN_CENTS || value > MAX_CENTS) {
    throw new CentsError(`Cents value out of safe bounds: ${value}`);
  }
}

/**
 * Construct a {@link Cents} value from a safe integer. Throws {@link CentsError}
 * for non-integers, non-finite values and out-of-bounds values.
 */
export function cents(value: number): Cents {
  assertCents(value);
  return value as Cents;
}

/** Validate and brand an arbitrary integer. Alias of {@link cents}. */
export function toCents(value: number): Cents {
  return cents(value);
}

/** Re-validate a value that is already typed as {@link Cents}. */
export function centsToCents(value: Cents): Cents {
  assertCents(value);
  return value;
}

/** Checked addition; throws on overflow. */
export function addCents(a: Cents, b: Cents): Cents {
  assertCents(a);
  assertCents(b);
  const sum = a + b;
  assertCents(sum);
  return sum;
}

/** Checked subtraction; throws on underflow. */
export function subCents(a: Cents, b: Cents): Cents {
  assertCents(a);
  assertCents(b);
  const diff = a - b;
  assertCents(diff);
  return diff;
}

/** Sum an iterable of Cents safely; throws on partial overflow. */
export function sumCents(values: readonly Cents[]): Cents {
  let acc: Cents = 0 as Cents;
  for (const v of values) {
    acc = addCents(acc, v);
  }
  return acc;
}

// Matches an optional sign, integer part, optional decimal part with exactly
// one separator (dot or comma) and exactly 0-2 fractional digits. Whitespace
// is trimmed by the caller. Exponent notation, multiple separators and
// grouping separators are excluded by construction.
const DECIMAL_RE =
  /^[+-]?(?:\d{1,}(?:[.,]\d{0,2})?|[.,]\d{1,2})$/;

// Rejects strings that look like they use thousand grouping, e.g. "1.234" or
// "1,234": a single separator followed by exactly 3 digits and nothing else is
// ambiguous in Greek/European input. We reject these rather than guessing.
function looksLikeGrouping(trimmed: string): boolean {
  // "1.234" / "1,234" — integer, separator, exactly 3 digits, no further chars
  return /^[+-]?\d{1,}[.,]\d{3}$/.test(trimmed);
}

/**
 * Parse a decimal EUR string into integer cents without floating-point
 * multiplication.
 *
 * Accepted:
 * - `"80"`, `"80.00"`, `"80,00"`, `".40"`, `",40"`, `"0.40"`
 * - leading `+`/`-`, surrounding whitespace, `-0.00` -> 0
 *
 * Rejected:
 * - thousand grouping (`"1.234"`, `"1,234"`) — ambiguous; rejected rather than
 *   guessing whether the user means 1234.00 or 1.234
 * - excess precision beyond 2 decimals (`"80.401"`)
 * - exponent notation (`"1e2"`)
 * - empty/whitespace-only, non-numeric, multiple separators
 * - non-string inputs, non-finite values, out-of-bounds
 *
 * @throws {CentsError} on any invalid input
 */
export function parseEur(input: string): Cents {
  if (typeof input !== "string") {
    throw new CentsError("Expected a string input");
  }
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new CentsError("Empty amount");
  }
  if (/[eE]/.test(trimmed)) {
    throw new CentsError("Exponent notation is not allowed");
  }
  if (looksLikeGrouping(trimmed)) {
    throw new CentsError(
      `Ambiguous grouping separator in "${input}" — use a plain decimal like "1234.00"`,
    );
  }
  if (!DECIMAL_RE.test(trimmed)) {
    throw new CentsError(`Invalid amount "${input}"`);
  }

  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;

  const sepIndex = Math.max(body.indexOf("."), body.indexOf(","));
  let integerPart: string;
  let fracPart: string;
  if (sepIndex === -1) {
    integerPart = body;
    fracPart = "";
  } else {
    integerPart = body.slice(0, sepIndex);
    fracPart = body.slice(sepIndex + 1);
  }
  if (integerPart === "") integerPart = "0";
  if (fracPart.length === 1) fracPart = fracPart + "0";

  const intValue = Number.parseInt(integerPart, 10);
  const fracValue = fracPart === "" ? 0 : Number.parseInt(fracPart, 10);

  if (!Number.isSafeInteger(intValue) || !Number.isSafeInteger(fracValue)) {
    throw new CentsError(`Invalid amount "${input}"`);
  }

  const total = intValue * 100 + fracValue;
  assertCents(total);
  const signed = negative ? -total : total;
  // Normalize -0 to +0 so Object.is(-0, 0) does not surprise callers.
  return (signed === 0 ? 0 : signed) as Cents;
}

/**
 * Format a {@link Cents} value as a EUR decimal string with exactly two
 * fractional digits, using a dot separator (canonical machine form).
 * Example: {@link formatEur}(cents(8040)) -> `"80.40"`.
 */
export function formatEur(value: Cents): string {
  assertCents(value);
  const negative = value < 0;
  const abs = Math.abs(value);
  const euros = Math.floor(abs / 100);
  const centsPart = abs % 100;
  const eurosStr = euros.toString();
  const centsStr = centsPart.toString().padStart(2, "0");
  const sign = negative ? "-" : "";
  return `${sign}${eurosStr}.${centsStr}`;
}