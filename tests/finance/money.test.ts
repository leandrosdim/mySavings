import { describe, expect, it } from "vitest";
import {
  cents,
  addCents,
  subCents,
  sumCents,
  parseEur,
  formatEur,
  toCents,
  isCents,
  centsToCents,
  MAX_CENTS,
  MIN_CENTS,
  CentsError,
  type Cents,
} from "@/lib/finance/money";

describe("money: branded cents construction and bounds", () => {
  it("constructs a valid Cents value from a safe integer", () => {
    expect(cents(0)).toBe(0);
    expect(cents(8000)).toBe(8000);
    expect(cents(-500)).toBe(-500);
  });

  it("rejects non-integer numbers", () => {
    expect(() => cents(1.5)).toThrow(CentsError);
    expect(() => cents(NaN)).toThrow(CentsError);
    expect(() => cents(Infinity)).toThrow(CentsError);
    expect(() => cents(-Infinity)).toThrow(CentsError);
  });

  it("rejects values outside safe integer bounds", () => {
    expect(() => cents(MAX_CENTS + 1)).toThrow(CentsError);
    expect(() => cents(MIN_CENTS - 1)).toThrow(CentsError);
  });

  it("rejects non-number inputs", () => {
    expect(() => cents("8000" as unknown as number)).toThrow(CentsError);
    expect(() => cents(null as unknown as number)).toThrow(CentsError);
    expect(() => cents(undefined as unknown as number)).toThrow(CentsError);
    expect(() => cents({} as unknown as number)).toThrow(CentsError);
  });

  it("isCents type guard returns true only for integers in bounds", () => {
    expect(isCents(0)).toBe(true);
    expect(isCents(8000)).toBe(true);
    expect(isCents(-500)).toBe(true);
    expect(isCents(1.5)).toBe(false);
    expect(isCents(NaN)).toBe(false);
    expect(isCents(Infinity)).toBe(false);
    expect(isCents(MAX_CENTS + 1)).toBe(false);
  });

  it("centsToCents returns the same value for a valid Cents", () => {
    expect(centsToCents(cents(12345))).toBe(12345);
  });

  it("centsToCents rejects invalid cents", () => {
    expect(() => centsToCents(1.5 as unknown as Cents)).toThrow(CentsError);
  });

  it("toCents validates and brands an arbitrary integer", () => {
    expect(toCents(42)).toBe(42);
    expect(toCents(-42)).toBe(-42);
  });
});

describe("money: checked addition and subtraction", () => {
  it("adds two valid cents", () => {
    expect(addCents(cents(4000), cents(4000))).toBe(8000);
    expect(addCents(cents(-300), cents(300))).toBe(0);
  });

  it("subtracts two valid cents", () => {
    expect(subCents(cents(8000), cents(4000))).toBe(4000);
    expect(subCents(cents(300), cents(300))).toBe(0);
    expect(subCents(cents(100), cents(500))).toBe(-400);
  });

  it("rejects overflow on addition", () => {
    expect(() => addCents(cents(MAX_CENTS), cents(1))).toThrow(CentsError);
  });

  it("rejects underflow on subtraction", () => {
    expect(() => subCents(cents(MIN_CENTS), cents(1))).toThrow(CentsError);
  });

  it("sums an array of cents safely", () => {
    expect(sumCents([cents(1000), cents(2000), cents(3000)])).toBe(6000);
    expect(sumCents([cents(-1000), cents(500)])).toBe(-500);
    expect(sumCents([])).toBe(0);
  });

  it("sum rejects partial overflow", () => {
    expect(() => sumCents([cents(MAX_CENTS), cents(1)])).toThrow(CentsError);
  });
});

