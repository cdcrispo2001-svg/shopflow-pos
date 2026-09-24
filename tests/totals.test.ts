import { describe, expect, it } from "vitest";
import { computeTotals, type CartLine } from "@/core/utils/totals";

const line = (price: number, qty: number, taxRate = 0, cost = 0): CartLine => ({
  product: { id: `p${price}`, name: `Item ${price}`, price, cost, taxRate },
  qty,
});

describe("computeTotals", () => {
  it("backs tax out of tax-inclusive prices", () => {
    const t = computeTotals([line(1180, 1, 18, 800)], 0, { taxInclusive: true });
    expect(t.total).toBe(1180);
    expect(t.subtotal).toBe(1000);
    expect(t.taxTotal).toBe(180);
    expect(t.profit).toBe(200);
  });

  it("adds tax on top of tax-exclusive prices", () => {
    const t = computeTotals([line(1000, 2, 18)], 0, { taxInclusive: false });
    expect(t.subtotal).toBe(2000);
    expect(t.taxTotal).toBe(360);
    expect(t.total).toBe(2360);
  });

  it("caps the discount at the sale amount and counts items", () => {
    const t = computeTotals([line(500, 3)], 10_000, { taxInclusive: true });
    expect(t.discount).toBe(1500);
    expect(t.total).toBe(0);
    expect(t.itemCount).toBe(3);
  });

  it("rejects fractional quantities", () => {
    expect(() => computeTotals([line(500, 1.5)], 0, { taxInclusive: true })).toThrow(/whole number/);
  });
});
