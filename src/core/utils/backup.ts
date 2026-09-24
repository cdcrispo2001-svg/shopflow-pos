import { db } from "@/core/db/database";
import type { BackupBundle, Sale } from "@/core/types/models";
import { type Result, ok, fail, attempt } from "@/core/types/result";
import { formatMoney } from "@/core/utils/format";
import { shareBackupFiles } from "@/core/utils/platform";
import { BACKUP_VERSION, validateBackup } from "@/core/utils/backupValidate";

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
    "cost", "profit", "payment", "paid", "balance", "status", "customer", "phone",
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
      s.amountPaid - s.change,
      s.balanceDue ?? 0,
      s.status,
      s.customerName ?? "",
      s.customerPhone ?? "",
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
