import type {
  BackupBundle, Product, ProductEfris, Sale, SaleEfris, SaleItem, SalePayment, ShopSettings,
} from "@/core/types/models";
import { detectCountry } from "@/core/utils/country";
import { isValidPhoto } from "@/core/utils/imageFile";

// Strict validation of backup files before a restore replaces local data.
// Every field is checked so a damaged or hand-edited file cannot corrupt the shop.

// v2 adds credit balances/repayments on sales; v3 adds product pictures, the
// shop country and URA EFRIS fiscal data. Older files still restore.
export const BACKUP_VERSION = 3;
const SUPPORTED_VERSIONS = [1, 2, 3];
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

function optionalIntegerAt(value: unknown, path: string, min: number, max: number): number | undefined {
  return value === undefined ? undefined : integerAt(value, path, min, max);
}

function patternAt(value: unknown, path: string, pattern: RegExp): string | undefined {
  if (value === undefined) return undefined;
  const text = stringAt(value, path, { max: 200 });
  if (!pattern.test(text)) invalid(path, "has an unexpected format");
  return text;
}

/** Drops undefined keys so restored records match freshly saved ones. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function validateProductEfris(value: unknown, path: string): ProductEfris | undefined {
  if (value === undefined) return undefined;
  const raw = objectAt(value, path);
  return compact({
    goodsCode: patternAt(raw.goodsCode, `${path}.goodsCode`, /^[\w .\-/]{1,50}$/),
    commodityCode: patternAt(raw.commodityCode, `${path}.commodityCode`, /^\d{4,18}$/),
    unitCode: patternAt(raw.unitCode, `${path}.unitCode`, /^[\w-]{1,10}$/),
    taxCategory: raw.taxCategory === undefined
      ? undefined
      : enumAt(raw.taxCategory, `${path}.taxCategory`, ["01", "02", "03"] as const),
    registeredAt: optionalIntegerAt(raw.registeredAt, `${path}.registeredAt`, 0, MAX_DATE),
  });
}

function validateSaleEfris(value: unknown, path: string): SaleEfris | undefined {
  if (value === undefined) return undefined;
  const raw = objectAt(value, path);
  const text = (field: string, max = 2_000) => {
    const found = optionalStringAt(raw[field], `${path}.${field}`);
    if (found !== undefined && found.length > max) invalid(`${path}.${field}`, `must be at most ${max} characters`);
    return found;
  };
  const status = enumAt(raw.status, `${path}.status`, ["pending", "fiscalised", "failed", "cancelled"] as const);
  const invoiceNo = text("invoiceNo", 100);
  if (status === "fiscalised" && !invoiceNo) invalid(`${path}.invoiceNo`, "a fiscalised sale needs its fiscal document number");
  let creditNote: SaleEfris["creditNote"];
  if (raw.creditNote !== undefined) {
    const note = objectAt(raw.creditNote, `${path}.creditNote`);
    creditNote = {
      referenceNo: stringAt(note.referenceNo, `${path}.creditNote.referenceNo`, { allowEmpty: false, max: 100 }),
      submittedAt: integerAt(note.submittedAt, `${path}.creditNote.submittedAt`, 0, MAX_DATE),
      reasonCode: stringAt(note.reasonCode, `${path}.creditNote.reasonCode`, { max: 10 }),
    };
  }
  return compact({
    status,
    invoiceNo,
    invoiceId: text("invoiceId", 100),
    antifakeCode: text("antifakeCode", 100),
    qrCode: text("qrCode"),
    sellerTin: patternAt(raw.sellerTin, `${path}.sellerTin`, /^\d{10}$/),
    fiscalisedAt: optionalIntegerAt(raw.fiscalisedAt, `${path}.fiscalisedAt`, 0, MAX_DATE),
    attempts: integerAt(raw.attempts, `${path}.attempts`, 0, 1_000_000),
    lastAttemptAt: optionalIntegerAt(raw.lastAttemptAt, `${path}.lastAttemptAt`, 0, MAX_DATE),
    lastError: text("lastError"),
    creditNote,
  });
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
    ...compact({
      imageKey: patternAt(item.imageKey, `${path}.imageKey`, /^[a-z0-9-]{1,64}$/),
      photo: photoAt(item.photo, `${path}.photo`),
      efris: validateProductEfris(item.efris, `${path}.efris`),
    }),
    createdAt: integerAt(item.createdAt, `${path}.createdAt`, 0, MAX_DATE),
    updatedAt: integerAt(item.updatedAt, `${path}.updatedAt`, 0, MAX_DATE),
  };
}

function photoAt(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isValidPhoto(value)) invalid(path, "is not a supported product photo");
  return value;
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

function validateSalePayment(value: unknown, path: string): SalePayment {
  const payment = objectAt(value, path);
  const amount = numberAt(payment.amount, `${path}.amount`, 0);
  if (amount <= 0) invalid(`${path}.amount`, "must be greater than 0");
  return {
    id: stringAt(payment.id, `${path}.id`, { allowEmpty: false, max: 200 }),
    amount,
    method: enumAt(payment.method, `${path}.method`, ["cash", "mobile_money", "card"]),
    createdAt: integerAt(payment.createdAt, `${path}.createdAt`, 0, MAX_DATE),
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
  // Absent on v1 backups: older credit sales were recorded as fully paid.
  const balanceDue = raw.balanceDue === undefined ? undefined : numberAt(raw.balanceDue, `${path}.balanceDue`, 0);
  const payments = raw.payments === undefined
    ? undefined
    : arrayAt(raw.payments, `${path}.payments`, MAX_ITEMS_PER_SALE)
      .map((payment, paymentIndex) => validateSalePayment(payment, `${path}.payments[${paymentIndex}]`));
  if (paymentMethod === "cash") {
    if (amountPaid < total || !closeEnough(change, amountPaid - total)) {
      invalid(`${path}.amountPaid`, "cash payment and change do not match the sale total");
    }
  } else if (paymentMethod === "credit") {
    if (!closeEnough(change, 0)) invalid(`${path}.change`, "credit sales give no change");
    if (!closeEnough(amountPaid + (balanceDue ?? 0), total)) {
      invalid(`${path}.balanceDue`, "amount paid + balance due must equal the sale total");
    }
    const repaid = (payments ?? []).reduce((sum, payment) => sum + payment.amount, 0);
    if (repaid > amountPaid + 0.011) invalid(`${path}.payments`, "repayments exceed the amount paid");
  } else if (!closeEnough(amountPaid, total) || !closeEnough(change, 0)) {
    invalid(`${path}.amountPaid`, "non-cash payment must equal the sale total with no change");
  }
  if (paymentMethod !== "credit" && ((balanceDue ?? 0) > 0 || payments?.length)) {
    invalid(`${path}.balanceDue`, "only credit sales can carry a balance or repayments");
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
    ...(paymentMethod === "credit" && balanceDue !== undefined ? { balanceDue, payments: payments ?? [] } : {}),
    customerName: optionalStringAt(raw.customerName, `${path}.customerName`),
    customerPhone: optionalStringAt(raw.customerPhone, `${path}.customerPhone`),
    ...compact({
      customerTin: patternAt(raw.customerTin, `${path}.customerTin`, /^\d{10}$/),
      efris: validateSaleEfris(raw.efris, `${path}.efris`),
    }),
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
    country: shop.country === undefined ? detectCountry() : patternAt(shop.country, "shop.country", /^[A-Z]{2,5}$/)!,
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

export function validateBackup(value: unknown): BackupBundle {
  const raw = objectAt(value, "backup");
  if (raw.app !== "shopflow-pos") invalid("app", "expected shopflow-pos");
  if (!SUPPORTED_VERSIONS.includes(raw.version as number)) {
    invalid("version", `expected one of ${SUPPORTED_VERSIONS.join(", ")} — this backup may be from a newer app`);
  }
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
