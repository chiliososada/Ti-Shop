import { describe, expect, it } from "vitest";

import { parseAdminCatalogFilters } from "@/server/admin/catalog/filters";

describe("admin catalog filters", () => {
  it("normalizes independent product and category filters", () => {
    expect(
      parseAdminCatalogFilters({
        productQ: "  Alpha\tBeta ",
        productPage: "3",
        categoryQ: " Proteins ",
        categoryPage: "2",
      }),
    ).toEqual({
      filters: {
        productQuery: "Alpha Beta",
        productPage: 3,
        categoryQuery: "Proteins",
        categoryPage: 2,
      },
      validationError: false,
    });
  });

  it("fails repeated and malformed parameters closed to safe defaults", () => {
    expect(
      parseAdminCatalogFilters({
        productQ: ["first", "second"],
        productPage: "0002",
        categoryPage: "10001",
      }),
    ).toEqual({
      filters: {
        productQuery: "",
        productPage: 1,
        categoryQuery: "",
        categoryPage: 1,
      },
      validationError: true,
    });
  });
});
