import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/core/db/database";
import { isUganda } from "@/core/utils/country";
import { useSettings } from "@/hooks/useSettings";

// URA EFRIS settings and secrets live in their own table: they belong to this
// device's EFRIS registration, so they are never exported in backups.

export type EfrisEnvironment = "sandbox" | "production";

export interface EfrisConfig {
  enabled: boolean;
  environment: EfrisEnvironment;
  tin: string;
  deviceNo: string;
  brn: string; // business registration / NIN (optional)
  legalName: string;
  businessName: string;
  vatRegistered: boolean; // VAT-registered shops issue invoices, others receipts
  relayUrl: string; // web only: browsers cannot call URA directly (CORS)
  taxpayerId: string; // from sign-in (T103)
  offlineDays: number; // URA's offline allowance for this device (T103)
  deviceStatus?: string;
  lastSignInAt?: number;
}

export interface EfrisKeyMaterial {
  privateKeyPem: string;
  fingerprint: string;
  subject: string;
  importedAt: number;
}

export interface EfrisSession {
  aesKeyHex: string;
  fetchedAt: number;
  scope: string; // environment|tin|device the key was issued for
}

export interface EfrisUnit { code: string; name: string }

export interface EfrisDictionary {
  units: EfrisUnit[];
  fetchedAt: number;
}

export const DEFAULT_EFRIS_CONFIG: EfrisConfig = {
  enabled: false,
  environment: "sandbox",
  tin: "",
  deviceNo: "",
  brn: "",
  legalName: "",
  businessName: "",
  vatRegistered: false,
  relayUrl: "",
  taxpayerId: "1",
  offlineDays: 5,
};

async function read<T>(key: string): Promise<T | undefined> {
  return (await db.efris.get(key))?.value as T | undefined;
}

async function write(key: string, value: unknown): Promise<void> {
  await db.efris.put({ key, value });
}

function validateConfig(config: EfrisConfig): void {
  if (config.tin && !/^\d{10}$/.test(config.tin)) throw new Error("TIN must be the 10 digits URA issued.");
  if (config.deviceNo && !/^[\w-]{1,30}$/.test(config.deviceNo)) throw new Error("Device number is invalid.");
  if (config.brn.length > 50) throw new Error("BRN/NIN is too long.");
  if (!["sandbox", "production"].includes(config.environment)) throw new Error("Choose sandbox or production.");
  if (!Number.isSafeInteger(config.offlineDays) || config.offlineDays < 1 || config.offlineDays > 60) {
    throw new Error("Offline days must be between 1 and 60.");
  }
  if (config.relayUrl) {
    let url: URL;
    try {
      url = new URL(config.relayUrl);
    } catch {
      throw new Error("Relay address is not a valid web address.");
    }
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
      throw new Error("Relay address must start with https://");
    }
  }
}

export function sessionScope(config: Pick<EfrisConfig, "environment" | "tin" | "deviceNo">): string {
  return `${config.environment}|${config.tin}|${config.deviceNo}`;
}

export async function getEfrisConfig(): Promise<EfrisConfig> {
  return { ...DEFAULT_EFRIS_CONFIG, ...(await read<Partial<EfrisConfig>>("config")) };
}

export async function saveEfrisConfig(patch: Partial<EfrisConfig>): Promise<EfrisConfig> {
  const current = await getEfrisConfig();
  const next: EfrisConfig = { ...current, ...patch };
  validateConfig(next);
  await write("config", next);
  if (sessionScope(next) !== sessionScope(current)) await clearEfrisSession();
  return next;
}

export const getEfrisKey = () => read<EfrisKeyMaterial>("key");

export async function saveEfrisKey(key: EfrisKeyMaterial): Promise<void> {
  await write("key", key);
  await clearEfrisSession();
}

export async function clearEfrisKey(): Promise<void> {
  await db.efris.bulkDelete(["key", "session"]);
}

export const getEfrisSession = () => read<EfrisSession>("session");
export const saveEfrisSession = (session: EfrisSession) => write("session", session);
export const clearEfrisSession = () => db.efris.delete("session");

export const getEfrisDictionary = () => read<EfrisDictionary>("dictionary");
export const saveEfrisDictionary = (dictionary: EfrisDictionary) => write("dictionary", dictionary);

/** True when this shop is in Uganda and has switched EFRIS on. */
export async function isEfrisActive(): Promise<boolean> {
  const [settings, config] = await Promise.all([db.settings.get("shop"), getEfrisConfig()]);
  return isUganda(settings?.country) && config.enabled;
}

export function useEfrisConfig(): EfrisConfig {
  const row = useLiveQuery(() => db.efris.get("config"), []);
  return useMemo(
    () => ({ ...DEFAULT_EFRIS_CONFIG, ...((row?.value as Partial<EfrisConfig> | undefined) ?? {}) }),
    [row],
  );
}

export function useEfrisActive(): boolean {
  const settings = useSettings();
  const config = useEfrisConfig();
  return isUganda(settings.country) && config.enabled;
}

export function useEfrisKey(): EfrisKeyMaterial | undefined {
  return useLiveQuery(() => getEfrisKey(), []);
}

export function useEfrisUnits(): EfrisUnit[] {
  const dictionary = useLiveQuery(() => getEfrisDictionary(), []);
  return dictionary?.units ?? [];
}
