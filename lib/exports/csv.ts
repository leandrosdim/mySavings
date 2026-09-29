// CSV serialization for private owner-filtered exports.
//
// Pure module: no database, session, network or React imports. Safe to use in
// unit tests and in the server-side export route. All money is formatted as
// integer cents in a machine-readable EUR decimal string (dot separator) via
// lib/finance/money.formatEur so there is no floating-point financial
// arithmetic and no locale ambiguity in the exported file.
//
// Formula-injection neutralization:
// CSV cells that begin with `=`, `+`, `-` or `@` can be interpreted as formulas
// by spreadsheet applications (Excel, LibreOffice, Google Sheets). A malicious
// or accidental value such as `=cmd|'/c calc'!A1` in an account name, source
// name or title could execute when the file is opened. This module neutralizes
// every text cell by prefixing a single quote (`'`) when the trimmed cell
// starts with one of those characters, AND also neutralizes leading whitespace
// and control characters (tab, CR, LF) before the trigger character, which is a
// known bypass when a spreadsheet trims leading whitespace before evaluating.
// The neutralized cell is safe: spreadsheet apps treat a leading `'` as a
// literal-text prefix and display the value without the quote.
//
// Numeric cells (cents) are never quoted-prefixed because they are produced by
// formatEur and are always a canonical `-?digits.digits` string with no
// formula trigger. Date cells are ISO YYYY-MM-DD or ISO timestamps, also safe.
//
// RFC 4180 conformance: fields containing a comma, double quote or any of
// CR/LF are wrapped in double quotes and embedded double quotes are doubled.
// The CRLF record separator is used per RFC 4180. UTF-8 content (Greek) is
// written as-is; the export route sets charset=utf-8 and a BOM-free UTF-8
// Content-Type.

import { formatEur, type Cents } from "../finance/money";

const CSV_RECORD_SEP = "\r\n";
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@"]);
// Control chars that a spreadsheet may trim before formula evaluation.
const LEADING_CONTROL_RE = /^[\t\r\n \f\v]+/;

/**
 * Neutralize a single text cell against CSV formula injection.
 *
 * If the cell, after stripping leading whitespace/control characters, begins
 * with `=`, `+`, `-` or `@`, a single quote is prefixed so spreadsheet
 * applications treat the cell as literal text. Leading control characters are
 * preserved in the output (only the quote is prepended) so the visible content
 * is unchanged; the quote is the defense.
 *
 * Returns the neutralized cell value (before RFC 4180 quoting). An empty string
 * is returned unchanged.
 */
export function neutralizeFormulaCell(value: string): string {
  if (value === "") return "";
  // Strip leading whitespace/control to detect a hidden trigger, but keep the
  // original leading chars in the output. We only prepend `'` when the
  // de-whitespaced first char is a trigger.
  const stripped = value.replace(LEADING_CONTROL_RE, "");
  if (stripped === "") return value;
  if (FORMULA_TRIGGERS.has(stripped[0])) {
    return `'${value}`;
  }
  return value;
}

/**
 * Apply RFC 4180 quoting to a single field: wrap in double quotes when the
 * field contains a comma, double quote, CR or LF; double any embedded double
 * quote. Applied AFTER formula neutralization so the neutralizing quote is
 * inside the field content, not part of the CSV quoting.
 */
export function quoteCsvField(value: string): string {
  if (/[,"\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** A single CSV cell value: either text (neutralized) or cents (canonical EUR). */
export type CsvCell =
  | { kind: "text"; value: string }
  | { kind: "cents"; value: number }
  | { kind: "raw"; value: string };

/** A CSV row is a list of cells. */
export type CsvRow = CsvCell[];

/** Render a single cell to its string form with formula neutralization. */
function renderCell(cell: CsvCell): string {
  if (cell.kind === "cents") {
    // Canonical machine EUR string, never a formula trigger.
    return formatEur(cell.value as Cents);
  }
  if (cell.kind === "raw") {
    // Already-safe canonical string (dates, month_key, status enums).
    return cell.value;
  }
  // Text cell: neutralize then quote.
  return quoteCsvField(neutralizeFormulaCell(cell.value));
}

/** Render a list of rows as a full RFC 4180 CSV string. */
export function renderCsv(rows: readonly CsvRow[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(row.map(renderCell).join(","));
  }
  return lines.join(CSV_RECORD_SEP) + CSV_RECORD_SEP;
}