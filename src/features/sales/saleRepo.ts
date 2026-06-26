import { db } from "@/core/db/database";
import type { Sale } from "@/core/types/models";
import { type Result, attempt } from "@/core/types/result";
import { newId, receiptNumber } from "@/core/utils/format";
import { productRepo } from "@/features/products/productRepo";
import type { SaleDraft } from "@/core/utils/totals";

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
      const count = await db.sales.count();
      const sale: Sale = {
        ...draft,
        id: newId("s_"),
        receiptNo: receiptNumber(count),
        status: "completed",
        createdAt: Date.now(),
      };
      await db.sales.add(sale);
      await productRepo.decrementStock(
        sale.items.map((i) => ({ productId: i.productId, qty: i.qty })),
      );
      return sale;
    }, "Recording sale");
  },

  /** Voids/refunds a sale and returns stock to inventory. */
  async voidSale(id: string, mode: "voided" | "refunded"): Promise<Result<void>> {
    return attempt(async () => {
      const sale = await db.sales.get(id);
      if (!sale) throw new Error("Sale not found.");
      if (sale.status !== "completed") throw new Error("Sale already cancelled.");
      await db.sales.update(id, { status: mode });
      await productRepo.restock(
        sale.items.map((i) => ({ productId: i.productId, qty: i.qty })),
      );
    }, "Cancelling sale");
  },
};
