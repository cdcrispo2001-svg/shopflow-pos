import { DEFAULT_SETTINGS, db } from "@/core/db/database";
import type { Sale, SaleEfris } from "@/core/types/models";
import { EfrisClient, type SignInResult } from "@/features/efris/efrisClient";
import { EfrisError } from "@/features/efris/efrisProtocol";
import {
  buildCreditNote, buildGoodsUpload, buildInvoice, referenceNo, type InvoiceContext,
} from "@/features/efris/efrisInvoice";
import {
  getEfrisConfig, isEfrisActive, saveEfrisConfig, saveEfrisDictionary,
} from "@/features/efris/efrisStore";

// Fiscalisation workflow. Every sale made while EFRIS is on is saved as
// "pending" and uploaded here — immediately when online, otherwise later.
// URA only allows a device to stay offline for a few days (config.offlineDays).

export const PENDING_EFRIS: SaleEfris = { status: "pending", attempts: 0 };
const DAY = 86_400_000;

export type FiscaliseOutcome = "fiscalised" | "pending" | "failed" | "skipped";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown EFRIS error.";
}

async function invoiceContext(): Promise<InvoiceContext> {
  const [settings, config, products] = await Promise.all([
    db.settings.get("shop"),
    getEfrisConfig(),
    db.products.toArray(),
  ]);
  return {
    config,
    shop: { ...DEFAULT_SETTINGS, ...settings },
    products: new Map(products.map((product) => [product.id, product])),
  };
}

async function patchEfris(saleId: string, patch: Partial<SaleEfris>): Promise<void> {
  await db.transaction("rw", db.sales, async () => {
    const sale = await db.sales.get(saleId);
    if (sale?.efris) await db.sales.update(saleId, { efris: { ...sale.efris, ...patch } });
  });
}

/** Uploads one sale to URA and records the FDN, or why it could not be sent. */
export async function fiscaliseSale(saleId: string, client?: EfrisClient): Promise<FiscaliseOutcome> {
  const sale = await db.sales.get(saleId);
  if (!sale?.efris || sale.efris.status === "fiscalised" || sale.efris.status === "cancelled") return "skipped";
  if (sale.status !== "completed") {
    await patchEfris(saleId, { status: "cancelled" }); // never reached URA, nothing to reverse
    return "skipped";
  }

  let api: EfrisClient;
  try {
    api = client ?? (await EfrisClient.fromStore(undefined, sale.cashier));
  } catch (error) {
    await patchEfris(saleId, { lastError: describe(error) }); // setup incomplete: stay pending
    return "pending";
  }

  const attempts = sale.efris.attempts + 1;
  const now = Date.now();
  let ctx: InvoiceContext;
  let invoice: ReturnType<typeof buildInvoice>;
  try {
    ctx = await invoiceContext();
    invoice = buildInvoice(sale, ctx, now);
  } catch (error) {
    await patchEfris(saleId, { status: "failed", attempts, lastAttemptAt: now, lastError: describe(error) });
    return "failed";
  }

  try {
    let result;
    try {
      result = await api.uploadInvoice(invoice);
    } catch (error) {
      // A retry after a lost reply is rejected as a duplicate reference: fetch the original instead.
      if (!(error instanceof EfrisError) || error.retryable || !/reference/i.test(error.message)) throw error;
      result = await api.findInvoice(referenceNo(sale, ctx.config.deviceNo), sale.createdAt);
      if (!result) throw error;
    }
    await patchEfris(saleId, {
      status: "fiscalised", ...result, sellerTin: ctx.config.tin, fiscalisedAt: Date.now(),
      attempts, lastAttemptAt: now, lastError: undefined,
    });
    return "fiscalised";
  } catch (error) {
    const retry = !(error instanceof EfrisError) || error.retryable;
    await patchEfris(saleId, { status: retry ? "pending" : "failed", attempts, lastAttemptAt: now, lastError: describe(error) });
    return retry ? "pending" : "failed";
  }
}

export interface QueueResult { fiscalised: number; failed: number; pending: number; error?: string }

let running: Promise<QueueResult> | null = null;

async function runQueue(client?: EfrisClient): Promise<QueueResult> {
  const result: QueueResult = { fiscalised: 0, failed: 0, pending: 0 };
  if (!(await isEfrisActive())) return result;
  const queue = (await db.sales.toArray())
    .filter((sale) => sale.efris?.status === "pending")
    .sort((a, b) => a.createdAt - b.createdAt);
  if (queue.length === 0) return result;

  let api = client;
  try {
    api ??= await EfrisClient.fromStore();
  } catch (error) {
    return { ...result, pending: queue.length, error: describe(error) };
  }
  for (const [index, sale] of queue.entries()) {
    const outcome = await fiscaliseSale(sale.id, api);
    if (outcome === "fiscalised") result.fiscalised += 1;
    if (outcome === "failed") result.failed += 1;
    if (outcome === "pending") {
      // Offline or URA unavailable: stop and try the rest later.
      result.pending = queue.length - index;
      result.error = (await db.sales.get(sale.id))?.efris?.lastError;
      break;
    }
  }
  return result;
}

/** Uploads all pending sales, oldest first. Concurrent calls share one run. */
export function processQueue(client?: EfrisClient): Promise<QueueResult> {
  running ??= runQueue(client).finally(() => {
    running = null;
  });
  return running;
}

