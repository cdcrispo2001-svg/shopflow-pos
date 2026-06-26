import { db } from "@/core/db/database";
import type { Product } from "@/core/types/models";
import { newId } from "@/core/utils/format";

// One-tap sample catalogue so a new user can explore checkout & reports
// immediately. Never runs automatically.

const SAMPLE: Array<Omit<Product, "id" | "createdAt" | "updatedAt">> = [
  { name: "Sugar 1kg", barcode: "6001234500017", category: "Groceries", price: 4500, cost: 3800, stock: 40, lowStockAt: 8, taxRate: 0, active: true },
  { name: "Cooking Oil 1L", barcode: "6001234500024", category: "Groceries", price: 8000, cost: 6800, stock: 25, lowStockAt: 6, taxRate: 0, active: true },
  { name: "Maize Flour 2kg", barcode: "6001234500031", category: "Groceries", price: 6000, cost: 5000, stock: 30, lowStockAt: 6, taxRate: 0, active: true },
  { name: "Bread Loaf", barcode: "6001234500048", category: "Bakery", price: 4000, cost: 3200, stock: 15, lowStockAt: 5, taxRate: 0, active: true },
  { name: "Soda 500ml", barcode: "6001234500055", category: "Drinks", price: 2000, cost: 1500, stock: 60, lowStockAt: 12, taxRate: 18, active: true },
  { name: "Mineral Water 1.5L", barcode: "6001234500062", category: "Drinks", price: 1500, cost: 1000, stock: 50, lowStockAt: 10, taxRate: 18, active: true },
  { name: "Bar Soap", barcode: "6001234500079", category: "Household", price: 3000, cost: 2400, stock: 4, lowStockAt: 6, taxRate: 0, active: true },
  { name: "Exercise Book", barcode: "6001234500086", category: "Stationery", price: 1200, cost: 800, stock: 100, lowStockAt: 20, taxRate: 0, active: true },
];

export async function seedSampleProducts(): Promise<number> {
  const now = Date.now();
  const rows: Product[] = SAMPLE.map((p, i) => ({
    ...p,
    id: newId("p_"),
    createdAt: now + i,
    updatedAt: now + i,
  }));
  await db.products.bulkPut(rows);
  return rows.length;
}
