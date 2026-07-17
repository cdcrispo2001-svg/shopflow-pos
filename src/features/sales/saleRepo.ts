import { db } from "@/core/db/database";
import type { Product, Sale } from "@/core/types/models";
import { type Result, attempt } from "@/core/types/result";
import { newId } from "@/core/utils/format";
import type { SaleDraft } from "@/core/utils/totals";

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
}

function closeEnough(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 0.011;
}

function nextReceiptNumber(sales: Sale[]): string {
  let max = 0;
  for (const sale of sales) {
    const match = /^R-(\d+)$/.exec(sale.receiptNo);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `R-${String(max + 1).padStart(6, "0")}`;
}

function validatedQuantities(items: SaleDraft["items"]): Map<string, number> {
  if (items.length === 0) throw new Error("A sale must contain at least one item.");

  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!item.productId) throw new Error("Each sale item must reference a product.");
    if (!Number.isSafeInteger(item.qty) || item.qty <= 0) {
      throw new Error(`Quantity for ${item.name || "sale item"} must be a positive whole number.`);
    }
    assertFiniteNumber(item.price, `Price for ${item.name || "sale item"}`);
    assertFiniteNumber(item.cost, `Cost for ${item.name || "sale item"}`);
    assertFiniteNumber(item.taxRate, `Tax rate for ${item.name || "sale item"}`);
    assertFiniteNumber(item.lineTotal, `Line total for ${item.name || "sale item"}`);
    if (item.price <= 0 || item.cost < 0 || item.taxRate < 0 || item.taxRate > 100) {
      throw new Error(`Invalid price, cost, or tax rate for ${item.name || "sale item"}.`);
    }
    if (item.lineTotal < 0 || !closeEnough(item.lineTotal, item.price * item.qty)) {
      throw new Error(`Line total for ${item.name || "sale item"} is inconsistent.`);
    }

    const totalQty = (quantities.get(item.productId) ?? 0) + item.qty;
    if (!Number.isSafeInteger(totalQty)) throw new Error("Combined item quantity is too large.");
    quantities.set(item.productId, totalQty);
  }
  return quantities;
}

function validateDraftMoney(draft: SaleDraft): void {
  const nonnegativeFields: [string, number][] = [
    ["Subtotal", draft.subtotal],
    ["Discount", draft.discount],
    ["Tax total", draft.taxTotal],
    ["Sale total", draft.total],
    ["Cost total", draft.costTotal],
    ["Amount paid", draft.amountPaid],
    ["Change", draft.change],
  ];
  for (const [label, value] of nonnegativeFields) {
    assertFiniteNumber(value, label);
    if (value < 0) throw new Error(`${label} must not be negative.`);
  }
  assertFiniteNumber(draft.profit, "Profit");
  if (!["cash", "mobile_money", "card", "credit"].includes(draft.paymentMethod)) {
    throw new Error("Payment method is invalid.");
  }

  const grossItems = draft.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const itemCosts = draft.items.reduce((sum, item) => sum + item.cost * item.qty, 0);
  if (!closeEnough(draft.subtotal + draft.taxTotal, grossItems)) {
    throw new Error("Sale subtotal and tax do not match its items.");
  }
  if (draft.discount > draft.subtotal + draft.taxTotal) {
    throw new Error("Discount exceeds the sale amount.");
  }
  if (!closeEnough(draft.total, draft.subtotal + draft.taxTotal - draft.discount)) {
    throw new Error("Sale total is inconsistent.");
  }
  if (!closeEnough(draft.costTotal, itemCosts)) throw new Error("Sale cost total is inconsistent.");
  if (!closeEnough(draft.profit, draft.subtotal - draft.costTotal - draft.discount)) {
    throw new Error("Sale profit is inconsistent.");
  }
  if (draft.paymentMethod === "cash") {
    if (draft.amountPaid < draft.total) throw new Error("Cash received is less than the sale total.");
    if (!closeEnough(draft.change, draft.amountPaid - draft.total)) {
      throw new Error("Cash change is inconsistent.");
    }
  } else if (!closeEnough(draft.amountPaid, draft.total) || !closeEnough(draft.change, 0)) {
    throw new Error("Non-cash payment amounts are inconsistent.");
  }
}

export const saleRepo = {
  all(): Promise<Sale[]> {
    return db.sales.orderBy("createdAt").reverse().toArray();
  },

  get(id: string): Promise<Sale | undefined> {
    return db.sales.get(id);
  },

  /** Persists a completed sale and decrements stock atomically. */
  async record(draft: SaleDraft): Promise<Result<Sale>> {
    return attempt(async () => {
      const quantities = validatedQuantities(draft.items);
      validateDraftMoney(draft);

      return db.transaction("rw", db.sales, db.products, async () => {
        const products = new Map<string, Product>();
        for (const [productId, qty] of quantities) {
          const product = await db.products.get(productId);
          if (!product) throw new Error("A product in this cart no longer exists.");
          if (!product.active) throw new Error(`${product.name} is no longer active.`);
          assertFiniteNumber(product.price, `Price for ${product.name}`);
          assertFiniteNumber(product.cost, `Cost for ${product.name}`);
          assertFiniteNumber(product.taxRate, `Tax rate for ${product.name}`);
          assertFiniteNumber(product.stock, `Stock for ${product.name}`);
          if (product.price <= 0 || product.cost < 0 || product.taxRate < 0 || product.taxRate > 100) {
            throw new Error(`${product.name} has invalid price, cost, or tax data.`);
          }
          if (product.stock < qty) throw new Error(`Insufficient stock for ${product.name}.`);
          products.set(productId, product);
        }

        const existingSales = await db.sales.toArray();
        const sale: Sale = {
          ...draft,
          id: newId("s_"),
          receiptNo: nextReceiptNumber(existingSales),
          status: "completed",
          createdAt: Date.now(),
        };
        await db.sales.add(sale);

        const now = Date.now();
        for (const [productId, qty] of quantities) {
          const product = products.get(productId)!;
          const stock = product.stock - qty;
          if (stock < 0) throw new Error(`Insufficient stock for ${product.name}.`);
          await db.products.update(productId, { stock, updatedAt: now });
        }
        return sale;
      });
    }, "Recording sale");
  },

  /** Voids/refunds a sale and returns stock to inventory. */
  async voidSale(id: string, mode: "voided" | "refunded"): Promise<Result<void>> {
    return attempt(async () => {
      await db.transaction("rw", db.sales, db.products, async () => {
        const sale = await db.sales.get(id);
        if (!sale) throw new Error("Sale not found.");
        // A repeated or concurrent cancellation is a successful no-op and must
        // never restock the same sale twice.
        if (sale.status !== "completed") return;

        const quantities = validatedQuantities(sale.items);
        const products = new Map<string, Product>();
        for (const productId of quantities.keys()) {
          const product = await db.products.get(productId);
          // Products may be hard-deleted after a historical sale. The financial
          // cancellation must still be recorded; only extant inventory can be restored.
          if (!product) continue;
          assertFiniteNumber(product.stock, `Stock for ${product.name}`);
          if (product.stock < 0) throw new Error(`${product.name} has invalid stock data.`);
          products.set(productId, product);
        }

        const now = Date.now();
        for (const [productId, qty] of quantities) {
          const product = products.get(productId);
          if (!product) continue;
          const stock = product.stock + qty;
          if (!Number.isFinite(stock)) throw new Error(`Restocked quantity for ${product.name} is too large.`);
          await db.products.update(productId, { stock, updatedAt: now });
        }
        await db.sales.update(id, { status: mode });
      });
    }, "Cancelling sale");
  },
};
