import { describe, expect, it } from "vitest";
import type { Product, Sale } from "@/core/types/models";
import {
  InvoiceDataError, buildCreditNote, buildGoodsUpload, buildInvoice, type InvoiceContext,
} from "@/features/efris/efrisInvoice";

const product = (id: string, price: number, taxRate: number, commodityCode?: string): Product => ({
  id, name: id, barcode: `${id}-code`, price, cost: price / 2, stock: 10, lowStockAt: 1, taxRate, active: true,
  efris: commodityCode ? { commodityCode, unitCode: "101" } : undefined, createdAt: 0, updatedAt: 0,
});

const soda = product("Soda", 2000, 18, "50202306");
const posho = product("Posho", 6000, 0, "50221101");

function context(products: Product[] = [soda, posho]): InvoiceContext {
  return {
    config: { tin: "1000000000", brn: "", legalName: "Kampala Traders Ltd", businessName: "Kampala Traders", deviceNo: "TCS123", vatRegistered: true },
    shop: { name: "Shop", address: "Kampala", phone: "0700000000", email: "shop@example.com", currency: "UGX", taxInclusive: true, cashierName: "Amina" },
    products: new Map(products.map((p) => [p.id, p])),
  };
}

function sale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: "s1", receiptNo: "R-000007", status: "completed", createdAt: Date.UTC(2026, 8, 24, 7), cashier: "Amina",
    items: [
      { productId: "Soda", name: "Soda", price: 2000, cost: 1000, qty: 3, taxRate: 18, lineTotal: 6000 },
      { productId: "Posho", name: "Posho", price: 6000, cost: 3000, qty: 1, taxRate: 0, lineTotal: 6000 },
    ],
    subtotal: 11084.75, discount: 1000, taxTotal: 915.25, total: 11000, costTotal: 6000, profit: 4084.75,
    paymentMethod: "cash", amountPaid: 11000, change: 0,
    ...overrides,
  };
}

const sum = (values: string[]) => Math.round(values.reduce((n, v) => n + Number(v), 0) * 100) / 100;

describe("EFRIS invoice (T109)", () => {
  it("keeps every total consistent with a discount spread over standard and exempt items", () => {
    const invoice = buildInvoice(sale(), context(), Date.UTC(2026, 8, 24, 7, 1));
    const gross = Number(invoice.summary.grossAmount);
    expect(gross).toBe(11000);
    expect(sum(invoice.goodsDetails.map((g) => g.total))).toBe(gross);
    expect(sum(invoice.taxDetails.map((t) => t.grossAmount))).toBe(gross);
    expect(sum(invoice.payWay.map((p) => p.paymentAmount))).toBe(gross);
    expect(Number(invoice.summary.netAmount) + Number(invoice.summary.taxAmount)).toBeCloseTo(gross, 2);

    const [sodaLine, sodaDiscount, poshoLine, poshoDiscount] = invoice.goodsDetails;
    expect(sodaLine).toMatchObject({ discountFlag: "1", taxRate: "0.18", total: "6000.00", orderNumber: 0, goodsCategoryId: "50202306" });
    expect(sodaDiscount).toMatchObject({ discountFlag: "0", total: "-500.00", orderNumber: 1 });
    expect(poshoLine).toMatchObject({ discountFlag: "1", taxRate: "-", tax: "0.00", orderNumber: 2 });
    expect(poshoDiscount).toMatchObject({ discountFlag: "0", total: "-500.00", orderNumber: 3 });
    expect(invoice.taxDetails.map((t) => t.taxCategoryCode).sort()).toEqual(["01", "03"]);
    expect(invoice.summary.modeCode).toBe("1");
    expect(invoice.basicInformation).toMatchObject({ issuedDate: "2026-09-24 10:00:00", invoiceKind: "1", dataSource: "103" });
    expect(invoice.sellerDetails).toMatchObject({ referenceNo: "TCS123-R-000007", isCheckReferenceNo: "1" });
    expect(invoice.buyerDetails.buyerType).toBe("1");
  });

  it("marks late uploads as offline, B2B buyers by TIN, and splits credit deposits", () => {
    const later = Date.UTC(2026, 8, 26);
    const invoice = buildInvoice(
      sale({ discount: 0, total: 12000, paymentMethod: "credit", amountPaid: 2000, balanceDue: 10000, customerTin: "1000099999", customerName: "Hotel Ltd" }),
      context(),
      later,
    );
    expect(invoice.summary.modeCode).toBe("0");
    expect(invoice.buyerDetails).toMatchObject({ buyerType: "0", buyerTin: "1000099999", buyerLegalName: "Hotel Ltd" });
    expect(invoice.payWay).toEqual([
      { paymentMode: "101", paymentAmount: "10000.00", orderNumber: "a" },
      { paymentMode: "102", paymentAmount: "2000.00", orderNumber: "b" },
    ]);
  });

  it("refuses items without a URA commodity code or with non-18% standard VAT", () => {
    expect(() => buildInvoice(sale(), context([soda, product("Posho", 6000, 0)]))).toThrow(InvoiceDataError);
    const odd = { ...soda, taxRate: 16 };
    const s = sale({ items: [{ productId: "Soda", name: "Soda", price: 2000, cost: 1000, qty: 1, taxRate: 16, lineTotal: 2000 }] });
    expect(() => buildInvoice(s, context([odd]))).toThrow(/18%/);
  });
});

describe("EFRIS credit note (T110) and goods (T130)", () => {
  it("reverses a fiscalised sale with negative totals no larger than the original", () => {
    const fiscalised = sale({ efris: { status: "fiscalised", invoiceNo: "324000001", invoiceId: "ID1", attempts: 1 } });
    const note = buildCreditNote(fiscalised, context(), "102", "Sale cancelled");
    expect(note).toMatchObject({ oriInvoiceNo: "324000001", oriInvoiceId: "ID1", invoiceApplyCategoryCode: "101", reasonCode: "102" });
    const gross = Number(note.summary.grossAmount);
    expect(gross).toBeLessThan(0);
    expect(-gross).toBeLessThanOrEqual(11000);
    expect(sum(note.goodsDetails.map((g) => g.total))).toBe(gross);
    expect(note.goodsDetails.map((g) => g.orderNumber)).toEqual([0, 2]);
    expect(note.goodsDetails.every((g) => Number(g.qty) < 0)).toBe(true);
  });

  it("refuses a credit note for a sale URA never received", () => {
    expect(() => buildCreditNote(sale(), context(), "102", "x")).toThrow(InvoiceDataError);
  });

  it("builds goods registrations with the tax-inclusive price", () => {
    expect(buildGoodsUpload(soda, { taxInclusive: false })).toMatchObject({
      operationType: "101", goodsCode: "Soda-code", unitPrice: "2360.00", commodityCategoryId: "50202306", measureUnit: "101",
    });
  });
});