/** Puts failed sales back in the queue (after fixing their product codes) and runs it. */
export async function retryFailed(saleId?: string, client?: EfrisClient): Promise<QueueResult> {
  const failed = (await db.sales.toArray()).filter(
    (sale) => sale.efris?.status === "failed" && (!saleId || sale.id === saleId),
  );
  for (const sale of failed) await patchEfris(sale.id, { status: "pending" });
  return processQueue(client);
}

/** Applies for a URA credit note reversing a fiscalised sale (before voiding/refunding it). */
export async function submitCreditNote(saleId: string, mode: "voided" | "refunded", client?: EfrisClient): Promise<string> {
  const sale = await db.sales.get(saleId);
  if (sale?.efris?.status !== "fiscalised") throw new Error("This sale has not been fiscalised with URA.");
  if (sale.efris.creditNote) return sale.efris.creditNote.referenceNo;
  const reasonCode = mode === "refunded" ? "101" : "102"; // goods returned | sale cancelled
  const reason = mode === "refunded" ? "Goods returned by the customer" : "Sale cancelled";
  const application = buildCreditNote(sale, await invoiceContext(), reasonCode, reason);
  const api = client ?? (await EfrisClient.fromStore(undefined, sale.cashier));
  const creditReference = await api.applyCreditNote(application);
  await patchEfris(saleId, { creditNote: { referenceNo: creditReference, submittedAt: Date.now(), reasonCode } });
  return creditReference;
}

export interface RegisterResult { registered: number; failed: { name: string; message: string }[]; skipped: number }

/** Registers (T130) products that have a commodity code but are not yet known to URA. */
export async function registerProducts(client?: EfrisClient): Promise<RegisterResult> {
  const settings = { ...DEFAULT_SETTINGS, ...(await db.settings.get("shop")) };
  const products = (await db.products.toArray()).filter((product) => product.active);
  const ready = products.filter((product) => product.efris?.commodityCode && !product.efris.registeredAt);
  const result: RegisterResult = { registered: 0, failed: [], skipped: products.length - ready.length };
  if (ready.length === 0) return result;
  const api = client ?? (await EfrisClient.fromStore());
  for (let start = 0; start < ready.length; start += 20) {
    const batch = ready.slice(start, start + 20);
    const goods = batch.map((product) => buildGoodsUpload(product, settings));
    const replies = await api.uploadGoods(goods);
    for (const [index, product] of batch.entries()) {
      const reply = replies[index];
      if (reply.ok) {
        await db.products.update(product.id, { efris: { ...product.efris, registeredAt: Date.now() } });
        result.registered += 1;
      } else {
        result.failed.push({ name: product.name, message: reply.message ?? "Rejected by URA." });
      }
    }
  }
  return result;
}

export interface ConnectResult extends SignInResult { serverTime: string; units: number }

/** Checks the setup end to end: session key (T104), sign-in (T103) and dictionary (T115). */
export async function connectEfris(client?: EfrisClient): Promise<ConnectResult> {
  const api = client ?? (await EfrisClient.fromStore());
  const serverTime = await api.serverTime().catch(() => "");
  const info = await api.signIn();
  const config = await getEfrisConfig();
  await saveEfrisConfig({
    taxpayerId: info.taxpayerId,
    offlineDays: info.offlineDays,
    deviceStatus: info.deviceStatus,
    lastSignInAt: Date.now(),
    legalName: config.legalName || info.legalName,
    businessName: config.businessName || info.businessName,
    ...(info.vatRegistered === undefined ? {} : { vatRegistered: info.vatRegistered }),
  });
  let units = 0;
  try {
    const dictionary = await api.dictionary();
    units = dictionary.units.length;
    if (units) await saveEfrisDictionary(dictionary);
  } catch {
    // The dictionary only improves the unit picker; sign-in already proved the setup.
  }
  return { ...info, serverTime, units };
}

/** True when unsent sales are older than URA's offline allowance — new sales must wait. */
export async function offlineLimitReached(now = Date.now()): Promise<boolean> {
  if (!(await isEfrisActive())) return false;
  const [sales, config] = await Promise.all([db.sales.toArray(), getEfrisConfig()]);
  return efrisSummary(sales, config.offlineDays, now).overLimit;
}

export interface EfrisSummary {
  pending: number;
  failed: number;
  creditNotesDue: number;
  oldestAt?: number;
  ageDays: number;
  nearLimit: boolean;
  overLimit: boolean;
}

/** Queue health for banners and the checkout offline limit. */
export function efrisSummary(sales: Sale[], offlineDays: number, now = Date.now()): EfrisSummary {
  const open = sales.filter(
    (sale) => sale.status === "completed" && (sale.efris?.status === "pending" || sale.efris?.status === "failed"),
  );
  const oldestAt = open.length ? Math.min(...open.map((sale) => sale.createdAt)) : undefined;
  const ageDays = oldestAt === undefined ? 0 : (now - oldestAt) / DAY;
  return {
    pending: open.filter((sale) => sale.efris?.status === "pending").length,
    failed: open.filter((sale) => sale.efris?.status === "failed").length,
    creditNotesDue: sales.filter(
      (sale) => sale.status !== "completed" && sale.efris?.status === "fiscalised" && !sale.efris.creditNote,
    ).length,
    oldestAt,
    ageDays,
    nearLimit: oldestAt !== undefined && ageDays >= Math.max(0, offlineDays - 1),
    overLimit: oldestAt !== undefined && ageDays >= offlineDays,
  };
}
