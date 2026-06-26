import type { Sale, SaleItem, ShopSettings } from "@/core/types/models";
import { roundMoney } from "@/core/utils/format";

export interface CartLine {
  product: {
    id: string;
    name: string;
    barcode?: string;
    price: number;
    cost: number;
    taxRate: number;
  };
  qty: number;
}

export interface Totals {
  subtotal: number; // net of tax
  taxTotal: number;
  discount: number;
  total: number; // payable
  costTotal: number;
  profit: number;
  itemCount: number;
}

/**
 * Core order-calculation logic. Handles both tax-inclusive and tax-exclusive
 * pricing so receipts and reports stay consistent. Pure & unit-testable.
 */
export function computeTotals(
  lines: CartLine[],
  discount: number,
  settings: Pick<ShopSettings, "taxInclusive">,
): Totals {
  let subtotal = 0;
  let taxTotal = 0;
  let costTotal = 0;
  let itemCount = 0;

  for (const { product, qty } of lines) {
    itemCount += qty;
    costTotal += product.cost * qty;
    const lineGross = product.price * qty;
    const rate = product.taxRate / 100;

    if (settings.taxInclusive) {
      // entered price already contains tax — back it out
      const net = rate > 0 ? lineGross / (1 + rate) : lineGross;
      subtotal += net;
      taxTotal += lineGross - net;
    } else {
      subtotal += lineGross;
      taxTotal += lineGross * rate;
    }
  }

  const cappedDiscount = Math.min(Math.max(discount, 0), subtotal + taxTotal);
  const total = subtotal + taxTotal - cappedDiscount;
  // profit = net revenue (after discount, excl. tax) - cost
  const profit = subtotal - costTotal - cappedDiscount;

  return {
    subtotal: roundMoney(subtotal),
    taxTotal: roundMoney(taxTotal),
    discount: roundMoney(cappedDiscount),
    total: roundMoney(total),
    costTotal: roundMoney(costTotal),
    profit: roundMoney(profit),
    itemCount,
  };
}

export function cartLineToSaleItem(line: CartLine): SaleItem {
  return {
    productId: line.product.id,
    name: line.product.name,
    barcode: line.product.barcode,
    price: line.product.price,
    cost: line.product.cost,
    qty: line.qty,
    taxRate: line.product.taxRate,
    lineTotal: roundMoney(line.product.price * line.qty),
  };
}

export type SaleDraft = Omit<Sale, "id" | "receiptNo" | "createdAt" | "status">;
