import { useLiveQuery } from "dexie-react-hooks";
import { db, DEFAULT_SETTINGS, ensureSettings } from "@/core/db/database";
import type { ShopSettings } from "@/core/types/models";
import { useEffect, useMemo } from "react";

/** Live shop settings, always returns a usable object (defaults until loaded). */
export function useSettings(): ShopSettings {
  useEffect(() => {
    void ensureSettings();
  }, []);
  const settings = useLiveQuery(() => db.settings.get("shop"), [], DEFAULT_SETTINGS);
  // Merge over defaults so fields added in newer versions are never undefined.
  // Memoised so the object only changes when the stored row does — consumers
  // use it as an effect/memo dependency (a fresh object each render looped).
  return useMemo(() => ({ ...DEFAULT_SETTINGS, ...(settings ?? {}) }), [settings]);
}

export async function saveSettings(patch: Partial<ShopSettings>): Promise<void> {
  if (patch.defaultTaxRate !== undefined && (
    !Number.isFinite(patch.defaultTaxRate)
    || patch.defaultTaxRate < 0
    || patch.defaultTaxRate > 100
  )) {
    throw new Error("Default tax rate must be between 0 and 100.");
  }
  if (patch.backupReminderDays !== undefined && (
    !Number.isSafeInteger(patch.backupReminderDays)
    || patch.backupReminderDays < 0
    || patch.backupReminderDays > 3_650
  )) {
    throw new Error("Backup reminder days must be a whole number between 0 and 3650.");
  }
  await ensureSettings();
  await db.settings.update("shop", patch);
}
