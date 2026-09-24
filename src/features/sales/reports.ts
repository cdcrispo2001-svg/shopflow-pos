import type { Product, Sale } from "@/core/types/models";
import {
  startOfDay, endOfDay, subDays, isAfter, format,
} from "date-fns";

// Pure reporting/aggregation functions that turn raw sales into the metrics a
// shop owner needs to make decisions. No DB or UI concerns here.

export interface RangeMetrics {
  revenue: number;
  profit: number;
  transactions: number;
  itemsSold: number;
  avgSale: number;
  tax: number;
}

const completed = (sales: Sale[]) => sales.filter((s) => s.status === "completed");

export function metricsBetween(sales: Sale[], from: number, to: number): RangeMetrics {
  const inRange = completed(sales).filter((s) => s.createdAt >= from && s.createdAt <= to);
  const revenue = inRange.reduce((n, s) => n + s.total, 0);
  const profit = inRange.reduce((n, s) => n + s.profit, 0);
  const tax = inRange.reduce((n, s) => n + s.taxTotal, 0);
  const itemsSold = inRange.reduce((n, s) => n + s.items.reduce((m, i) => m + i.qty, 0), 0);
  const transactions = inRange.length;
  return {
    revenue,
    profit,
    tax,
    itemsSold,
    transactions,
    avgSale: transactions ? revenue / transactions : 0,
  };
}

export function todayMetrics(sales: Sale[]): RangeMetrics {
  const now = new Date();
  return metricsBetween(sales, startOfDay(now).getTime(), endOfDay(now).getTime());
}

export interface DayPoint { day: string; revenue: number; profit: number; }

/** Revenue & profit per day for the last N days (for the trend chart). */
export function dailyTrend(sales: Sale[], days = 7): DayPoint[] {
  const out: DayPoint[] = [];
  const c = completed(sales);
  for (let i = days - 1; i >= 0; i--) {
    const d = subDays(new Date(), i);
    const from = startOfDay(d).getTime();
    const to = endOfDay(d).getTime();
    const dayMetrics = c.filter((s) => s.createdAt >= from && s.createdAt <= to);
    out.push({
      day: format(d, "EEE"),
      revenue: dayMetrics.reduce((n, s) => n + s.total, 0),
      profit: dayMetrics.reduce((n, s) => n + s.profit, 0),
    });
  }
  return out;
}

export interface TopProduct { productId: string; name: string; qty: number; revenue: number; }

export function topProducts(sales: Sale[], days = 30, limit = 5): TopProduct[] {
  const from = subDays(new Date(), days).getTime();
  const map = new Map<string, TopProduct>();
  for (const s of completed(sales)) {
    if (!isAfter(s.createdAt, from)) continue;
    for (const it of s.items) {
      const cur = map.get(it.productId) ?? { productId: it.productId, name: it.name, qty: 0, revenue: 0 };
      cur.qty += it.qty;
      cur.revenue += it.lineTotal;
      map.set(it.productId, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, limit);
}

export interface PaymentSplit { method: string; amount: number; count: number; }

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  mobile_money: "Mobile Money",
  card: "Card",
  credit: "Credit",
};

export function paymentMethodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method.replace("_", " ");
}

export function paymentBreakdown(sales: Sale[], from: number, to: number): PaymentSplit[] {
  const map = new Map<string, PaymentSplit>();
  for (const s of completed(sales)) {
    if (s.createdAt < from || s.createdAt > to) continue;
    const cur = map.get(s.paymentMethod) ?? { method: paymentMethodLabel(s.paymentMethod), amount: 0, count: 0 };
    cur.amount += s.total;
    cur.count += 1;
    map.set(s.paymentMethod, cur);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export interface CreditSummary { amount: number; receipts: number; customers: number; }

/** Money customers still owe on completed credit sales. */
export function outstandingCredit(sales: Sale[]): CreditSummary {
  const owing = completed(sales).filter((s) => (s.balanceDue ?? 0) > 0);
  const customers = new Set(owing.map((s) => (s.customerName ?? "").trim().toLowerCase()));
  return {
    amount: owing.reduce((n, s) => n + (s.balanceDue ?? 0), 0),
    receipts: owing.length,
    customers: customers.size,
  };
}

export function lowStockProducts(products: Product[]): Product[] {
  return products
    .filter((p) => p.active && p.stock <= p.lowStockAt)
    .sort((a, b) => a.stock - b.stock);
}

export function inventoryValue(products: Product[]): number {
  return products.reduce((n, p) => n + p.cost * Math.max(0, p.stock), 0);
}
