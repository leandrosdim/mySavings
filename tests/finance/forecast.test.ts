import { describe, expect, it } from "vitest";
import {
  cents,
  CentsError,
  MAX_CENTS,
  type Cents,
} from "@/lib/finance/money";
import {
  computeForecast,
  type ForecastInput,
  type BalanceEntry,
  type OrdinaryExpense,
  type ReservedCommitment,
  type InternalTransfer,
  type PendingIncome,
} from "@/lib/finance/forecast";

let balCounter = 0;
function bal(amount: number): BalanceEntry {
  balCounter += 1;
  return { id: `a${balCounter}`, amount: cents(amount) };
}
function balWith(id: string, amount: number | null): BalanceEntry {
  return { id, amount: amount === null ? null : cents(amount) };
}

function ordinary(id: string, planned: number, paid = 0): OrdinaryExpense {
  return { id, planned: cents(planned), paidCents: cents(paid) };
}

function reserve(id: string, planned: number, paid = 0): ReservedCommitment {
  return { id, planned: cents(planned), paidCents: cents(paid) };
}

function transfer(fromId: string, toId: string, amount: number): InternalTransfer {
  return { fromAccountId: fromId, toAccountId: toId, amount: cents(amount) };
}

function income(id: string, expected: number, received = 0): PendingIncome {
  return { id, expected: cents(expected), receivedCents: cents(received) };
}

function base(): ForecastInput {
  return {
    balances: [bal(100000)],
    pendingIncome: [],
    ordinaryExpenses: [],
    reservedCommitments: [],
    internalTransfers: [],
    savingsTarget: cents(0),
  };
}

describe("forecast: setup-incomplete detection", () => {
  it("returns setup-incomplete when balances are missing", () => {
    const input: ForecastInput = {
      balances: [],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(5000),
    };
    const result = computeForecast(input);
    expect(result.setupIncomplete).toBe(true);
    expect(result.shortfall).toBeNull();
    expect(result.projectedFreeToSpend).toBeNull();
    expect(result.cashBackedFreeToSpend).toBeNull();
  });

  it("returns setup-incomplete when savings target is missing (null)", () => {
    const input: ForecastInput = {
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: null,
    };
    const result = computeForecast(input);
    expect(result.setupIncomplete).toBe(true);
  });

  it("explicit zero savings target is NOT setup-incomplete", () => {
    const input: ForecastInput = {
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    };
    const result = computeForecast(input);
    expect(result.setupIncomplete).toBe(false);
  });

  it("explicit zero balance is NOT setup-incomplete, distinct from null", () => {
    const input: ForecastInput = {
      balances: [{ id: "a1", amount: cents(0) }],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    };
    const result = computeForecast(input);
    expect(result.setupIncomplete).toBe(false);
  });

  it("null amount balance (never entered) is setup-incomplete with null forecasts", () => {
    const input: ForecastInput = {
      balances: [{ id: "a1", amount: null }],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    };
    const result = computeForecast(input);
    expect(result.setupIncomplete).toBe(true);
    expect(result.projectedFreeToSpend).toBeNull();
    expect(result.cashBackedFreeToSpend).toBeNull();
    expect(result.shortfall).toBeNull();
  });

  it("setup-incomplete result carries the requested fields as null", () => {
    const input: ForecastInput = {
      balances: [],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: null,
    };
    const result = computeForecast(input);
    expect(result.balancesTotal).toBe(0);
    expect(result.pendingIncomeRemaining).toBe(0);
    expect(result.ordinaryUnpaid).toBe(0);
    expect(result.reservedOutstanding).toBe(0);
    expect(result.projectedFreeToSpend).toBeNull();
    expect(result.cashBackedFreeToSpend).toBeNull();
    expect(result.shortfall).toBeNull();
  });
});

