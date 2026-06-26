import { useEffect, useRef } from "react";
import { App as CapApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { useSettings } from "@/hooks/useSettings";
import { useToast } from "@/core/components/Toast";
import { isNative } from "@/core/utils/platform";
import { maybeRunAutoBackup, type AutoBackupResult } from "@/core/utils/autoBackup";
import type { ShopSettings } from "@/core/types/models";

// Drives scheduled backups: checks "is a backup due?" whenever the app opens
// and (on the APK) whenever it returns to the foreground.

export function useAutoBackup() {
  const settings = useSettings();
  const { toast } = useToast();
  const latest = useRef<ShopSettings>(settings);
  latest.current = settings;

  const notify = (r: AutoBackupResult) => {
    if (r.shared) toast("Auto-backup ready to send.", "success");
    else if (r.savedTo) toast(`Auto-backup saved (${r.products} products, ${r.sales} sales).`, "success");
  };

  // Run on launch once the real (non-default) settings have loaded.
  useEffect(() => {
    void maybeRunAutoBackup(settings, notify);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoBackupEnabled, settings.autoBackupFrequency]);

  // Re-check when the native app resumes from the background.
  useEffect(() => {
    if (!isNative()) return;
    let handle: PluginListenerHandle | undefined;
    CapApp.addListener("resume", () => {
      void maybeRunAutoBackup(latest.current, notify);
    }).then((h) => {
      handle = h;
    });
    return () => {
      handle?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
