import { db } from "@/core/db/database";
import type {
  BackupBundle, Product, Sale, SaleItem, ShopSettings,
} from "@/core/types/models";
import { type Result, ok, fail, attempt } from "@/core/types/result";
import { formatMoney } from "@/core/utils/format";
import { shareBackupFiles } from "@/core/utils/platform";

const BACKUP_VERSION = 1;
const MAX_RECORDS = 100_000;
const MAX_ITEMS_PER_SALE = 1_000;
const MAX_TEXT = 10_000;
const MAX_MONEY = 1_000_000_000_000_000;
const MAX_DATE = 8_640_000_000_000_000;

type JsonObject = Record<string, unknown>;

function invalid(path: string, reason: string): never {
  throw new Error(`Invalid backup field "${path}": ${reason}.`);
}

function objectAt(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "expected an object");
  }
  return value as JsonObject;
}

function stringAt(
  value: unknown,
  path: string,
  { allowEmpty = true, max = MAX_TEXT }: { allowEmpty?: boolean; max?: number } = {},
): string {
  if (typeof value !== "string") invalid(path, "expected a string");
  if (!allowEmpty && value.trim().length === 0) invalid(path, "must not be empty");
  if (value.length > max) invalid(path, `must be at most ${max} characters`);
  return value;
}

function optionalStringAt(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stringAt(value, path);
}

function numberAt(
  value: unknown,
  path: string,
  min = -MAX_MONEY,
  max = MAX_MONEY,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(path, "expected a finite number");
  }
  if (value < min || value > max) invalid(path, `must be between ${min} and ${max}`);
  return value;
}

function integerAt(value: unknown, path: string, min: number, max: number): number {
  const number = numberAt(value, path, min, max);
  if (!Number.isInteger(number)) invalid(path, "expected an integer");
  return number;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "expected a boolean");
  return value;
}

