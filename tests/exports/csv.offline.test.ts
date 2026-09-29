// CSV formula-injection neutralization — offline unit tests.
//
// Pure module: no database. Verifies that text cells beginning with =,+,-,@
// (including those hidden behind leading whitespace/control characters) are
// neutralized with a leading single quote, and that RFC 4180 quoting is applied
// correctly. Cents cells are never neutralized because they are canonical EUR
// strings.

import { describe, it, expect } from "vitest";
import {
  neutralizeFormulaCell,
  quoteCsvField,
  renderCsv,
  type CsvRow,
} from "../../lib/exports/csv";

describe("neutralizeFormulaCell", () => {
  it("prefixes a quote when the cell starts with =", () => {
    expect(neutralizeFormulaCell("=cmd|'/c calc'!A1")).toBe(
      "'=cmd|'/c calc'!A1",
    );
  });
  it("prefixes a quote when the cell starts with +", () => {
    expect(neutralizeFormulaCell("+1+1")).toBe("'+1+1");
  });
  it("prefixes a quote when the cell starts with -", () => {
    expect(neutralizeFormulaCell("-1+1")).toBe("'-1+1");
  });
  it("prefixes a quote when the cell starts with @", () => {
    expect(neutralizeFormulaCell("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
  });
  it("neutralizes leading whitespace before the trigger", () => {
    expect(neutralizeFormulaCell("  =cmd")).toBe("'  =cmd");
    expect(neutralizeFormulaCell("\t=cmd")).toBe("'\t=cmd");
    expect(neutralizeFormulaCell("\r\n=cmd")).toBe("'\r\n=cmd");
  });
  it("does not neutralize safe text", () => {
    expect(neutralizeFormulaCell("Ενοίκιο")).toBe("Ενοίκιο");
    expect(neutralizeFormulaCell("Μισθός")).toBe("Μισθός");
    expect(neutralizeFormulaCell("80,40")).toBe("80,40");
  });
  it("does not neutralize empty string", () => {
    expect(neutralizeFormulaCell("")).toBe("");
  });
  it("does not neutralize whitespace-only strings", () => {
    expect(neutralizeFormulaCell("   ")).toBe("   ");
    expect(neutralizeFormulaCell("\t")).toBe("\t");
  });
  it("does not neutralize a minus that is part of a normal negative-looking date", () => {
    // A Greek account name starting with a dash is still neutralized — this is
    // the safe default. The test documents the behavior.
    expect(neutralizeFormulaCell("-έξοδο")).toBe("'-έξοδο");
  });
});

describe("quoteCsvField", () => {
  it("does not quote a plain field", () => {
    expect(quoteCsvField("Ενοίκιο")).toBe("Ενοίκιο");
  });
  it("quotes a field containing a comma", () => {
    expect(quoteCsvField("80,40")).toBe('"80,40"');
  });
  it("quotes a field containing a double quote and doubles it", () => {
    expect(quoteCsvField('a"b')).toBe('"a""b"');
  });
  it("quotes a field containing a newline", () => {
    expect(quoteCsvField("a\nb")).toBe('"a\nb"');
  });
  it("quotes a field containing CR", () => {
    expect(quoteCsvField("a\rb")).toBe('"a\rb"');
  });
});

describe("renderCsv", () => {
  it("renders a header + data row with CRLF separators", () => {
    const rows: CsvRow[] = [
      [
        { kind: "text", value: "Όνομα" },
        { kind: "text", value: "Ποσό" },
      ],
      [
        { kind: "text", value: "Ενοίκιο" },
        { kind: "cents", value: 80000 },
      ],
    ];
    const out = renderCsv(rows);
    expect(out).toBe("Όνομα,Ποσό\r\nΕνοίκιο,800.00\r\n");
  });

  it("neutralizes formula-capable text cells in rendered output", () => {
    const rows: CsvRow[] = [
      [
        { kind: "text", value: "=HYPERLINK(\"http://evil\")" },
        { kind: "cents", value: 100 },
      ],
    ];
    const out = renderCsv(rows);
    expect(out).toContain("'=HYPERLINK");
    // The neutralizing quote is inside the CSV-quoted field content; the
    // embedded double quotes are RFC 4180-doubled.
    expect(out).toBe('"\'=HYPERLINK(""http://evil"")",1.00\r\n');
  });

  it("renders cents as canonical EUR with dot separator", () => {
    const rows: CsvRow[] = [
      [{ kind: "cents", value: 8040 }],
    ];
    expect(renderCsv(rows)).toBe("80.40\r\n");
  });

  it("renders negative cents correctly", () => {
    const rows: CsvRow[] = [
      [{ kind: "cents", value: -500 }],
    ];
    expect(renderCsv(rows)).toBe("-5.00\r\n");
  });

  it("renders raw cells as-is (dates, enums)", () => {
    const rows: CsvRow[] = [
      [
        { kind: "raw", value: "2026-09-15" },
        { kind: "raw", value: "active" },
      ],
    ];
    expect(renderCsv(rows)).toBe("2026-09-15,active\r\n");
  });

  it("neutralizes a malicious account name", () => {
    const rows: CsvRow[] = [
      [
        { kind: "text", value: "=cmd|'/c calc'!A1" },
        { kind: "cents", value: 0 },
      ],
    ];
    const out = renderCsv(rows);
    expect(out.startsWith("'")).toBe(true);
  });

  it("handles a title with an embedded comma and formula trigger", () => {
    const rows: CsvRow[] = [
      [
        { kind: "text", value: "=SUM(A1),B2" },
      ],
    ];
    const out = renderCsv(rows);
    // Neutralized first, then RFC-quoted because of the comma.
    expect(out).toBe('"\'=SUM(A1),B2"\r\n');
  });

  it("uses CRLF as the record separator", () => {
    const rows: CsvRow[] = [
      [{ kind: "raw", value: "a" }],
      [{ kind: "raw", value: "b" }],
    ];
    expect(renderCsv(rows)).toBe("a\r\nb\r\n");
  });
});