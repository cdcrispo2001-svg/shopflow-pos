import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// Platform abstraction so the same backup code runs on the web PWA and inside
// the Android APK. On native we use Capacitor's Filesystem/Share; on the web
// we fall back to file downloads and the Web Share API.

export interface BackupFile {
  name: string;
  content: string;
  mime: string;
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function platformName(): string {
  return Capacitor.getPlatform(); // "web" | "android" | "ios"
}

function webDownload(file: BackupFile) {
  const blob = new Blob([file.content], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Persists a backup file where the user can find it later.
 * Native: writes to Documents/ShopFlowBackups (survives app updates).
 * Web: triggers a browser download. Returns a human-readable location.
 */
export async function saveBackupToDevice(file: BackupFile): Promise<string> {
  if (isNative()) {
    // Directory.External is app-specific external storage: writable on every
    // Android version with no runtime storage permission. Discoverable at
    // Android/data/com.shopflow.pos/files/ShopFlowBackups.
    const res = await Filesystem.writeFile({
      path: `ShopFlowBackups/${file.name}`,
      data: file.content,
      directory: Directory.External,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    return res.uri;
  }
  webDownload(file);
  return "Downloads";
}

/** True when the running platform can present a native/Web share sheet. */
export function canShare(): boolean {
  if (isNative()) return true;
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * Opens the OS share sheet with the given files attached (so the user can pick
 * Gmail/email/WhatsApp). Returns false if sharing wasn't possible.
 */
export async function shareBackupFiles(
  files: BackupFile[],
  title: string,
  text: string,
): Promise<boolean> {
  if (isNative()) {
    // Capacitor Share needs file URIs — stage them in the cache directory first.
    const uris: string[] = [];
    for (const f of files) {
      const res = await Filesystem.writeFile({
        path: f.name,
        data: f.content,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      uris.push(res.uri);
    }
    await Share.share({ title, text, files: uris, dialogTitle: title });
    return true;
  }

  // Web: try the File-aware Web Share API.
  const fileObjs = files.map((f) => new File([f.content], f.name, { type: f.mime }));
  if (
    typeof navigator !== "undefined" &&
    "canShare" in navigator &&
    navigator.canShare?.({ files: fileObjs })
  ) {
    await navigator.share({ title, text, files: fileObjs });
    return true;
  }
  return false;
}
