import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CATALOG, IMAGE_NONE, matchProductImage, resolveProductImage, searchCatalog, suggestImages,
} from "@/core/catalog/productImages";

const key = (name: string, category?: string) => matchProductImage(name, category)?.key;

describe("product image catalogue", () => {
  it("bundles hundreds of pictures with unique keys and files on disk", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(300);
    expect(new Set(CATALOG.map((image) => image.key)).size).toBe(CATALOG.length);
    for (const image of CATALOG) {
      expect(existsSync(join("public", "product-images", image.file)), image.key).toBe(true);
    }
  });

  it.each([
    ["Sugar 1kg", "sugar"],
    ["Cooking Oil 1L", "cooking-oil"],
    ["Maize Flour 2kg", "flour"],
    ["Posho 5kg", "flour"],
    ["Mineral Water 1.5L", "water"],
    ["Rwenzori 500ml", "water"],
    ["Soda 500ml", "soda"],
    ["Coca Cola 300ml", "soda"],
    ["Bar Soap", "soap"],
    ["Dettol soap", "soap"],
    ["Omo washing powder 1kg", "detergent"],
    ["Exercise Book", "notebook"],
    ["Bread Loaf", "bread"],
    ["Nile Special 500ml", "beer"],
    ["Tomatoes", "tomato"],
    ["Matooke bunch", "matooke"],
    ["Irish potatoes", "potato"],
    ["Groundnuts 1kg", "peanuts"],
    ["Rolex", "wrap"],
    ["Chapati", "flatbread"],
    ["Engine oil 1L", "engine-oil"],
    ["Kiwi shoe polish", "shoes"],
    ["Kiwi fruit", "kiwi-fruit"],
    ["Tecno Spark 20", "phone"],
    ["Samsung charger", "charger"],
    ["Airtel airtime 5000", "airtime"],
    ["Chicken feed 50kg", "animal-feed"],
    ["Blue Band 250g", "butter"],
    ["Gas refill 6kg", "gas"],
    ["Charcoal sack", "charcoal"],
    ["Paraffin 1L", "jerrycan"],
    ["Sanitary pads", "pads"],
    ["Pampers size 3", "diapers"],
    ["Panadol tablets", "pills"],
    ["Sukuma wiki", "leafy-greens"],
    ["Mandazi", "doughnut"],
    ["Frying pan", "pan"],
    ["Plastic chair", "chair"],
  ])("matches %s", (name, expected) => {
    expect(key(name)).toBe(expected);
  });

  it("tolerates small spelling slips", () => {
    expect(key("Tomatoe")).toBe("tomato");
  });

  it("falls back to the category, then to nothing", () => {
    expect(key("House blend", "Drinks")).toBe("soda");
    expect(key("House blend", "Groceries")).toBe("rice");
    expect(key("Zzqx")).toBeUndefined();
  });

  it("prefers a photo, then the saved picture, then a name match", () => {
    const photo = "data:image/jpeg;base64,AAAA";
    expect(resolveProductImage({ name: "Sugar", photo, imageKey: "rice" })).toMatchObject({ kind: "photo", src: photo });
    expect(resolveProductImage({ name: "Sugar", imageKey: "rice" })).toMatchObject({ kind: "catalog", label: "Rice" });
    expect(resolveProductImage({ name: "Sugar" })).toMatchObject({ kind: "catalog", label: "Sugar" });
    expect(resolveProductImage({ name: "Sugar", imageKey: IMAGE_NONE })).toBeNull();
  });

  it("searches and suggests for the picker", () => {
    expect(searchCatalog("soda").map((image) => image.key)).toContain("soda");
    expect(searchCatalog("", "electronics").every((image) => image.group === "electronics")).toBe(true);
    expect(suggestImages("Coca cola 500ml")[0].key).toBe("soda");
  });
});
