import { describe, expect, it } from "vitest";

import { parseAdminCustomerFilters } from "@/server/admin/customers/filters";

describe("customer administration filters", () => {
  it("normalizes a single search and page value", () => {
    expect(
      parseAdminCustomerFilters({ q: "  Ada\n Lovelace ", page: "2" }),
    ).toEqual({
      filters: { q: "Ada Lovelace", page: 2 },
      validationError: false,
    });
  });

  it("rejects repeated, malformed, and excessive query parameters", () => {
    expect(parseAdminCustomerFilters({ q: ["a", "b"], page: "02" })).toEqual({
      filters: { q: "", page: 1 },
      validationError: true,
    });
    expect(parseAdminCustomerFilters({ page: "10001" })).toMatchObject({
      filters: { page: 1 },
      validationError: true,
    });
  });
});
