// Domain models — the immutable shapes persisted in IndexedDB.
// Kept free of framework concerns (mirrors the "domain" layer of the spec).

export type PaymentMethod = "cash" | "mobile_money" | "card" | "credit";

export interface Product {
  id: string;
  name: string;
  barcode?: string; // SKU / EAN / QR payload
  category?: string;
  price: number; // selling price, in major currency units
  cost: number; // buying/cost price — drives profit reporting
  stock: number; // current quantity on hand
  lowStockAt: number; // threshold for low-stock alerts
  taxRate: number; // percentage, e.g. 18 for 18% VAT
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SaleItem {
  productId: string;
  name: string;
  barcode?: string;
  price: number; // unit price at time of sale
  cost: number; // unit cost at time of sale (snapshot for profit)
  qty: number;
  taxRate: number;
  lineTotal: number; // price * qty (tax-inclusive handling done at sale level)
}

export type SaleStatus = "completed" | "voided" | "refunded";

export interface Sale {
  id: string;
  receiptNo: string; // human-friendly, e.g. R-000123
  items: SaleItem[];
  subtotal: number; // sum of line totals before tax & discount
  discount: number; // absolute amount
  taxTotal: number;
  total: number; // subtotal - discount + taxTotal
  costTotal: number; // sum of cost*qty — for profit
  profit: number; // total (net of tax) - costTotal - discount
  paymentMethod: PaymentMethod;
  amountPaid: number;
  change: number;
  customerName?: string;
  customerPhone?: string;
  note?: string;
  status: SaleStatus;
  cashier?: string;
  createdAt: number;
}

export interface ShopSettings {
  id: "shop"; // singleton row
  name: string;
  tagline?: string;
  address: string;
  phone: string;
  email: string; // destination for email backups
  currency: string; // ISO-ish code shown on receipts, e.g. "UGX"
  currencySymbol: string; // e.g. "USh"
  defaultTaxRate: number; // applied to new products by default
  taxInclusive: boolean; // are entered prices tax-inclusive?
  receiptFooter: string;
  receiptWidth: 32 | 48; // thermal printer chars per line (58mm vs 80mm)
  cashierName: string;
  lastBackupAt?: number;
  backupReminderDays: number; // remind to back up after N days
  // Auto-backup (user-configurable; runs on app launch/resume when due)
  autoBackupEnabled: boolean;
  autoBackupFrequency: AutoBackupFrequency;
  autoBackupToDevice: boolean; // silently save a backup file to the device
  autoBackupEmail: boolean; // also open the email/share sheet when due
}

export type AutoBackupFrequency = "open" | "daily" | "weekly";

export interface BackupBundle {
  app: "shopflow-pos";
  version: number;
  exportedAt: number;
  shop: ShopSettings | null;
  products: Product[];
  sales: Sale[];
}
