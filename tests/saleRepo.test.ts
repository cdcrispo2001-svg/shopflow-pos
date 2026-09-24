import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db/database";
import { saleRepo } from "@/features/sales/saleRepo";
import { outstandingCredit } from "@/features/sales/reports";
import { addProduct, draftFor, resetDb } from "./helpers";

beforeEach(resetDb);

describe("saleRepo.record", () => {
  it("records a cash sale, numbers the receipt and decrements stock", async () => {
    const sugar = await addProduct({ stock: 4 });
    const res = await saleRepo.record(draftFor([{ product: sugar, qty: 2 }], { method: "cash", paid: 20_000 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.receiptNo).toBe("R-000001");
    expect(res.value.change).toBe(10_000);
    expect(res.value.balanceDue).toBeUndefined();
    expect((await db.products.get(sugar.id))?.stock).toBe(2);
  });

  it("refuses to sell more than is in stock", async () => {
    const sugar = await addProduct({ stock: 1 });
    const res = await saleRepo.record(draftFor([{ product: sugar, qty: 2 }], { method: "cash" }));
    expect(res.ok).toBe(false);
    expect((await db.products.get(sugar.id))?.stock).toBe(1);
  });

  it("requires a customer name for credit sales", async () => {
    const sugar = await addProduct();
    const res = await saleRepo.record(draftFor([{ product: sugar, qty: 1 }], { method: "credit", paid: 0 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/customer name/);
  });

  it("records a credit sale with a deposit and the balance owed", async () => {
    const sugar = await addProduct();
    const res = await saleRepo.record(
      draftFor([{ product: sugar, qty: 3 }], { method: "credit", paid: 5_000, customerName: "Nakato" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.amountPaid).toBe(5_000);
    expect(res.value.balanceDue).toBe(10_000);
    expect(res.value.payments).toEqual([]);
  });

  it("rejects a credit balance that does not match the deposit", async () => {
    const sugar = await addProduct();
    const draft = draftFor([{ product: sugar, qty: 1 }], { method: "credit", paid: 1_000, customerName: "Okello" });
    const res = await saleRepo.record({ ...draft, balanceDue: 0 });
    expect(res.ok).toBe(false);
  });

  it("rejects a balance on non-credit sales", async () => {
    const sugar = await addProduct();
    const draft = draftFor([{ product: sugar, qty: 1 }], { method: "mobile_money" });
    const res = await saleRepo.record({ ...draft, balanceDue: 500 });
    expect(res.ok).toBe(false);
  });
});

describe("saleRepo.recordPayment", () => {
  async function creditSale() {
    const sugar = await addProduct();
    const res = await saleRepo.record(
      draftFor([{ product: sugar, qty: 2 }], { method: "credit", paid: 0, customerName: "Achieng" }),
    );
    if (!res.ok) throw new Error(res.error.message);
    return res.value;
  }

  it("reduces the balance with part and then full repayments", async () => {
    const sale = await creditSale();
    const part = await saleRepo.recordPayment(sale.id, 4_000, "mobile_money");
    expect(part.ok).toBe(true);
    if (!part.ok) return;
    expect(part.value.balanceDue).toBe(6_000);
    expect(part.value.amountPaid).toBe(4_000);
    expect(outstandingCredit(await db.sales.toArray())).toEqual({ amount: 6_000, receipts: 1, customers: 1 });

    const rest = await saleRepo.recordPayment(sale.id, 6_000, "cash");
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.balanceDue).toBe(0);
    expect(rest.value.payments?.map((p) => p.amount)).toEqual([4_000, 6_000]);
    expect(outstandingCredit(await db.sales.toArray()).amount).toBe(0);
  });

  it("rejects overpayment and payments on settled or cancelled sales", async () => {
    const sale = await creditSale();
    expect((await saleRepo.recordPayment(sale.id, 10_001, "cash")).ok).toBe(false);

    expect((await saleRepo.voidSale(sale.id, "voided")).ok).toBe(true);
    const afterVoid = await saleRepo.recordPayment(sale.id, 1_000, "cash");
    expect(afterVoid.ok).toBe(false);
    expect(outstandingCredit(await db.sales.toArray()).amount).toBe(0);
  });
});

describe("saleRepo.voidSale", () => {
  it("restores stock once, even when cancelled twice", async () => {
    const sugar = await addProduct({ stock: 5 });
    const res = await saleRepo.record(draftFor([{ product: sugar, qty: 3 }], { method: "card" }));
    if (!res.ok) throw new Error(res.error.message);
    await saleRepo.voidSale(res.value.id, "refunded");
    await saleRepo.voidSale(res.value.id, "refunded");
    expect((await db.products.get(sugar.id))?.stock).toBe(5);
    expect((await db.sales.get(res.value.id))?.status).toBe("refunded");
  });
});
