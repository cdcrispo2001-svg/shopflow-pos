import { useLiveQuery } from "dexie-react-hooks";
import { db, DEFAULT_SETTINGS, ensureSettings } from "@/core/db/database";
import type { ShopSettings } from "@/core/types/models";
import { useEffect } from "react";

/** Live shop settings, always returns a usable object (defaults until loaded). */
export function useSettings(): ShopSettings {
  useEffect(() => {
    void ensureSettings();
  }, []);
  const settings = useLiveQuery(() => db.settings.get("shop"), [], DEFAULT_SETTINGS);
  // Merge over defaults so fields added in newer versions are never undefined.
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

export async function saveSettings(patch: Partial<ShopSettings>): Promise<void> {
  await ensureSettings();
  await db.settings.update("shop", patch);
}
