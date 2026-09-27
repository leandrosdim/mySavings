import { describe, it, expect } from "vitest";
import {
  formatEurEl,
  formatEurAbs,
  formatEurDelta,
  formatDateEl,
  formatDateTimeEl,
  freshnessLabel,
} from "@/lib/ui/format";
import { cents } from "@/lib/finance/money";

describe("formatEurEl", () => {
  it("formats positive cents with Greek comma and EUR symbol", () => {
    expect(formatEurEl(cents(8040))).toBe("80,40 €");
  });

  it("formats zero cents", () => {
    expect(formatEurEl(cents(0))).toBe("0,00 €");
  });

  it("formats negative cents with Greek minus sign", () => {
    expect(formatEurEl(cents(-500))).toBe("−5,00 €");
  });

  it("formats large amounts with Greek grouping", () => {
    expect(formatEurEl(cents(123456789))).toBe("1.234.567,89 €");
  });

  it("formats whole euros", () => {
    expect(formatEurEl(cents(120000))).toBe("1.200,00 €");
  });
});

describe("formatEurAbs", () => {
  it("formats absolute value without sign", () => {
    expect(formatEurAbs(cents(-500))).toBe("5,00 €");
    expect(formatEurAbs(cents(500))).toBe("5,00 €");
  });
});

describe("formatEurDelta", () => {
  it("formats positive delta with +", () => {
    expect(formatEurDelta(cents(5000))).toBe("+50,00 €");
  });

  it("formats negative delta with −", () => {
    expect(formatEurDelta(cents(-3000))).toBe("−30,00 €");
  });

  it("formats zero delta with ±", () => {
    expect(formatEurDelta(cents(0))).toBe("±0,00 €");
  });
});

describe("formatDateEl", () => {
  it("formats an ISO date in Europe/Athens", () => {
    const result = formatDateEl("2026-09-26T12:00:00.000Z");
    expect(result).not.toBeNull();
    expect(result).toMatch(/2026/);
  });

  it("returns null for null input", () => {
    expect(formatDateEl(null)).toBeNull();
  });

  it("returns null for invalid date", () => {
    expect(formatDateEl("not-a-date")).toBeNull();
  });
});

describe("formatDateTimeEl", () => {
  it("formats an ISO datetime in Europe/Athens", () => {
    const result = formatDateTimeEl("2026-09-26T12:00:00.000Z");
    expect(result).not.toBeNull();
    expect(result).toMatch(/2026/);
  });

  it("returns null for null input", () => {
    expect(formatDateTimeEl(null)).toBeNull();
  });
});

describe("freshnessLabel", () => {
  const base = Date.UTC(2026, 8, 26, 12, 0, 0);

  it("returns 'Δεν έχει οριστεί' for null", () => {
    expect(freshnessLabel(null, base)).toBe("Δεν έχει οριστεί");
  });

  it("returns 'μόλις τώρα' for <60s", () => {
    expect(freshnessLabel(new Date(base - 30_000).toISOString(), base)).toBe(
      "μόλις τώρα",
    );
  });

  it("returns minutes label", () => {
    expect(freshnessLabel(new Date(base - 120_000).toISOString(), base)).toBe(
      "πριν 2 λεπτά",
    );
  });

  it("returns singular minute label", () => {
    expect(freshnessLabel(new Date(base - 60_000).toISOString(), base)).toBe(
      "πριν 1 λεπτό",
    );
  });

  it("returns hours label", () => {
    expect(freshnessLabel(new Date(base - 3_600_000).toISOString(), base)).toBe(
      "πριν 1 ώρα",
    );
    expect(
      freshnessLabel(new Date(base - 7_200_000).toISOString(), base),
    ).toBe("πριν 2 ώρες");
  });

  it("returns days label", () => {
    expect(
      freshnessLabel(new Date(base - 86_400_000).toISOString(), base),
    ).toBe("πριν 1 μέρα");
    expect(
      freshnessLabel(new Date(base - 172_800_000).toISOString(), base),
    ).toBe("πριν 2 μέρες");
  });

  it("returns formatted date for old timestamps", () => {
    const old = new Date(base - 60 * 86_400_000).toISOString();
    const result = freshnessLabel(old, base);
    expect(result).toMatch(/2026/);
  });

  it("returns formatted date for future timestamps", () => {
    const future = new Date(base + 86_400_000).toISOString();
    const result = freshnessLabel(future, base);
    expect(result).toMatch(/2026/);
  });
});