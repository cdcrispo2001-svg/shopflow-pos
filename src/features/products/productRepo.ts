import { db } from "@/core/db/database";
import type { Product } from "@/core/types/models";
import { type Result, attempt } from "@/core/types/result";
import { newId } from "@/core/utils/format";

export type ProductInput = Omit<Product, "id" | "createdAt" | "updatedAt">;

export const productRepo = {
  all(): Promise<Product[]> {
    return db.products.orderBy("name").toArray();
  },

  async findByBarcode(barcode: string): Promise<Product | undefined> {
    return db.products.where("barcode").equals(barcode).first();
  },

  async create(input: ProductInput): Promise<Result<Product>> {
    return attempt(async () => {
      const now = Date.now();
      const product: Product = { ...input, id: newId("p_"), createdAt: now, updatedAt: now };
      await db.products.add(product);
      return product;
    }, "Creating product");
  },

  async update(id: string, patch: Partial<ProductInput>): Promise<Result<number>> {
    return attempt(
      () => db.products.update(id, { ...patch, updatedAt: Date.now() }),
      "Updating product",
    );
  },

  async remove(id: string): Promise<Result<void>> {
    return attempt(() => db.products.delete(id), "Deleting product");
  },

  /** Decrements stock for each sold line (called atomically on checkout). */
  async decrementStock(items: { productId: string; qty: number }[]): Promise<void> {
    await db.transaction("rw", db.products, async () => {
      for (const { productId, qty } of items) {
        const p = await db.products.get(productId);
        if (p) await db.products.update(productId, { stock: p.stock - qty, updatedAt: Date.now() });
      }
    });
  },

  async restock(items: { productId: string; qty: number }[]): Promise<void> {
    await db.transaction("rw", db.products, async () => {
      for (const { productId, qty } of items) {
        const p = await db.products.get(productId);
        if (p) await db.products.update(productId, { stock: p.stock + qty, updatedAt: Date.now() });
      }
    });
  },
};
