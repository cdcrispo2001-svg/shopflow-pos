import { db } from "@/core/db/database";
import type { Product } from "@/core/types/models";
import { type Result, attempt } from "@/core/types/result";
import { newId } from "@/core/utils/format";

export type ProductInput = Omit<Product, "id" | "createdAt" | "updatedAt">;

function validateNumber(value: number, label: string, minimum: number, maximum = Infinity): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    const range = Number.isFinite(maximum) ? ` between ${minimum} and ${maximum}` : ` at least ${minimum}`;
    throw new Error(`${label} must be a finite number${range}.`);
  }
}

function validateProductInput(input: Partial<ProductInput>): void {
  if ("name" in input && (typeof input.name !== "string" || !input.name.trim())) {
    throw new Error("Product name is required.");
  }
  if ("price" in input) {
    validateNumber(input.price as number, "Selling price", 0);
    if ((input.price as number) <= 0) throw new Error("Selling price must be greater than 0.");
  }
  if ("cost" in input) validateNumber(input.cost as number, "Cost price", 0);
  if ("stock" in input) {
    validateNumber(input.stock as number, "Stock", 0, Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(input.stock)) throw new Error("Stock must be a whole number.");
  }
  if ("lowStockAt" in input) {
    validateNumber(input.lowStockAt as number, "Low-stock threshold", 0, Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(input.lowStockAt)) {
      throw new Error("Low-stock threshold must be a whole number.");
    }
  }
  if ("taxRate" in input) validateNumber(input.taxRate as number, "Tax rate", 0, 100);
}

export const productRepo = {
  all(): Promise<Product[]> {
    return db.products.orderBy("name").toArray();
  },

  async findByBarcode(barcode: string): Promise<Product | undefined> {
    return db.products.where("barcode").equals(barcode).first();
  },

  async create(input: ProductInput): Promise<Result<Product>> {
    return attempt(async () => {
      validateProductInput(input);
      const now = Date.now();
      const product: Product = { ...input, id: newId("p_"), createdAt: now, updatedAt: now };
      await db.products.add(product);
      return product;
    }, "Creating product");
  },

  async update(id: string, patch: Partial<ProductInput>): Promise<Result<number>> {
    return attempt(async () => {
      validateProductInput(patch);
      return db.products.update(id, { ...patch, updatedAt: Date.now() });
    }, "Updating product");
  },

  async remove(id: string): Promise<Result<void>> {
    return attempt(() => db.products.delete(id), "Deleting product");
  },

  /** Decrements stock for each sold line (called atomically on checkout). */
  async decrementStock(items: { productId: string; qty: number }[]): Promise<void> {
    await db.transaction("rw", db.products, async () => {
      for (const { productId, qty } of items) {
        if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error("Quantity must be positive.");
        const p = await db.products.get(productId);
        if (!p) throw new Error("Product not found.");
        if (!Number.isFinite(p.stock) || p.stock < qty) throw new Error(`Insufficient stock for ${p.name}.`);
        await db.products.update(productId, { stock: p.stock - qty, updatedAt: Date.now() });
      }
    });
  },

  async restock(items: { productId: string; qty: number }[]): Promise<void> {
    await db.transaction("rw", db.products, async () => {
      for (const { productId, qty } of items) {
        if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error("Quantity must be positive.");
        const p = await db.products.get(productId);
        if (!p) throw new Error("Product not found.");
        if (!Number.isFinite(p.stock) || p.stock < 0) throw new Error(`${p.name} has invalid stock data.`);
        const stock = p.stock + qty;
        if (!Number.isFinite(stock)) throw new Error(`Restocked quantity for ${p.name} is too large.`);
        await db.products.update(productId, { stock, updatedAt: Date.now() });
      }
    });
  },
};
