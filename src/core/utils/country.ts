// Country of the shop. Uganda unlocks URA EFRIS e-invoicing; the rest of the
// app works the same everywhere.

export const COUNTRIES = [
  { code: "UG", name: "Uganda" },
  { code: "KE", name: "Kenya" },
  { code: "TZ", name: "Tanzania" },
  { code: "RW", name: "Rwanda" },
  { code: "SS", name: "South Sudan" },
  { code: "CD", name: "DR Congo" },
  { code: "OTHER", name: "Another country" },
] as const;

const ZONES: Record<string, string> = {
  "Africa/Kampala": "UG",
  "Africa/Dar_es_Salaam": "TZ",
  "Africa/Kigali": "RW",
  "Africa/Juba": "SS",
  "Africa/Lubumbashi": "CD",
  "Africa/Kinshasa": "CD",
};

const KNOWN = new Set<string>(COUNTRIES.map((country) => country.code));

/** Best guess from the device time zone, then its language region (e.g. en-UG). */
export function detectCountry(): string {
  let zone = "";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    // Older engines without Intl time zones fall through to the language check.
  }
  if (ZONES[zone]) return ZONES[zone];
  const languages = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
  for (const language of languages) {
    const region = language?.split("-")[1]?.toUpperCase();
    if (region && KNOWN.has(region)) return region;
  }
  // Uganda shares Kenya's clock, and some devices report Nairobi's zone.
  if (zone === "Africa/Nairobi") return "KE";
  return "OTHER";
}

export function isUganda(country: string | undefined): boolean {
  return country === "UG";
}
