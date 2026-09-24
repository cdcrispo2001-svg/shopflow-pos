import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db/database";
import { buildBackup, restoreBackup, salesToCsv } from "@/core/utils/backup";
import { saleRepo } from "@/features/sales/saleRepo";
import { addProduct, draftFor, resetDb } from "./helpers";

beforeEach(resetDb);

async function seedCreditSale() {
  const sugar = await addProduct();
  const res = await saleRepo.record(
    draftFor([{ product: sugar, qty: 2 }], { method: "credit", paid: 2_000, customerName: "Mugisha" }),
  );
  if (!res.ok) throw new Error(res.error.message);
  const paid = await saleRepo.recordPayment(res.value.id, 3_000, "mobile_money");
  if (!paid.ok) throw new Error(paid.error.message);
  return paid.value;
}

describe("backup round trip", () => {
  it("restores credit balances and repayments exactly", async () => {
    const sale = await seedCreditSale();
    const json = JSON.stringify(await buildBackup());
    await db.sales.clear();

    const res = await restoreBackup(json);
    expect(res.ok).toBe(true);
    const restored = await db.sales.get(sale.id);
    expect(restored?.balanceDue).toBe(5_000);
    expect(restored?.amountPaid).toBe(5_000);
    expect(restored?.payments).toHaveLength(1);
  });

  it("still restores version-1 backups where credit sales were fully paid", async () => {
    const sale = await seedCreditSale();
    const bundle = await buildBackup();
    const legacy = {
      ...bundle,
      version: 1,
      sales: bundle.sales.map(({ balanceDue: _b, payments: _p, ...s }) => ({ ...s, amountPaid: s.total })),
    };
    const res = await restoreBackup(JSON.stringify(legacy));
    expect(res.ok).toBe(true);
    expect((await db.sales.get(sale.id))?.balanceDue).toBeUndefined();
  });

  it("rejects a credit sale whose paid + balance does not equal the total", async () => {
    await seedCreditSale();
    const bundle = await buildBackup();
    bundle.sales[0] = { ...bundle.sales[0], balanceDue: 1 };
    const res = await restoreBackup(JSON.stringify(bundle));
    expect(res.ok).toBe(false);
    expect(await db.sales.count()).toBe(1); // nothing replaced on failure
  });

  it("keeps product pictures and URA fiscal data, but rejects bad photos", async () => {
    const soda = await addProduct({ name: "Soda", imageKey: "soda", efris: { commodityCode: "50202306", taxCategory: "01" } });
    const res = await saleRepo.record({ ...draftFor([{ product: soda, qty: 1 }], { method: "cash" }), efris: { status: "pending", attempts: 0 } });
    if (!res.ok) throw new Error(res.error.message);
    await db.sales.update(res.value.id, {
      efris: { status: "fiscalised", invoiceNo: "324000001", invoiceId: "ID1", antifakeCode: "123", qrCode: "https://x", sellerTin: "1000000000", attempts: 1 },
    });
    const bundle = await buildBackup();
    expect(bundle.version).toBe(3);

    expect((await restoreBackup(JSON.stringify(bundle))).ok).toBe(true);
    expect((await db.products.get(soda.id))).toMatchObject({ imageKey: "soda", efris: { commodityCode: "50202306" } });
    expect((await db.sales.get(res.value.id))?.efris).toMatchObject({ status: "fiscalised", invoiceNo: "324000001" });

    const tampered = { ...bundle, products: bundle.products.map((p) => ({ ...p, photo: "data:text/html;base64,PHNjcmlwdD4=" })) };
    expect((await restoreBackup(JSON.stringify(tampered))).ok).toBe(false);
  });

  it("writes paid and balance columns to the CSV", async () => {
    const sale = await seedCreditSale();
    const [header, row] = salesToCsv([sale], "USh").split("\n");
    expect(header).toContain('"paid","balance"');
    expect(row).toContain('"5000","5000"');
  });
});
