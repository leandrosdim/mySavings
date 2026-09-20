import { describe, expect, it } from "vitest";
import {
  cents,
  CentsError,
  type Cents,
} from "@/lib/finance/money";
import {
  settlePayment,
  computeRemaining,
  computePaid,
  settlementStatus,
  activeSettlement,
  reversedSettlement,
  type Settlement,
  SettlementStatus,
} from "@/lib/finance/settlements";

function activePayment(amount: number): Settlement {
  return { amount: cents(amount), reversed: false };
}

function reversedPayment(amount: number): Settlement {
  return { amount: cents(amount), reversed: true };
}

describe("settlements: 80/40/40 gas scenario (canonical)", () => {
  it("planned 8000: pay 4000 then 4000, remaining 8000->4000->0, plan unchanged", () => {
    const planned = cents(8000);

    const afterFirst = settlePayment({
      planned,
      settlements: [],
      payment: cents(4000),
    });
    expect(afterFirst.ok).toBe(true);
    if (afterFirst.ok) {
      expect(afterFirst.remaining).toBe(4000);
      expect(afterFirst.state).toBe(SettlementStatus.Partial);
      expect(afterFirst.paid).toBe(4000);
    }
    expect(planned).toBe(8000); // planned unchanged (immutable)

    const afterSecond = settlePayment({
      planned,
      settlements: afterFirst.settlements,
      payment: cents(4000),
    });
    expect(afterSecond.ok).toBe(true);
    if (afterSecond.ok) {
      expect(afterSecond.remaining).toBe(0);
      expect(afterSecond.state).toBe(SettlementStatus.Paid);
      expect(afterSecond.paid).toBe(8000);
    }
    expect(planned).toBe(8000); // still unchanged
  });

  it("original plan is never zeroed on full payment", () => {
    const planned = cents(8000);
    const result = settlePayment({
      planned,
      settlements: [],
      payment: cents(8000),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.remaining).toBe(0);
      expect(result.state).toBe(SettlementStatus.Paid);
    }
    expect(planned).toBe(8000);
  });
});

