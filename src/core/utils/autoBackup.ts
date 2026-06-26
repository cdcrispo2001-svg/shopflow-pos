import { db } from "@/core/db/database";
import type { ShopSettings } from "@/core/types/models";
import { buildBackup, salesToCsv } from "@/core/utils/backup";
import {
  saveBackupToDevice, shareBackupFiles, type BackupFile,
} from "@/core/utils/platform";
import { formatMoney } from "@/core/utils/format";

// Scheduled, user-configurable backups. Because a PWA / WebView can't run code
// while closed, "scheduling" means: every time the app opens or resumes, check
// whether a backup is due and, if so, run it. This is reliable for a POS that
// is opened throughout the trading day.

const DAY = 24 * 60 * 60 * 1000;
let ranThisSession = false;

function intervalMs(freq: ShopSettings["autoBackupFrequency"]): number {
  switch (freq) {
    case "open": return 0;
    case "weekly": return 7 * DAY;
    case "daily":
    default: return DAY;
  }
}

export function isAutoBackupDue(s: ShopSettings): boolean {
  if (!s.autoBackupEnabled) return false;
  if (s.autoBackupFrequency === "open") return !ranThisSession;
  const last = s.lastBackupAt ?? 0;
  return Date.now() - last >= intervalMs(s.autoBackupFrequency);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export interface AutoBackupResult {
  savedTo?: string;
  shared?: boolean;
  products: number;
  sales: number;
}

/** Runs a backup now per the configured destinations and records the time. */
export async function runAutoBackup(s: ShopSettings): Promise<AutoBackupResult> {
  const bundle = await buildBackup();
  const ts = stamp();
  const json: BackupFile = {
    name: `shopflow-backup-${ts}.json`,
    content: JSON.stringify(bundle),
    mime: "application/json",
  };
  const csv: BackupFile = {
    name: `shopflow-sales-${ts}.csv`,
    content: salesToCsv(bundle.sales, s.currencySymbol),
    mime: "text/csv",
  };

  const result: AutoBackupResult = {
    products: bundle.products.length,
    sales: bundle.sales.length,
  };

  if (s.autoBackupToDevice) {
    result.savedTo = await saveBackupToDevice(json);
  }

  if (s.autoBackupEmail) {
    const revenue = bundle.sales
      .filter((x) => x.status === "completed")
      .reduce((n, x) => n + x.total, 0);
    const summary =
      `Automatic ShopFlow backup for ${s.name}\n` +
      `${new Date().toLocaleString()}\n` +
      `Products: ${bundle.products.length} · Sales: ${bundle.sales.length}\n` +
      `Revenue to date: ${formatMoney(revenue, s.currencySymbol)}`;
    result.shared = await shareBackupFiles([json, csv], `ShopFlow backup — ${s.name}`, summary)
      .catch(() => false);
  }

  await db.settings.update("shop", { lastBackupAt: Date.now() });
  ranThisSession = true;
  return result;
}

/** Checks due-ness and runs the backup if needed. Never throws. */
export async function maybeRunAutoBackup(
  s: ShopSettings,
  onDone?: (r: AutoBackupResult) => void,
): Promise<void> {
  if (!isAutoBackupDue(s)) return;
  try {
    const r = await runAutoBackup(s);
    onDone?.(r);
  } catch {
    /* auto-backup failures are silent; the manual button surfaces errors */
  }
}
