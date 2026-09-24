import {
  CATALOG_ROWS, IMAGE_GROUPS, catalogFileName,
  type ImageGroupDef, type ImageGroupId,
} from "@/core/catalog/productImageCatalog";

// Matches product names to catalogue pictures. Products store the chosen
// `imageKey`; names are matched only to suggest one (or for older products
// saved before images existed).

export const IMAGE_NONE = "none"; // imageKey meaning "the user chose no picture"

export interface CatalogImage {
  key: string;
  label: string;
  group: ImageGroupId;
  file: string;
  words: string[];
}

export interface ImageSubject {
  name: string;
  category?: string;
  imageKey?: string;
  photo?: string;
}

export type ResolvedImage =
  | { kind: "photo"; src: string; label: string }
  | { kind: "catalog"; src: string; label: string; image: CatalogImage };

export const CATALOG: CatalogImage[] = Object.entries(CATALOG_ROWS).flatMap(([group, rows]) =>
  rows.map(([key, image, label, words]) => ({
    key,
    label,
    group: group as ImageGroupId,
    file: catalogFileName(image),
    words: words.split(",").map((word) => word.trim()).filter(Boolean),
  })),
);

const BY_KEY = new Map(CATALOG.map((image) => [image.key, image]));

export function catalogImage(key: string | undefined): CatalogImage | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

export function imageSrc(image: CatalogImage): string {
  return `${import.meta.env.BASE_URL}product-images/${image.file}`;
}

// Sizes and counts ("500ml", "2kg", "x12") say nothing about what the item is.
const MEASURE = /\b\d+(?:[.,]\d+)?\s*(?:kgs?|g|gms?|grams?|ml|l|ltrs?|litres?|liters?|pcs?|pieces?|pkts?|packs?|x|cm|mm|m|inch(?:es)?|oz)\b/g;
const KEEP_S = new Set(["shoes", "toes", "hoes", "canoes"]);

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("oes") && !KEEP_S.has(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(word)) return word;
  if (/(sh|ch|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(MEASURE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !/^\d+$/.test(word))
    .map(singular);
}

interface Phrase { image: CatalogImage; tokens: string[]; text: string }

const PHRASES: Phrase[] = CATALOG.flatMap((image) =>
  [...image.words, image.label].map((word) => {
    const tokens = normalizeWords(word);
    return { image, tokens, text: tokens.join(" ") };
  }).filter((phrase) => phrase.tokens.length > 0),
);

/** Index of the last token where `phrase` ends inside `words`, or -1. */
function phraseEnd(words: string[], phrase: string[]): number {
  let found = -1;
  for (let start = 0; start + phrase.length <= words.length; start += 1) {
    if (phrase.every((token, offset) => words[start + offset] === token)) found = start + phrase.length - 1;
  }
  return found;
}

/**
 * Ranks catalogue pictures for some words. Longer phrases win ("maize flour"
 * beats "maize"); on a tie the later word wins, because the item type usually
 * comes last ("Dettol soap", "Samsung charger").
 */
function rank(words: string[]): Map<string, { image: CatalogImage; score: number }> {
  const scores = new Map<string, { image: CatalogImage; score: number }>();
  const offer = (image: CatalogImage, score: number) => {
    const current = scores.get(image.key);
    if (!current || score > current.score) scores.set(image.key, { image, score });
  };
  for (const phrase of PHRASES) {
    const end = phraseEnd(words, phrase.tokens);
    if (end >= 0) offer(phrase.image, phrase.tokens.length * 1000 + end * 10 + phrase.text.length / 100);
  }
  if (scores.size === 0) {
    // Tolerate small spelling slips ("tomatoe", "chapatis") on longer words.
    for (const phrase of PHRASES) {
      if (phrase.tokens.length !== 1 || phrase.text.length < 4) continue;
      words.forEach((word, index) => {
        if (word.length < 4 || Math.abs(word.length - phrase.text.length) > 2) return;
        if (word.startsWith(phrase.text) || phrase.text.startsWith(word)) offer(phrase.image, 500 + index * 10);
      });
    }
  }
  return scores;
}

function best(words: string[]): CatalogImage | undefined {
  let top: { image: CatalogImage; score: number } | undefined;
  for (const entry of rank(words).values()) if (!top || entry.score > top.score) top = entry;
  return top?.image;
}

export function groupForCategory(category: string | undefined): ImageGroupDef | undefined {
  const text = normalizeWords(category ?? "").join(" ");
  if (!text) return undefined;
  return IMAGE_GROUPS.find((group) =>
    group.aliases.split(",").some((alias) => normalizeWords(alias).join(" ") === text),
  );
}

/** Best catalogue picture for a product name, falling back to its category. */
export function matchProductImage(name: string, category?: string): CatalogImage | undefined {
  const byName = best(normalizeWords(name));
  if (byName) return byName;
  if (!category) return undefined;
  const byCategory = best(normalizeWords(category));
  if (byCategory) return byCategory;
  return catalogImage(groupForCategory(category)?.fallback);
}

/** Top suggestions for the picker, best first. */
export function suggestImages(name: string, category?: string, limit = 8): CatalogImage[] {
  const ranked = [...rank(normalizeWords(name)).values()].sort((a, b) => b.score - a.score).map((r) => r.image);
  const fallback = matchProductImage("", category);
  if (fallback && !ranked.includes(fallback)) ranked.push(fallback);
  return ranked.slice(0, limit);
}

/** The picture to show for a product: its photo, its chosen image, or a name match. */
export function resolveProductImage(subject: ImageSubject): ResolvedImage | null {
  if (subject.photo) return { kind: "photo", src: subject.photo, label: subject.name };
  if (subject.imageKey === IMAGE_NONE) return null;
  const image = catalogImage(subject.imageKey) ?? matchProductImage(subject.name, subject.category);
  return image ? { kind: "catalog", src: imageSrc(image), label: image.label, image } : null;
}

/** Catalogue search for the picker: label, group and match words. */
export function searchCatalog(query: string, group?: ImageGroupId): CatalogImage[] {
  const words = normalizeWords(query);
  return CATALOG.filter((image) => {
    if (group && image.group !== group) return false;
    if (words.length === 0) return true;
    const haystack = normalizeWords([image.label, ...image.words].join(" "));
    return words.every((word) => haystack.some((token) => token.startsWith(word)));
  });
}
