// Copies the Twemoji SVGs used by the product image catalogue into
// public/product-images/ and removes ones no longer referenced. Custom
// drawings (x-*.svg) live in that folder already and are only checked.
// Run after editing src/core/catalog/productImageCatalog.ts:  npm run images:sync
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_ROWS, catalogFileName } from "../src/core/catalog/productImageCatalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "@twemoji", "svg");
const target = join(root, "public", "product-images");
mkdirSync(target, { recursive: true });

const wanted = new Set();
const problems = [];
for (const rows of Object.values(CATALOG_ROWS)) {
  for (const [key, image] of rows) {
    const file = catalogFileName(image);
    wanted.add(file);
    if (image.startsWith("x:")) {
      if (!existsSync(join(target, file))) problems.push(`${key}: missing custom drawing ${file}`);
      continue;
    }
    const from = join(source, file);
    if (!existsSync(from)) {
      problems.push(`${key}: no Twemoji asset for ${image} (${file})`);
      continue;
    }
    copyFileSync(from, join(target, file));
  }
}

let removed = 0;
for (const file of readdirSync(target)) {
  if (file.endsWith(".svg") && !wanted.has(file)) {
    rmSync(join(target, file));
    removed += 1;
  }
}

if (problems.length) {
  console.error(`Product image sync failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Synced ${wanted.size} product images (${removed} unused removed).`);
