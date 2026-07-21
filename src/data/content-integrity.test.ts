import { describe, expect, it } from "vitest";

import { company } from "@/data/company";
import {
  about,
  categoryIntros,
  faqs,
  guarantees,
  hero,
  homeSections,
  processSteps,
} from "@/data/content";
import { categories } from "@/data/categories";
import { featured } from "@/data/featured";
import rawPurchaseCatalog from "@/data/purchase-catalog.json";
import rawProducts from "@/data/products.json";
import rawPriceList from "@/data/price-list-iris.json";

const publicMarketingCopy = JSON.stringify({
  company,
  hero,
  homeSections,
  processSteps,
  guarantees,
  about,
  categoryIntros,
  faqs,
  categories,
  featured,
});

const unsupportedClaimPatterns = [
  /\bGMP(?:-grade)?\b/iu,
  /(?:ultra[- ]pure|purest choice)/iu,
  /(?:≥\s*99%|99%\+).{0,120}(?:purity|HPLC)/iu,
  /(?:HPLC|mass spectrometry).{0,120}(?:verified|every (?:batch|lot))/iu,
  /(?:every|each) (?:order|shipment|batch|lot).{0,120}(?:COA|Certificate of Analysis)/iu,
  /(?:COA included|batch documentation for every order)/iu,
  /(?:24\s*\/\s*7|under 12 hours|within 12 hours|half a business day)/iu,
  /(?:regional inventory|regional stock|warehouses?|AI-driven)/iu,
  /(?:direct manufacturer|not a reseller|manufacturing team)/iu,
  /(?:founded in 20\d{2}|ten years|roughly \d+ .*specialists)/iu,
  /(?:cold-chain shipping|temperature-controlled delivery)/iu,
];

describe("public content integrity", () => {
  it("keeps public marketing copy free of unsupported operational and quality claims", () => {
    for (const pattern of unsupportedClaimPatterns) {
      expect(publicMarketingCopy).not.toMatch(pattern);
    }
  });

  it("does not publish an unverified founding date or facility address", () => {
    expect(company).not.toHaveProperty("founded");
    expect(company).not.toHaveProperty("address");
  });

  it("removes templated lot, test, presentation and handling claims from legacy products", () => {
    expect(rawProducts).toHaveLength(162);

    for (const product of rawProducts) {
      expect(product.purity).toBe("");
      expect(product.appearance).toBe("");
      expect(product.storage).toBe("");
      expect(product.description).not.toMatch(
        /batch-specific Certificate|HPLC purity|mass-spectrometric identity|sterile septum-capped/iu,
      );
      expect(`${product.shortDescription} ${product.description}`).not.toMatch(
        /\b(?:potent|strong|classic|premium|gold-standard|master|healing|restoration|suppression|senescent-cell clearance|wound-healing|anti-aging|weight-management|micro-dose|dosing protocols|weekly-dose|once-daily|injection|cosmetic|aesthetic|libido)\b/iu,
      );
    }
  });

  it("publishes exactly the supplier purchase catalog and preserves applicable PDF prices", () => {
    expect(rawPriceList).toHaveLength(209);
    expect(rawPurchaseCatalog.products).toHaveLength(162);
    const productsById = new Map(rawProducts.map((product) => [product.id, product]));
    const sourcePrices = new Map(
      rawPriceList.map((item) => [`${item.name}|${item.presentation}`, item.price]),
    );

    for (const sourceItem of rawPurchaseCatalog.products) {
      const product = productsById.get(sourceItem.productId);
      expect(product, sourceItem.name).toBeDefined();
      expect(product?.name, sourceItem.productId).toBe(sourceItem.name);
      expect(product?.presentation ?? null, sourceItem.productId).toBe(
        sourceItem.presentation,
      );
      expect(product?.price, sourceItem.productId).toBe(sourceItem.priceUsd);

      if (sourceItem.priceSource === "sales-price-list") {
        expect(
          sourcePrices.get(`${sourceItem.name}|${sourceItem.presentation ?? ""}`),
          sourceItem.name,
        ).toBe(sourceItem.priceUsd);
      }
    }

    expect(new Set(rawPurchaseCatalog.products.map((item) => item.productId))).toEqual(
      new Set(rawProducts.map((product) => product.id)),
    );
    expect(
      rawPurchaseCatalog.products.filter(
        (item) => item.priceSource === "calculated-average-margin",
      ),
    ).toHaveLength(10);
  });
});