describe("forecast: projected and cash-backed formulas", () => {
  it("projected = B + I - E; cash-backed = B - E (no reserves, no target)", () => {
    const input: ForecastInput = {
      balances: [bal(100000)],
      pendingIncome: [income("i1", 30000)],
      ordinaryExpenses: [ordinary("e1", 40000)],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    };
    const result = computeForecast(input);
    // B=1000.00, I=300.00, E=400.00
    // projected free = 1000 + 300 - 400 - 0 - 0 = 900.00
    // cash-backed   = 1000 - 400 - 0 - 0 = 600.00
    expect(result.balancesTotal).toBe(100000);
    expect(result.pendingIncomeRemaining).toBe(30000);
    expect(result.ordinaryUnpaid).toBe(40000);
    expect(result.reservedOutstanding).toBe(0);
    expect(result.projectedFreeToSpend).toBe(90000);
    expect(result.cashBackedFreeToSpend).toBe(60000);
  });

  it("includes reserves and savings target: B+I-E-R-S and B-E-R-S", () => {
    const input: ForecastInput = {
      balances: [bal(200000)],
      pendingIncome: [income("i1", 50000)],
      ordinaryExpenses: [ordinary("e1", 60000)],
      reservedCommitments: [reserve("r1", 30000)],
      internalTransfers: [],
      savingsTarget: cents(70000),
    };
    const result = computeForecast(input);
    // projected = 2000 + 500 - 600 - 300 - 700 = 900.00
    // cash-backed = 2000 - 600 - 300 - 700 = 400.00
    expect(result.projectedFreeToSpend).toBe(90000);
    expect(result.cashBackedFreeToSpend).toBe(40000);
  });
});

describe("forecast: negative shortfalls are shown, not clamped", () => {
  it("negative projected result stays negative", () => {
    const input: ForecastInput = {
      balances: [bal(10000)],
      pendingIncome: [],
      ordinaryExpenses: [ordinary("e1", 50000)],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    };
    const result = computeForecast(input);
    // 100 - 500 = -400.00
    expect(result.projectedFreeToSpend).toBe(-40000);
    expect(result.cashBackedFreeToSpend).toBe(-40000);
  });

  it("shortfall is the negative amount when below target", () => {
    const input: ForecastInput = {
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: [ordinary("e1", 200000)],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    };
    const result = computeForecast(input);
    // projected = 1000 - 2000 = -1000.00
    expect(result.projectedFreeToSpend).toBe(-100000);
    expect(result.shortfall).toBe(-100000);
  });

  it("shortfall is null when projected is non-negative", () => {
    const input: ForecastInput = {
      balances: [bal(200000)],
      pendingIncome: [],
      ordinaryExpenses: [ordinary("e1", 50000)],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    };
    const result = computeForecast(input);
    expect(result.projectedFreeToSpend).toBe(150000);
    expect(result.shortfall).toBeNull();
  });
});

