import { describe, expect, it } from "vitest";

import { categories } from "@/data/categories";
import {
  expectedCategoryAssignment,
  productCategoryFamilies,
  productCategorySlugs,
} from "@/data/product-category-taxonomy";
import rawProducts from "@/data/products.json";

describe("product category taxonomy", () => {
  it("keeps the six public categories aligned with the taxonomy", () => {
    expect(categories.map((category) => category.slug)).toEqual(
      productCategorySlugs,
    );
  });

  it("classifies every product by family before dosage", () => {
    for (const product of rawProducts) {
      const assignment = expectedCategoryAssignment(product.name);
      expect(assignment, product.name).not.toBeNull();
      expect(product.category, product.name).toBe(assignment?.category);
    }
  });

  it("does not define a family in more than one category", () => {
    const families = Object.values(productCategoryFamilies).flat();
    expect(new Set(families).size).toBe(families.length);
  });
});