describe("settlements: reject overpayment and nonpositive payments", () => {
  it("rejects overpayment exactly at boundary", () => {
    const result = settlePayment({
      planned: cents(8000),
      settlements: [activePayment(4000)],
      payment: cents(4001),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects overpayment with multiple settlements", () => {
    const result = settlePayment({
      planned: cents(8000),
      settlements: [activePayment(3000), activePayment(3000)],
      payment: cents(3000),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects zero payment", () => {
    const result = settlePayment({
      planned: cents(8000),
      settlements: [],
      payment: cents(0),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects negative payment", () => {
    const result = settlePayment({
      planned: cents(8000),
      settlements: [],
      payment: cents(-4000),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects non-integer payment silently as invalid", () => {
    const result = settlePayment({
      planned: cents(8000),
      settlements: [],
      payment: 4000.5 as unknown as Cents,
    });
    expect(result.ok).toBe(false);
  });
});

describe("settlements: reversed settlements are excluded from paid", () => {
  it("a single reversed settlement yields zero paid (original excluded)", () => {
    const planned = cents(8000);
    const settlements: Settlement[] = [reversedPayment(4000)];
    expect(computePaid(settlements)).toBe(0);
    expect(computeRemaining(planned, settlements)).toBe(8000);
    expect(settlementStatus(planned, settlements)).toBe(SettlementStatus.Unpaid);
  });

  it("reversed original next to a later active payment counts only the active one", () => {
    // History: an original 4000 settlement was reversed (excluded); a new 2000
    // active settlement remains. Net paid = 2000 (NOT 4000-2000=2000 by
    // subtraction, but 2000 by exclusion of the reversed row).
    const planned = cents(8000);
    const settlements: Settlement[] = [
      reversedPayment(4000),
      activePayment(2000),
    ];
    expect(computePaid(settlements)).toBe(2000);
    expect(computeRemaining(planned, settlements)).toBe(6000);
    expect(settlementStatus(planned, settlements)).toBe(SettlementStatus.Partial);
  });

  it("all-reversed history yields zero paid and full remaining", () => {
    const planned = cents(10000);
    const settlements: Settlement[] = [
      reversedPayment(5000),
      reversedPayment(3000),
    ];
    expect(computePaid(settlements)).toBe(0);
    expect(computeRemaining(planned, settlements)).toBe(10000);
    expect(settlementStatus(planned, settlements)).toBe(SettlementStatus.Unpaid);
  });

  it("active settlements without reversals sum normally", () => {
    const planned = cents(10000);
    const settlements: Settlement[] = [
      activePayment(5000),
      activePayment(3000),
    ];
    expect(computePaid(settlements)).toBe(8000);
    expect(computeRemaining(planned, settlements)).toBe(2000);
  });
});

describe("settlements: derived state", () => {
  it("unpaid when no active settlements", () => {
    expect(settlementStatus(cents(8000), [])).toBe(SettlementStatus.Unpaid);
    expect(settlementStatus(cents(8000), [reversedPayment(4000)])).toBe(
      SettlementStatus.Unpaid,
    );
  });

  it("partial when paid below planned", () => {
    expect(settlementStatus(cents(8000), [activePayment(4000)])).toBe(
      SettlementStatus.Partial,
    );
  });

  it("paid when paid equals planned", () => {
    expect(settlementStatus(cents(8000), [activePayment(8000)])).toBe(
      SettlementStatus.Paid,
    );
    expect(
      settlementStatus(cents(8000), [activePayment(4000), activePayment(4000)]),
    ).toBe(SettlementStatus.Paid);
  });

  it("zero planned with no settlements is unpaid (not paid)", () => {
    expect(settlementStatus(cents(0), [])).toBe(SettlementStatus.Unpaid);
  });

  it("zero planned with reversed settlement is unpaid", () => {
    expect(settlementStatus(cents(0), [reversedPayment(4000)])).toBe(
      SettlementStatus.Unpaid,
    );
  });
});

describe("settlements: computeRemaining/computePaid pure helpers", () => {
  it("computeRemaining = planned - active paid", () => {
    expect(computeRemaining(cents(8000), [activePayment(3000)])).toBe(5000);
    expect(computeRemaining(cents(8000), [])).toBe(8000);
  });

  it("computePaid sums only active (non-reversed) settlements", () => {
    expect(computePaid([activePayment(3000), activePayment(2000)])).toBe(5000);
    expect(computePaid([activePayment(3000), reversedPayment(2000)])).toBe(3000);
    expect(computePaid([])).toBe(0);
    expect(computePaid([reversedPayment(2000)])).toBe(0);
  });

  it("computeRemaining never goes below zero for valid inputs", () => {
    expect(computeRemaining(cents(8000), [activePayment(8000)])).toBe(0);
  });
});

describe("settlements: SettlePaymentResult shape", () => {
  it("successful payment returns ok=true with updated settlements", () => {
    const result = settlePayment({
      planned: cents(8000),
      settlements: [],
      payment: cents(4000),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settlements).toHaveLength(1);
      expect(result.settlements[0].amount).toBe(4000);
      expect(result.settlements[0].reversed).toBe(false);
    }
  });

  it("failed payment returns ok=false with original settlements and reason", () => {
    const existing: Settlement[] = [activePayment(4000)];
    const result = settlePayment({
      planned: cents(8000),
      settlements: existing,
      payment: cents(4001),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.settlements).toBe(existing); // unchanged reference
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("does not mutate the input settlements array on success", () => {
    const existing: Settlement[] = [activePayment(4000)];
    const result = settlePayment({
      planned: cents(8000),
      settlements: existing,
      payment: cents(4000),
    });
    expect(result.ok).toBe(true);
    expect(existing).toHaveLength(1); // input untouched
    if (result.ok) {
      expect(result.settlements).not.toBe(existing);
      expect(result.settlements).toHaveLength(2);
    }
  });
});

describe("settlements: invalid history rejection (CentsError)", () => {
  it("computePaid rejects non-positive historical amount", () => {
    expect(() => computePaid([{ amount: cents(0), reversed: false }])).toThrow(CentsError);
    expect(() => computePaid([{ amount: cents(-1), reversed: false }])).toThrow(CentsError);
  });

  it("computePaid rejects non-boolean reversed flag", () => {
    expect(() =>
      computePaid([{ amount: cents(4000), reversed: "true" as unknown as boolean }]),
    ).toThrow(CentsError);
    expect(() =>
      computePaid([{ amount: cents(4000), reversed: 1 as unknown as boolean }]),
    ).toThrow(CentsError);
  });

  it("computeRemaining rejects overpaid history (paid > planned)", () => {
    const history: Settlement[] = [{ amount: cents(9000), reversed: false }];
    expect(() => computeRemaining(cents(8000), history)).toThrow(CentsError);
  });

  it("settlementStatus rejects overpaid history", () => {
    const history: Settlement[] = [{ amount: cents(9000), reversed: false }];
    expect(() => settlementStatus(cents(8000), history)).toThrow(CentsError);
  });

  it("computeRemaining rejects invalid planned", () => {
    expect(() => computeRemaining(cents(-1), [])).toThrow(CentsError);
    expect(() => computeRemaining(1.5 as unknown as Cents, [])).toThrow(CentsError);
  });
});

describe("settlements: settlePayment invalid input returns ok:false", () => {
  it("rejects NaN planned as ok:false (no throw)", () => {
    const result = settlePayment({
      planned: NaN as unknown as Cents,
      settlements: [],
      payment: cents(1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.reason).toBe("string");
    }
  });

  it("rejects negative planned as ok:false", () => {
    const result = settlePayment({
      planned: cents(-1),
      settlements: [],
      payment: cents(1),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects malformed history as ok:false (no throw)", () => {
    const result = settlePayment({
      planned: cents(8000),
      settlements: [{ amount: cents(-1), reversed: false }],
      payment: cents(1),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects overpaid existing history as ok:false", () => {
    const result = settlePayment({
      planned: cents(8000),
      settlements: [{ amount: cents(9000), reversed: false }],
      payment: cents(1),
    });
    expect(result.ok).toBe(false);
  });
});

describe("settlements: constructor helpers validate", () => {
  it("activeSettlement rejects non-positive amounts", () => {
    expect(() => activeSettlement(0)).toThrow(CentsError);
    expect(() => activeSettlement(-100)).toThrow(CentsError);
    expect(() => activeSettlement(1.5)).toThrow(CentsError);
  });

  it("reversedSettlement rejects non-positive amounts", () => {
    expect(() => reversedSettlement(0)).toThrow(CentsError);
    expect(() => reversedSettlement(-100)).toThrow(CentsError);
  });

  it("constructors build valid entries", () => {
    expect(activeSettlement(4000)).toEqual({ amount: 4000, reversed: false });
    expect(reversedSettlement(4000)).toEqual({ amount: 4000, reversed: true });
  });
});