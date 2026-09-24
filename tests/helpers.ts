import { db } from "@/core/db/database";
import type { PaymentMethod, Product } from "@/core/types/models";
import { productRepo, type ProductInput } from "@/features/products/productRepo";
import { cartLineToSaleItem, computeTotals, type CartLine, type SaleDraft } from "@/core/utils/totals";

export async function resetDb(): Promise<void> {
  await Promise.all([db.products.clear(), db.sales.clear(), db.settings.clear()]);
}

export async function addProduct(overrides: Partial<ProductInput> = {}): Promise<Product> {
  const res = await productRepo.create({
    name: "Sugar 1kg",
    barcode: "6001",
    category: "Groceries",
    price: 5000,
    cost: 4000,
    stock: 10,
    lowStockAt: 2,
    taxRate: 0,
    active: true,
    ...overrides,
  });
  if (!res.ok) throw new Error(res.error.message);
  return res.value;
}

/** Builds a sale draft the same way the PaymentSheet does. */
export function draftFor(
  lines: { product: Product; qty: number }[],
  payment: { method: PaymentMethod; paid?: number; customerName?: string; discount?: number },
): SaleDraft {
  const cart: CartLine[] = lines.map(({ product, qty }) => ({ product, qty }));
  const totals = computeTotals(cart, payment.discount ?? 0, { taxInclusive: true });
  const { method } = payment;
  const paid = payment.paid ?? totals.total;
  return {
    items: cart.map(cartLineToSaleItem),
    subtotal: totals.subtotal,
    discount: totals.discount,
    taxTotal: totals.taxTotal,
    total: totals.total,
    costTotal: totals.costTotal,
    profit: totals.profit,
    paymentMethod: method,
    amountPaid: paid,
    change: method === "cash" ? Math.max(0, paid - totals.total) : 0,
    balanceDue: method === "credit" ? totals.total - paid : undefined,
    customerName: payment.customerName,
  };
}