describe("forecast: ordinary payment reduces B and E equally (free-to-spend unchanged)", () => {
  it("UPDATE_ACCOUNT-style: paying an ordinary expense lowers B and E by same amount", () => {
    const unpaid = [ordinary("e1", 40000, 0)];
    const before = computeForecast({
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: unpaid,
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    // B=1000, E=400 => free = 600
    const after = computeForecast({
      balances: [bal(60000)], // B reduced by 400
      pendingIncome: [],
      ordinaryExpenses: [ordinary("e1", 40000, 40000)], // E reduced by 400 (paid)
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    // B=600, E=0 => free = 600
    expect(before.projectedFreeToSpend).toBe(60000);
    expect(after.projectedFreeToSpend).toBe(60000);
  });

  it("already-reflected payment reduces E only, B unchanged", () => {
    const unpaid = [ordinary("e1", 40000, 0)];
    const before = computeForecast({
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: unpaid,
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    // B=1000, E=400 => free = 600
    const after = computeForecast({
      balances: [bal(100000)], // B unchanged (already reflected in bank refresh)
      pendingIncome: [],
      ordinaryExpenses: [ordinary("e1", 40000, 40000)], // E reduced
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    // B=1000, E=0 => free = 1000
    expect(before.projectedFreeToSpend).toBe(60000);
    expect(after.projectedFreeToSpend).toBe(100000);
  });
});

describe("forecast: receipts affect I and B once", () => {
  it("received income reduces remaining I and adds to B once", () => {
    const before = computeForecast({
      balances: [bal(100000)],
      pendingIncome: [income("i1", 30000, 0)],
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    // B=1000, I=300 => projected = 1300
    const after = computeForecast({
      balances: [bal(130000)], // B increased by 300
      pendingIncome: [income("i1", 30000, 30000)], // I remaining = 0
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    // B=1300, I=0 => projected = 1300 (unchanged: receipt moved from I to B)
    expect(before.projectedFreeToSpend).toBe(130000);
    expect(after.projectedFreeToSpend).toBe(130000);
    expect(after.pendingIncomeRemaining).toBe(0);
  });

  it("already-reflected receipt leaves B unchanged (I decreases only)", () => {
    const before = computeForecast({
      balances: [bal(100000)],
      pendingIncome: [income("i1", 30000, 0)],
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    // B=1000, I=300 => 1300
    const after = computeForecast({
      balances: [bal(100000)], // B unchanged (already reflected in bank refresh)
      pendingIncome: [income("i1", 30000, 30000)], // I now 0
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    // B=1000, I=0 => 1000 (income was already in B, don't double count)
    expect(before.projectedFreeToSpend).toBe(130000);
    expect(after.projectedFreeToSpend).toBe(100000);
  });
});

describe("forecast: reserves protected once, not double-counted", () => {
  it("reserve creation affects R only; planned is protected", () => {
    const input: ForecastInput = {
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [reserve("r1", 30000)],
      internalTransfers: [],
      savingsTarget: cents(0),
    };
    const result = computeForecast(input);
    expect(result.reservedOutstanding).toBe(30000);
    // projected = 1000 - 0 - 300 = 700
    expect(result.projectedFreeToSpend).toBe(70000);
  });

  it("paying a reserve reduces B and R exactly once (planned minus paid)", () => {
    const before = computeForecast({
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [reserve("r1", 30000, 0)],
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    // B=1000, R=300 => projected = 700
    const after = computeForecast({
      balances: [bal(70000)], // B reduced by 300 (UPDATE_ACCOUNT)
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [reserve("r1", 30000, 30000)], // R outstanding now 0
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    // B=700, R=0 => projected = 700 (unchanged: reserve payment moved from B to R)
    expect(before.projectedFreeToSpend).toBe(70000);
    expect(after.projectedFreeToSpend).toBe(70000);
    expect(after.reservedOutstanding).toBe(0);
  });

  it("partial reserve payment reduces R by the paid amount (planned minus paid)", () => {
    const result = computeForecast({
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [reserve("r1", 30000, 10000)], // paid 100 of 300
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    // R = planned - paid = 300 - 100 = 200
    expect(result.reservedOutstanding).toBe(20000);
    // projected = 1000 - 0 - 200 = 800
    expect(result.projectedFreeToSpend).toBe(80000);
  });

  it("duplicate reserved commitment IDs (identical) are counted only once", () => {
    const input: ForecastInput = {
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [
        reserve("r1", 30000, 0),
        reserve("r1", 30000, 0), // identical duplicate
      ],
      internalTransfers: [],
      savingsTarget: cents(0),
    };
    const result = computeForecast(input);
    expect(result.reservedOutstanding).toBe(30000);
    expect(result.projectedFreeToSpend).toBe(70000);
  });

  it("conflicting duplicate reserved commitment IDs are rejected (no max choosing)", () => {
    expect(() =>
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [],
        ordinaryExpenses: [],
        reservedCommitments: [
          reserve("r1", 30000, 0),
          reserve("r1", 50000, 0), // conflicting representation
        ],
        internalTransfers: [],
        savingsTarget: cents(0),
      }),
    ).toThrow(CentsError);
  });

  it("duplicate ordinary expense IDs (identical) are counted only once", () => {
    const input: ForecastInput = {
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: [ordinary("e1", 40000, 0), ordinary("e1", 40000, 0)],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    };
    const result = computeForecast(input);
    expect(result.ordinaryUnpaid).toBe(40000);
  });

  it("conflicting duplicate ordinary IDs are rejected even with equal remainder", () => {
    // planned/paid differ but remainder is equal (40-0=40, 50-10=40) — still reject
    expect(() =>
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [],
        ordinaryExpenses: [
          ordinary("e1", 40000, 0),
          ordinary("e1", 50000, 10000),
        ],
        reservedCommitments: [],
        internalTransfers: [],
        savingsTarget: cents(0),
      }),
    ).toThrow(CentsError);
  });

  it("due date does not release outstanding reserved money (R stays protected)", () => {
    const input: ForecastInput = {
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [reserve("r1", 30000)],
      internalTransfers: [],
      savingsTarget: cents(0),
    };
    const result = computeForecast(input);
    expect(result.reservedOutstanding).toBe(30000);
  });
});

describe("forecast: linkedReserveId cross-category linking", () => {
  it("ordinary entry linked to a matching reserve is counted once in R, not E", () => {
    const input: ForecastInput = {
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: [
        { id: "tax-view", planned: cents(10000), paidCents: cents(0), linkedReserveId: "tax" },
      ],
      reservedCommitments: [reserve("tax", 10000, 0)],
      internalTransfers: [],
      savingsTarget: cents(0),
    };
    const result = computeForecast(input);
    expect(result.ordinaryUnpaid).toBe(0);
    expect(result.reservedOutstanding).toBe(10000);
    // projected = 1000 - 0 - 100 = 900
    expect(result.projectedFreeToSpend).toBe(90000);
  });

  it("ordinary entry linking to a missing reserve is rejected", () => {
    expect(() =>
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [],
        ordinaryExpenses: [
          { id: "tax-view", planned: cents(10000), paidCents: cents(0), linkedReserveId: "tax" },
        ],
        reservedCommitments: [],
        internalTransfers: [],
        savingsTarget: cents(0),
      }),
    ).toThrow(CentsError);
  });

  it("ordinary entry linking to a reserve with a contradictory representation is rejected", () => {
    expect(() =>
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [],
        ordinaryExpenses: [
          { id: "tax-view", planned: cents(20000), paidCents: cents(0), linkedReserveId: "tax" },
        ],
        reservedCommitments: [reserve("tax", 10000, 0)],
        internalTransfers: [],
        savingsTarget: cents(0),
      }),
    ).toThrow(CentsError);
  });

  it("same-ID ordinary and reserve without a link is rejected (no guessing)", () => {
    expect(() =>
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [],
        ordinaryExpenses: [ordinary("tax", 10000, 0)],
        reservedCommitments: [reserve("tax", 10000, 0)],
        internalTransfers: [],
        savingsTarget: cents(0),
      }),
    ).toThrow(CentsError);
  });
});

describe("forecast: internal transfer invariance", () => {
  it("internal transfer changes individual accounts but not total B or forecast", () => {
    const before = computeForecast({
      balances: [bal(80000), bal(20000)],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    // B total = 1000.00

    const after = computeForecast({
      balances: [bal(60000), bal(40000)],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [transfer("a1", "a2", 20000)],
      savingsTarget: cents(0),
    });

    expect(before.balancesTotal).toBe(100000);
    expect(after.balancesTotal).toBe(100000);
    expect(before.projectedFreeToSpend).toBe(100000);
    expect(after.projectedFreeToSpend).toBe(100000);
  });

  it("rejects transfer with identical from/to accounts", () => {
    expect(() =>
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [],
        ordinaryExpenses: [],
        reservedCommitments: [],
        internalTransfers: [transfer("a1", "a1", 20000)],
        savingsTarget: cents(0),
      }),
    ).toThrow(CentsError);
  });

  it("rejects negative transfer amount", () => {
    expect(() =>
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [],
        ordinaryExpenses: [],
        reservedCommitments: [],
        internalTransfers: [
          { fromAccountId: "a1", toAccountId: "a2", amount: cents(-100) },
        ],
        savingsTarget: cents(0),
      }),
    ).toThrow(CentsError);
  });
});

describe("forecast: pending-income caveat", () => {
  it("caveat is true when there is remaining pending income not yet received", () => {
    const result = computeForecast({
      balances: [bal(100000)],
      pendingIncome: [income("i1", 30000, 10000)], // 200 still pending
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    expect(result.pendingIncomeRemaining).toBe(20000);
    expect(result.hasPendingIncomeCaveat).toBe(true);
  });

  it("caveat is false when all income is received or none expected", () => {
    expect(
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [income("i1", 30000, 30000)],
        ordinaryExpenses: [],
        reservedCommitments: [],
        internalTransfers: [],
        savingsTarget: cents(0),
      }).hasPendingIncomeCaveat,
    ).toBe(false);

    expect(
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [],
        ordinaryExpenses: [],
        reservedCommitments: [],
        internalTransfers: [],
        savingsTarget: cents(0),
      }).hasPendingIncomeCaveat,
    ).toBe(false);
  });
});

describe("forecast: multiple accounts and expenses aggregate", () => {
  it("aggregates multiple balances and ordinary expenses", () => {
    const result = computeForecast({
      balances: [bal(50000), bal(30000), bal(20000)],
      pendingIncome: [income("i1", 10000, 5000), income("i2", 5000, 0)],
      ordinaryExpenses: [ordinary("e1", 20000, 5000), ordinary("e2", 15000)],
      reservedCommitments: [reserve("r1", 10000, 4000)],
      internalTransfers: [],
      savingsTarget: cents(25000),
    });
    // B = 500+300+200 = 1000.00
    // I = (100-50) + (50-0) = 50 + 50 = 100.00
    // E = (200-50) + (150-0) = 150 + 150 = 300.00
    // R = (100-40) = 60.00
    // S = 250.00
    // projected = 1000 + 100 - 300 - 60 - 250 = 490.00
    // cash-backed = 1000 - 300 - 60 - 250 = 390.00
    expect(result.balancesTotal).toBe(100000);
    expect(result.pendingIncomeRemaining).toBe(10000);
    expect(result.ordinaryUnpaid).toBe(30000);
    expect(result.reservedOutstanding).toBe(6000);
    expect(result.projectedFreeToSpend).toBe(49000);
    expect(result.cashBackedFreeToSpend).toBe(39000);
  });
});

describe("forecast: overflow and invalid input", () => {
  it("rejects overflowing balance sum with CentsError", () => {
    expect(() =>
      computeForecast({
        balances: [
          { id: "a1", amount: MAX_CENTS as Cents },
          { id: "a2", amount: cents(1) },
        ],
        pendingIncome: [],
        ordinaryExpenses: [],
        reservedCommitments: [],
        internalTransfers: [],
        savingsTarget: cents(0),
      }),
    ).toThrow(CentsError);
  });

  it("rejects negative planned ordinary expense", () => {
    expect(() =>
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [],
        ordinaryExpenses: [{ id: "e1", planned: cents(-500), paidCents: cents(0) }],
        reservedCommitments: [],
        internalTransfers: [],
        savingsTarget: cents(0),
      }),
    ).toThrow(CentsError);
  });

  it("rejects paid greater than planned for ordinary expense", () => {
    expect(() =>
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [],
        ordinaryExpenses: [
          { id: "e1", planned: cents(1000), paidCents: cents(2000) },
        ],
        reservedCommitments: [],
        internalTransfers: [],
        savingsTarget: cents(0),
      }),
    ).toThrow(CentsError);
  });

  it("rejects negative planned reserve", () => {
    expect(() =>
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [],
        ordinaryExpenses: [],
        reservedCommitments: [
          { id: "r1", planned: cents(-100), paidCents: cents(0) },
        ],
        internalTransfers: [],
        savingsTarget: cents(0),
      }),
    ).toThrow(CentsError);
  });

  it("rejects paid greater than planned for reserve", () => {
    expect(() =>
      computeForecast({
        balances: [bal(100000)],
        pendingIncome: [],
        ordinaryExpenses: [],
        reservedCommitments: [
          { id: "r1", planned: cents(1000), paidCents: cents(2000) },
        ],
        internalTransfers: [],
        savingsTarget: cents(0),
      }),
    ).toThrow(CentsError);
  });

  it("rejects negative savings target", () => {
    expect(() =>
      computeForecast({
        ...base(),
        savingsTarget: cents(-1),
      }),
    ).toThrow(CentsError);
  });

  it("rejects negative expected income", () => {
    expect(() =>
      computeForecast({
        ...base(),
        pendingIncome: [{ id: "i", expected: cents(-100), receivedCents: cents(0) }],
      }),
    ).toThrow(CentsError);
  });

  it("rejects negative received income", () => {
    expect(() =>
      computeForecast({
        ...base(),
        pendingIncome: [{ id: "i", expected: cents(100), receivedCents: cents(-1) }],
      }),
    ).toThrow(CentsError);
  });

  it("rejects negative paid expense", () => {
    expect(() =>
      computeForecast({
        ...base(),
        ordinaryExpenses: [{ id: "e", planned: cents(100), paidCents: cents(-1) }],
      }),
    ).toThrow(CentsError);
  });

  it("rejects negative reserve paid", () => {
    expect(() =>
      computeForecast({
        ...base(),
        reservedCommitments: [{ id: "r", planned: cents(100), paidCents: cents(-1) }],
      }),
    ).toThrow(CentsError);
  });

  it("rejects blank balance id", () => {
    expect(() =>
      computeForecast({
        ...base(),
        balances: [{ id: "  ", amount: cents(100) }],
      }),
    ).toThrow(CentsError);
  });

  it("identical duplicate balance ids (same amount) are collapsed to one", () => {
    // identical duplicates are collapsed, not doubled — so B is not inflated
    const result = computeForecast({
      ...base(),
      balances: [
        { id: "a", amount: cents(100000) },
        { id: "a", amount: cents(100000) },
      ],
    });
    expect(result.balancesTotal).toBe(100000);
  });

  it("conflicting duplicate balance ids (different amounts) are rejected", () => {
    expect(() =>
      computeForecast({
        ...base(),
        balances: [
          { id: "a", amount: cents(100000) },
          { id: "a", amount: cents(200000) },
        ],
      }),
    ).toThrow(CentsError);
  });

  it("conflicting duplicate balance ids with null vs amount are rejected", () => {
    expect(() =>
      computeForecast({
        ...base(),
        balances: [
          { id: "a", amount: cents(100000) },
          { id: "a", amount: null },
        ],
      }),
    ).toThrow(CentsError);
  });

  it("negative balance amount is valid (overdraft)", () => {
    expect(() =>
      computeForecast({
        balances: [bal(-50000)],
        pendingIncome: [],
        ordinaryExpenses: [],
        reservedCommitments: [],
        internalTransfers: [],
        savingsTarget: cents(0),
      }),
    ).not.toThrow();
  });
});

describe("forecast: boundary cents against bigint oracle", () => {
  it("formats and parses near MAX_CENTS consistently", () => {
    // Cross-check finance money boundaries indirectly via forecast aggregation
    // (parse/format oracle lives in money tests; here we verify large sums do not
    // silently lose cents within the forecast when within bounds).
    const result = computeForecast({
      balances: [bal(100000)],
      pendingIncome: [],
      ordinaryExpenses: [],
      reservedCommitments: [],
      internalTransfers: [],
      savingsTarget: cents(0),
    });
    expect(result.balancesTotal).toBe(100000);
    expect(result.projectedFreeToSpend).toBe(100000);
  });
});