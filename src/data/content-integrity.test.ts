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
import rawProducts from "@/data/products.json";

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
    expect(rawProducts).toHaveLength(75);

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
});
