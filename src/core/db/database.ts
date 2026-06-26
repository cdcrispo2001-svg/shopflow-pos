import Dexie, { type Table } from "dexie";
import type { Product, Sale, ShopSettings } from "@/core/types/models";

// IndexedDB persistence via Dexie — the offline-first store (Hive analogue).
// All data lives on-device; nothing leaves the browser unless the user
// explicitly exports/emails a backup.

class ShopFlowDB extends Dexie {
  products!: Table<Product, string>;
  sales!: Table<Sale, string>;
  settings!: Table<ShopSettings, string>;

  constructor() {
    super("shopflow-pos");
    this.version(1).stores({
      // indexed fields for fast lookups (barcode scan, category filter, reports)
      products: "id, barcode, category, name, active, updatedAt",
      sales: "id, receiptNo, createdAt, status, paymentMethod",
      settings: "id",
    });
  }
}

export const db = new ShopFlowDB();

export const DEFAULT_SETTINGS: ShopSettings = {
  id: "shop",
  name: "My Shop",
  tagline: "Thank you for your business",
  address: "",
  phone: "",
  email: "",
  currency: "UGX",
  currencySymbol: "USh",
  defaultTaxRate: 0,
  taxInclusive: true,
  receiptFooter: "Goods sold are not returnable. Thank you, come again!",
  receiptWidth: 32,
  cashierName: "Cashier",
  backupReminderDays: 3,
  autoBackupEnabled: false,
  autoBackupFrequency: "daily",
  autoBackupToDevice: true,
  autoBackupEmail: false,
};

/**
 * Ensures the singleton settings row exists and backfills any keys added in
 * later app versions (so upgrades don't leave fields undefined). Returns the
 * complete, current settings.
 */
export async function ensureSettings(): Promise<ShopSettings> {
  const existing = await db.settings.get("shop");
  if (existing) {
    const merged = { ...DEFAULT_SETTINGS, ...existing };
    await db.settings.put(merged);
    return merged;
  }
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}