describe("money: decimal string parsing", () => {
  it("parses plain integer cents string", () => {
    expect(parseEur("80")).toBe(8000);
    expect(parseEur("0")).toBe(0);
  });

  it("parses dot decimal separator", () => {
    expect(parseEur("80.00")).toBe(8000);
    expect(parseEur("80.40")).toBe(8040);
    expect(parseEur("0.40")).toBe(40);
    expect(parseEur(".40")).toBe(40);
  });

  it("parses comma decimal separator", () => {
    expect(parseEur("80,00")).toBe(8000);
    expect(parseEur("80,40")).toBe(8040);
    expect(parseEur(",40")).toBe(40);
  });

  it("trims surrounding whitespace", () => {
    expect(parseEur("  80.40 ")).toBe(8040);
    expect(parseEur("\t80,40\n")).toBe(8040);
  });

  it("parses leading sign", () => {
    expect(parseEur("-80.40")).toBe(-8040);
    expect(parseEur("+80.40")).toBe(8040);
    expect(parseEur("-0.40")).toBe(-40);
  });

  it("rejects ambiguous grouping (thousand separators)", () => {
    expect(() => parseEur("1.234")).toThrow(CentsError);
    expect(() => parseEur("1,234")).toThrow(CentsError);
    expect(() => parseEur("1.234.56")).toThrow(CentsError);
    expect(() => parseEur("1,234,567")).toThrow(CentsError);
  });

  it("rejects excess precision beyond two decimals", () => {
    expect(() => parseEur("80.401")).toThrow(CentsError);
    expect(() => parseEur("80,999")).toThrow(CentsError);
    expect(() => parseEur("0.001")).toThrow(CentsError);
  });

  it("rejects exponent notation", () => {
    expect(() => parseEur("1e2")).toThrow(CentsError);
    expect(() => parseEur("1E2")).toThrow(CentsError);
    expect(() => parseEur("1e-2")).toThrow(CentsError);
  });

  it("rejects empty and whitespace-only strings", () => {
    expect(() => parseEur("")).toThrow(CentsError);
    expect(() => parseEur("   ")).toThrow(CentsError);
  });

  it("rejects non-numeric strings", () => {
    expect(() => parseEur("abc")).toThrow(CentsError);
    expect(() => parseEur("80.40abc")).toThrow(CentsError);
    expect(() => parseEur("eighty")).toThrow(CentsError);
    expect(() => parseEur("--80")).toThrow(CentsError);
    expect(() => parseEur("80.40.50")).toThrow(CentsError);
    expect(() => parseEur("80,40,50")).toThrow(CentsError);
    expect(() => parseEur("80.40,50")).toThrow(CentsError);
    expect(() => parseEur("80,40.50")).toThrow(CentsError);
    expect(() => parseEur("$80.40")).toThrow(CentsError);
  });

  it("rejects NaN and Infinity even if numeric", () => {
    expect(() => parseEur(String(NaN))).toThrow(CentsError);
    expect(() => parseEur(String(Infinity))).toThrow(CentsError);
  });

  it("rejects non-string inputs", () => {
    expect(() => parseEur(80 as unknown as string)).toThrow(CentsError);
    expect(() => parseEur(null as unknown as string)).toThrow(CentsError);
    expect(() => parseEur(undefined as unknown as string)).toThrow(CentsError);
  });

  it("rejects out-of-bounds values", () => {
    const huge = String(Number.MAX_SAFE_INTEGER + 1) + ".00";
    expect(() => parseEur(huge)).toThrow(CentsError);
  });

  it("explicit 0.00 and -0.00 both parse to 0 cents", () => {
    expect(parseEur("0.00")).toBe(0);
    expect(parseEur("-0.00")).toBe(0);
    expect(parseEur("0,00")).toBe(0);
  });
});

describe("money: formatting", () => {
  it("formats positive cents as EUR decimal string", () => {
    expect(formatEur(cents(8000))).toBe("80.00");
    expect(formatEur(cents(8040))).toBe("80.40");
    expect(formatEur(cents(40))).toBe("0.40");
    expect(formatEur(cents(0))).toBe("0.00");
    expect(formatEur(cents(105))).toBe("1.05");
    expect(formatEur(cents(100))).toBe("1.00");
  });

  it("formats negative cents with leading minus", () => {
    expect(formatEur(cents(-8040))).toBe("-80.40");
    expect(formatEur(cents(-40))).toBe("-0.40");
    expect(formatEur(cents(-105))).toBe("-1.05");
  });

  it("format is the inverse of parse for round-trippable values", () => {
    const values = ["80.00", "80.40", "0.40", "0.00", "-80.40", "-0.40", "1.05"];
    for (const v of values) {
      expect(formatEur(parseEur(v))).toBe(v);
    }
  });

  it("format rejects non-cents inputs", () => {
    expect(() => formatEur(1.5 as unknown as Cents)).toThrow(CentsError);
    expect(() => formatEur(NaN as unknown as Cents)).toThrow(CentsError);
  });
});