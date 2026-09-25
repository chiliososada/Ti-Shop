import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { productCategorySlugs } from "@/data/product-category-taxonomy";
import supplierCatalog from "@/data/supplier-catalog.json";
import priceList from "@/data/supplier-price-list.json";

const entries = supplierCatalog.products;
const rowsByNumber = new Map(priceList.products.map((row) => [row.row, row]));

describe("supplier catalog (Price_List.xlsx column H)", () => {
  it("publishes every price-list row exactly once, except explicit exclusions", () => {
    const represented = entries.flatMap((entry) => entry.sourceRows);
    const excluded = supplierCatalog.excludedRows.map((row) => row.row);
    expect(new Set(represented).size).toBe(represented.length);
    expect(represented.some((row) => excluded.includes(row))).toBe(false);
    expect([...represented, ...excluded].sort((a, b) => a - b)).toEqual(
      priceList.products.map((row) => row.row),
    );
    for (const row of supplierCatalog.excludedRows) {
      expect(row.reason.length, `row ${row.row}`).toBeGreaterThan(10);
    }
  });

  it("does not list reconstitution supplies", () => {
    for (const entry of entries) {
      expect(entry.title, entry.slug).not.toMatch(/bacteriostatic|sterile water|bac\.? ?water/iu);
      expect(entry.category, entry.slug).not.toBe("bac-water");
    }
  });

  it("prices every listing at the column H box price of its rows", () => {
    expect(priceList.priceColumn).toBe("H");
    for (const entry of entries) {
      expect(Number.isInteger(entry.priceUsd) && entry.priceUsd > 0).toBe(true);
      for (const row of entry.sourceRows) {
        expect(rowsByNumber.get(row)?.priceUsd).toBe(entry.priceUsd);
      }
    }
  });

  it("keeps specifications aligned with the sheet", () => {
    for (const entry of entries) {
      expect(entry.presentation).toBe(
        `${entry.strength} per vial, ${entry.packCount} vials/box`,
      );
      for (const row of entry.sourceRows) {
        const specification = rowsByNumber.get(row)!.specification;
        expect(specification).toMatch(new RegExp(`\\*\\s*${entry.packCount}\\s*vials$`, "iu"));
      }
    }
  });

  it("keeps slugs, titles and images unique and well-formed", () => {
    const slugs = entries.map((entry) => entry.slug);
    const titles = entries.map((entry) => entry.title);
    const images = entries.map((entry) => entry.image);
    expect(new Set(slugs).size).toBe(entries.length);
    expect(new Set(titles).size).toBe(entries.length);
    expect(new Set(images).size).toBe(entries.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    for (const entry of entries) {
      expect(entry.codes.length).toBeGreaterThan(0);
      expect(entry.title.length).toBeLessThanOrEqual(255);
      if (entry.previousSlug) expect(entry.previousSlug).not.toBe(entry.slug);
    }
  });

  it("assigns every listing to a known category", () => {
    for (const entry of entries) {
      expect(productCategorySlugs).toContain(entry.category);
    }
  });

  it("ships a catalog image for every listing", () => {
    for (const entry of entries) {
      expect(
        existsSync(resolve(process.cwd(), "public", entry.image.replace(/^\//u, ""))),
        `${entry.slug} → ${entry.image}`,
      ).toBe(true);
    }
  });

  it("marks rows noted as out of stock unavailable", () => {
    const outOfStockRows = new Set(
      priceList.notes.filter((note) => /out of stock/iu.test(note.text)).map((note) => note.row),
    );
    for (const entry of entries) {
      const expected = !entry.sourceRows.some((row) => outOfStockRows.has(row));
      expect(entry.available, entry.slug).toBe(expected);
    }
  });
});
