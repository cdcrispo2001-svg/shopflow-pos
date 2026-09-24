import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import forge from "node-forge";
import { DEFAULT_SETTINGS, db } from "@/core/db/database";
import type { Product } from "@/core/types/models";
import { productRepo } from "@/features/products/productRepo";
import { saleRepo } from "@/features/sales/saleRepo";
import { EfrisClient } from "@/features/efris/efrisClient";
import {
  PENDING_EFRIS, connectEfris, efrisSummary, fiscaliseSale, offlineLimitReached, processQueue,
  registerProducts, retryFailed, submitCreditNote,
} from "@/features/efris/efrisQueue";
import { getEfrisConfig, saveEfrisConfig, saveEfrisKey, type EfrisKeyMaterial } from "@/features/efris/efrisStore";
import { FakeUra } from "./fakeUra";
import { addProduct, draftFor, resetDb } from "./helpers";

let keys: forge.pki.rsa.KeyPair;
let key: EfrisKeyMaterial;
let ura: FakeUra;
let client: EfrisClient;
let soda: Product;

beforeAll(() => {
  keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  key = { privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey), fingerprint: "TEST", subject: "", importedAt: 0 };
});

beforeEach(async () => {
  await resetDb();
  await db.efris.clear();
  await db.settings.put({ ...DEFAULT_SETTINGS, country: "UG" });
  const config = await saveEfrisConfig({ enabled: true, tin: "1000000000", deviceNo: "TCS123" });
  await saveEfrisKey(key);
  ura = new FakeUra(keys.publicKey);
  client = new EfrisClient(config, key, ura.transport);
  soda = await addProduct({ name: "Soda 500ml", price: 2000, taxRate: 18, stock: 50, efris: { commodityCode: "50202306" } });
});

async function sell(product = soda, qty = 1, createdAt?: number) {
  const res = await saleRepo.record({ ...draftFor([{ product, qty }], { method: "cash" }), efris: { ...PENDING_EFRIS } });
  if (!res.ok) throw new Error(res.error.message);
  if (createdAt) await db.sales.update(res.value.id, { createdAt });
  return res.value;
}

describe("EFRIS fiscalisation queue", () => {
  it("fiscalises a sale and stores the FDN, verification code and QR", async () => {
    const sale = await sell(soda, 2);
    expect(await fiscaliseSale(sale.id, client)).toBe("fiscalised");
    const efris = (await db.sales.get(sale.id))?.efris;
    expect(efris).toMatchObject({ status: "fiscalised", invoiceNo: "32400001", antifakeCode: "12345678901234567890", sellerTin: "1000000000", attempts: 1 });
    expect(efris?.qrCode).toContain("32400001");
    expect(ura.count("T104")).toBe(1); // session key fetched once, then cached
    expect(ura.last("T109")).toMatchObject({ summary: { grossAmount: "4000.00", taxAmount: "610.17" } });
  });

  it("keeps sales pending while offline and sends them when back online", async () => {
    const sale = await sell();
    ura.offline = true;
    expect(await fiscaliseSale(sale.id, client)).toBe("pending");
    expect((await db.sales.get(sale.id))?.efris).toMatchObject({ status: "pending", attempts: 1 });

    ura.offline = false;
    expect(await processQueue(client)).toMatchObject({ fiscalised: 1, pending: 0 });
    expect((await db.sales.get(sale.id))?.efris?.status).toBe("fiscalised");
  });

  it("recovers the original invoice when URA's reply was lost, without fiscalising twice", async () => {
    const sale = await sell();
    ura.loseNextInvoiceReply = true;
    expect(await fiscaliseSale(sale.id, client)).toBe("pending");
    expect(await fiscaliseSale(sale.id, client)).toBe("fiscalised");
    expect(ura.invoices.size).toBe(1);
    expect(ura.count("T106")).toBe(1);
    expect((await db.sales.get(sale.id))?.efris?.invoiceNo).toBe("32400001");
  });

  it("marks sales URA cannot accept as failed, and retries after the product is fixed", async () => {
    const plain = await addProduct({ name: "Bread", barcode: "7001", price: 4000, stock: 5 });
    const sale = await sell(plain);
    expect(await fiscaliseSale(sale.id, client)).toBe("failed");
    expect((await db.sales.get(sale.id))?.efris?.lastError).toMatch(/commodity code/);

    await productRepo.update(plain.id, { efris: { commodityCode: "50181901" } });
    expect(await retryFailed(sale.id, client)).toMatchObject({ fiscalised: 1 });
  });

  it("never sends a sale voided before it reached URA", async () => {
    const sale = await sell();
    await saleRepo.voidSale(sale.id, "voided");
    expect((await db.sales.get(sale.id))?.efris?.status).toBe("cancelled");
    expect(await processQueue(client)).toMatchObject({ fiscalised: 0 });
    expect(ura.count("T109")).toBe(0);
  });

  it("submits a credit note for a fiscalised sale", async () => {
    const sale = await sell();
    await fiscaliseSale(sale.id, client);
    expect(await submitCreditNote(sale.id, "refunded", client)).toBe("CN0001");
    expect((await db.sales.get(sale.id))?.efris?.creditNote).toMatchObject({ referenceNo: "CN0001", reasonCode: "101" });
    expect(ura.last("T110")).toMatchObject({ oriInvoiceNo: "32400001", summary: { grossAmount: "-2000.00" } });
  });

  it("connects, registers products and enforces the offline limit", async () => {
    const connected = await connectEfris(client);
    expect(connected).toMatchObject({ legalName: "Kampala Traders Ltd", offlineDays: 5, vatRegistered: true, units: 2 });
    expect(await getEfrisConfig()).toMatchObject({ taxpayerId: "42", legalName: "Kampala Traders Ltd", vatRegistered: true });

    expect(await registerProducts(client)).toMatchObject({ registered: 1, failed: [] });
    expect((await db.products.get(soda.id))?.efris?.registeredAt).toBeTypeOf("number");

    const sixDaysAgo = Date.now() - 6 * 86_400_000;
    await sell(soda, 1, sixDaysAgo);
    expect(efrisSummary(await db.sales.toArray(), 5)).toMatchObject({ pending: 1, overLimit: true });
    expect(await offlineLimitReached()).toBe(true);
  });
});