function enumAt<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    invalid(path, `expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function receiptWidthAt(value: unknown): 32 | 48 {
  if (value !== 32 && value !== 48) invalid("shop.receiptWidth", "expected 32 or 48");
  return value;
}

function arrayAt(value: unknown, path: string, max = MAX_RECORDS): unknown[] {
  if (!Array.isArray(value)) invalid(path, "expected an array");
  if (value.length > max) invalid(path, `must contain at most ${max} entries`);
  return value;
}

function closeEnough(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 0.011;
}

function validateProduct(value: unknown, index: number): Product {
  const path = `products[${index}]`;
  const item = objectAt(value, path);
  return {
    id: stringAt(item.id, `${path}.id`, { allowEmpty: false, max: 200 }),
    name: stringAt(item.name, `${path}.name`, { allowEmpty: false, max: 1_000 }),
    barcode: optionalStringAt(item.barcode, `${path}.barcode`),
    category: optionalStringAt(item.category, `${path}.category`),
    price: numberAt(item.price, `${path}.price`, 0),
    cost: numberAt(item.cost, `${path}.cost`, 0),
    // Version-1 backups may contain fractional inventory from older builds.
    // Preserve those nonnegative values even though new writes require integers.
    stock: numberAt(item.stock, `${path}.stock`, 0, Number.MAX_SAFE_INTEGER),
    lowStockAt: numberAt(item.lowStockAt, `${path}.lowStockAt`, 0, Number.MAX_SAFE_INTEGER),
    taxRate: numberAt(item.taxRate, `${path}.taxRate`, 0, 100),
    active: booleanAt(item.active, `${path}.active`),
    createdAt: integerAt(item.createdAt, `${path}.createdAt`, 0, MAX_DATE),
    updatedAt: integerAt(item.updatedAt, `${path}.updatedAt`, 0, MAX_DATE),
  };
}

function validateSaleItem(value: unknown, saleIndex: number, itemIndex: number): SaleItem {
  const path = `sales[${saleIndex}].items[${itemIndex}]`;
  const item = objectAt(value, path);
  const price = numberAt(item.price, `${path}.price`, 0);
  const qty = integerAt(item.qty, `${path}.qty`, 1, 1_000_000);
  const lineTotal = numberAt(item.lineTotal, `${path}.lineTotal`, 0);
  if (!closeEnough(lineTotal, Math.round(price * qty * 100) / 100)) {
    invalid(`${path}.lineTotal`, "does not equal price × quantity");
  }
  return {
    productId: stringAt(item.productId, `${path}.productId`, { allowEmpty: false, max: 200 }),
    name: stringAt(item.name, `${path}.name`, { allowEmpty: false, max: 1_000 }),
    barcode: optionalStringAt(item.barcode, `${path}.barcode`),
    price,
    cost: numberAt(item.cost, `${path}.cost`, 0),
    qty,
    taxRate: numberAt(item.taxRate, `${path}.taxRate`, 0, 100),
    lineTotal,
  };
}

function validateSale(value: unknown, index: number): Sale {
  const path = `sales[${index}]`;
  const raw = objectAt(value, path);
  const items = arrayAt(raw.items, `${path}.items`, MAX_ITEMS_PER_SALE)
    .map((item, itemIndex) => validateSaleItem(item, index, itemIndex));
  if (items.length === 0) invalid(`${path}.items`, "must not be empty");
  const productIds = new Set<string>();
  for (const item of items) {
    if (productIds.has(item.productId)) invalid(`${path}.items`, `duplicate product ID ${item.productId}`);
    productIds.add(item.productId);
  }

  const subtotal = numberAt(raw.subtotal, `${path}.subtotal`, 0);
  const discount = numberAt(raw.discount, `${path}.discount`, 0);
  const taxTotal = numberAt(raw.taxTotal, `${path}.taxTotal`, 0);
  const total = numberAt(raw.total, `${path}.total`, 0);
  const costTotal = numberAt(raw.costTotal, `${path}.costTotal`, 0);
  const profit = numberAt(raw.profit, `${path}.profit`);
  const expectedGross = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const expectedCost = items.reduce((sum, item) => sum + item.cost * item.qty, 0);
  if (!closeEnough(subtotal + taxTotal, expectedGross)) {
    invalid(`${path}.subtotal`, "subtotal and tax do not match sale items");
  }
  if (!closeEnough(total, subtotal + taxTotal - discount)) {
    invalid(`${path}.total`, "does not match subtotal + tax - discount");
  }
  if (!closeEnough(costTotal, Math.round(expectedCost * 100) / 100)) {
    invalid(`${path}.costTotal`, "does not match sale items");
  }
  if (!closeEnough(profit, subtotal - costTotal - discount)) {
    invalid(`${path}.profit`, "does not match subtotal - cost - discount");
  }

  const paymentMethod = enumAt(raw.paymentMethod, `${path}.paymentMethod`, ["cash", "mobile_money", "card", "credit"]);
  const amountPaid = numberAt(raw.amountPaid, `${path}.amountPaid`, 0);
  const change = numberAt(raw.change, `${path}.change`, 0);
  if (paymentMethod === "cash") {
    if (amountPaid < total || !closeEnough(change, amountPaid - total)) {
      invalid(`${path}.amountPaid`, "cash payment and change do not match the sale total");
    }
  } else if (!closeEnough(amountPaid, total) || !closeEnough(change, 0)) {
    invalid(`${path}.amountPaid`, "non-cash payment must equal the sale total with no change");
  }

  return {
    id: stringAt(raw.id, `${path}.id`, { allowEmpty: false, max: 200 }),
    receiptNo: stringAt(raw.receiptNo, `${path}.receiptNo`, { allowEmpty: false, max: 200 }),
    items,
    subtotal,
    discount,
    taxTotal,
    total,
    costTotal,
    profit,
    paymentMethod,
    amountPaid,
    change,
    customerName: optionalStringAt(raw.customerName, `${path}.customerName`),
    customerPhone: optionalStringAt(raw.customerPhone, `${path}.customerPhone`),
    note: optionalStringAt(raw.note, `${path}.note`),
    status: enumAt(raw.status, `${path}.status`, ["completed", "voided", "refunded"]),
    cashier: optionalStringAt(raw.cashier, `${path}.cashier`),
    createdAt: integerAt(raw.createdAt, `${path}.createdAt`, 0, MAX_DATE),
  };
}

function validateShop(value: unknown): ShopSettings | null {
  if (value === null) return null;
  const shop = objectAt(value, "shop");
  if (shop.id !== "shop") invalid("shop.id", "expected shop");
  return {
    id: "shop",
    name: stringAt(shop.name, "shop.name", { max: 1_000 }),
    tagline: optionalStringAt(shop.tagline, "shop.tagline"),
    address: stringAt(shop.address, "shop.address"),
    phone: stringAt(shop.phone, "shop.phone"),
    email: stringAt(shop.email, "shop.email"),
    currency: stringAt(shop.currency, "shop.currency", { max: 20 }),
    currencySymbol: stringAt(shop.currencySymbol, "shop.currencySymbol", { max: 20 }),
    defaultTaxRate: numberAt(shop.defaultTaxRate, "shop.defaultTaxRate", 0, 100),
    taxInclusive: booleanAt(shop.taxInclusive, "shop.taxInclusive"),
    receiptFooter: stringAt(shop.receiptFooter, "shop.receiptFooter"),
    receiptWidth: receiptWidthAt(shop.receiptWidth),
    cashierName: stringAt(shop.cashierName, "shop.cashierName", { max: 1_000 }),
    lastBackupAt: shop.lastBackupAt === undefined
      ? undefined
      : integerAt(shop.lastBackupAt, "shop.lastBackupAt", 0, MAX_DATE),
    backupReminderDays: integerAt(shop.backupReminderDays, "shop.backupReminderDays", 0, 3_650),
    autoBackupEnabled: booleanAt(shop.autoBackupEnabled, "shop.autoBackupEnabled"),
    autoBackupFrequency: enumAt(shop.autoBackupFrequency, "shop.autoBackupFrequency", ["open", "daily", "weekly"]),
    autoBackupToDevice: booleanAt(shop.autoBackupToDevice, "shop.autoBackupToDevice"),
    autoBackupEmail: booleanAt(shop.autoBackupEmail, "shop.autoBackupEmail"),
  };
}

function validateBackup(value: unknown): BackupBundle {
  const raw = objectAt(value, "backup");
  if (raw.app !== "shopflow-pos") invalid("app", "expected shopflow-pos");
  if (raw.version !== BACKUP_VERSION) invalid("version", `expected ${BACKUP_VERSION}`);
  const products = arrayAt(raw.products, "products").map(validateProduct);
  const sales = arrayAt(raw.sales, "sales").map(validateSale);
  const productIds = new Set<string>();
  for (const product of products) {
    if (productIds.has(product.id)) invalid("products", `duplicate product ID ${product.id}`);
    productIds.add(product.id);
  }
  const saleIds = new Set<string>();
  const receipts = new Set<string>();
  for (const sale of sales) {
    if (saleIds.has(sale.id)) invalid("sales", `duplicate sale ID ${sale.id}`);
    if (receipts.has(sale.receiptNo)) invalid("sales", `duplicate receipt number ${sale.receiptNo}`);
    saleIds.add(sale.id);
    receipts.add(sale.receiptNo);
  }
  return {
    app: "shopflow-pos",
    version: BACKUP_VERSION,
    exportedAt: integerAt(raw.exportedAt, "exportedAt", 0, MAX_DATE),
    shop: validateShop(raw.shop),
    products,
    sales,
  };
}

/** Snapshots the entire on-device database into a portable bundle. */
export async function buildBackup(): Promise<BackupBundle> {
  const [shop, products, sales] = await Promise.all([
    db.settings.get("shop"),
    db.products.toArray(),
    db.sales.toArray(),
  ]);
  return {
    app: "shopflow-pos",
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    shop: shop ?? null,
    products,
    sales,
  };
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

/** Sales rows flattened to CSV for spreadsheets / accountants. */
export function salesToCsv(sales: Sale[], symbol: string): string {
  const headers = [
    "receipt", "date", "items", "subtotal", "tax", "discount", "total",
    "cost", "profit", "payment", "status", "customer",
  ];
  const rows = sales.map((s) =>
    [
      s.receiptNo,
      new Date(s.createdAt).toISOString(),
      s.items.reduce((n, i) => n + i.qty, 0),
      s.subtotal,
      s.taxTotal,
      s.discount,
      s.total,
      s.costTotal,
      s.profit,
      s.paymentMethod,
      s.status,
      s.customerName ?? "",
    ].map(csvCell).join(","),
  );
  void symbol;
  return [headers.map(csvCell).join(","), ...rows].join("\n");
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^\s*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function downloadJsonBackup(): Promise<Result<true>> {
  return attempt(async () => {
    const bundle = await buildBackup();
    downloadFile(
      `shopflow-backup-${stamp()}.json`,
      JSON.stringify(bundle, null, 2),
      "application/json",
    );
    await db.settings.update("shop", { lastBackupAt: Date.now() });
    return true as const;
  }, "Exporting backup");
}

export async function downloadCsvReport(symbol: string): Promise<Result<true>> {
  return attempt(async () => {
    const sales = await db.sales.toArray();
    downloadFile(`shopflow-sales-${stamp()}.csv`, salesToCsv(sales, symbol), "text/csv");
    return true as const;
  }, "Exporting CSV");
}

/**
 * Shares the backup via the OS share sheet (lets the user pick Gmail/email and
 * attaches the file). Falls back to a mailto draft + download when the Web
 * Share API can't attach files.
 */
export async function emailBackup(
  toEmail: string,
  shopName: string,
  symbol: string,
): Promise<Result<"shared" | "mailto">> {
  const bundle = await buildBackup();
  const json = JSON.stringify(bundle, null, 2);
  const csv = salesToCsv(bundle.sales, symbol);
  const totalSales = bundle.sales
    .filter((s) => s.status === "completed")
    .reduce((n, s) => n + s.total, 0);
  const summary =
    `ShopFlow backup for ${shopName}\n` +
    `Date: ${new Date().toLocaleString()}\n` +
    `Products: ${bundle.products.length}\n` +
    `Sales: ${bundle.sales.length}\n` +
    `Total revenue: ${formatMoney(totalSales, symbol)}\n\n` +
    `Attached: full JSON backup (restore in app) + sales CSV.`;

  const jsonName = `shopflow-backup-${stamp()}.json`;
  const csvName = `shopflow-sales-${stamp()}.csv`;

  // Prefer the OS/Web share sheet (native on the APK, Web Share on supported
  // browsers) so the files attach directly to an email.
  const shared = await shareBackupFiles(
    [
      { name: jsonName, content: json, mime: "application/json" },
      { name: csvName, content: csv, mime: "text/csv" },
    ],
    `ShopFlow backup — ${shopName}`,
    summary,
  ).catch(() => false);

  if (shared) {
    await db.settings.update("shop", { lastBackupAt: Date.now() });
    return ok("shared");
  }

  // Fallback: open a pre-filled email + download the files to attach manually.
  if (!toEmail) {
    return fail("No shop email set. Add your email in Settings to email backups.");
  }
  const subject = encodeURIComponent(`ShopFlow backup — ${shopName} (${stamp()})`);
  const body = encodeURIComponent(
    summary + "\n\n(Attach the downloaded backup files to this email.)",
  );
  downloadFile(jsonName, json, "application/json");
  downloadFile(csvName, csv, "text/csv");
  window.location.href = `mailto:${toEmail}?subject=${subject}&body=${body}`;
  await db.settings.update("shop", { lastBackupAt: Date.now() });
  return ok("mailto");
}

/** Restores a backup bundle, replacing current data. */
export async function restoreBackup(jsonText: string): Promise<Result<{ products: number; sales: number }>> {
  return attempt(async () => {
    if (jsonText.length > 50_000_000) throw new Error("Backup file is too large.");
    const bundle = validateBackup(JSON.parse(jsonText) as unknown);
    await db.transaction("rw", db.products, db.sales, db.settings, async () => {
      await db.products.clear();
      await db.sales.clear();
      await db.settings.clear();
      await db.products.bulkPut(bundle.products);
      await db.sales.bulkPut(bundle.sales);
      if (bundle.shop) await db.settings.put(bundle.shop);
    });
    return { products: bundle.products.length, sales: bundle.sales.length };
  }, "Restoring backup");
}
