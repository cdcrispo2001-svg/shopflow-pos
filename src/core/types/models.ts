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
  imageKey?: string; // picture from the built-in catalogue, or "none"
  photo?: string; // own photo as a small JPEG data URL (wins over imageKey)
  efris?: ProductEfris; // URA EFRIS registration details (Uganda only)
  createdAt: number;
  updatedAt: number;
}

/** EFRIS tax category codes: 01 standard (18%), 02 zero-rated, 03 exempt. */
export type EfrisTaxCategory = "01" | "02" | "03";

export interface ProductEfris {
  goodsCode?: string; // code the item is registered under at URA (defaults to barcode)
  commodityCode?: string; // URA commodity category code, e.g. 50161509
  unitCode?: string; // URA unit of measure code, e.g. 101
  taxCategory?: EfrisTaxCategory;
  registeredAt?: number; // when URA accepted the goods registration (T130)
}

export type SaleEfrisStatus = "pending" | "fiscalised" | "failed" | "cancelled";

/** Fiscalisation state of a sale with URA EFRIS. */
export interface SaleEfris {
  status: SaleEfrisStatus;
  invoiceNo?: string; // Fiscal Document Number (FDN)
  invoiceId?: string;
  antifakeCode?: string; // verification code printed on the receipt
  qrCode?: string;
  sellerTin?: string; // TIN the document was issued under (printed on receipts)
  fiscalisedAt?: number;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
  creditNote?: { referenceNo: string; submittedAt: number; reasonCode: string };
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

/** A repayment collected later against a credit sale. */
export interface SalePayment {
  id: string;
  amount: number;
  method: Exclude<PaymentMethod, "credit">;
  createdAt: number;
}

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
  amountPaid: number; // cash tendered, or (credit) deposit + repayments so far
  change: number;
  // Credit sales only: what the customer still owes, and repayments collected.
  // Absent on older records, which are treated as fully paid.
  balanceDue?: number;
  payments?: SalePayment[];
  customerName?: string;
  customerPhone?: string;
  customerTin?: string; // business buyer's TIN (EFRIS B2B invoices)
  efris?: SaleEfris;
  note?: string;
  status: SaleStatus;
  cashier?: string;
  createdAt: number;
}

export interface ShopSettings {
  id: "shop"; // singleton row
  name: string;
  country: string; // ISO code, e.g. "UG" — Uganda unlocks URA EFRIS
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
  backupReminderDays: number; // remind to back up after N days (0 = off)
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
