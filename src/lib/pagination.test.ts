import { describe, expect, it } from "vitest";

import {
  buildPagination,
  buildQueryHref,
  normalizePageOption,
  normalizePageSearchParameter,
  normalizeSearchText,
} from "@/lib/pagination";

describe("pagination helpers", () => {
  it("strictly normalizes repeated, malformed, and excessive page values", () => {
    expect(normalizePageSearchParameter("2")).toBe(2);
    expect(normalizePageSearchParameter(["2", "3"])).toBe(1);
    expect(normalizePageSearchParameter("02")).toBe(1);
    expect(normalizePageSearchParameter("0")).toBe(1);
    expect(normalizePageSearchParameter("10001")).toBe(1);
    expect(normalizePageOption(Number.NaN)).toBe(1);
    expect(normalizePageOption(4)).toBe(4);
  });

  it("collapses search whitespace and rejects repeated query parameters", () => {
    expect(normalizeSearchText("  alpha\n\t beta  ")).toBe("alpha beta");
    expect(normalizeSearchText(["alpha", "beta"])).toBe("");
    expect(normalizeSearchText("abcdefgh", 5)).toBe("abcde");
  });

  it("clamps an out-of-range page to the last discoverable page", () => {
    expect(buildPagination(51, 99, 20)).toEqual({
      page: 3,
      pageSize: 20,
      pageCount: 3,
      total: 51,
      skip: 40,
    });
    expect(buildPagination(0, 9, 20)).toEqual({
      page: 1,
      pageSize: 20,
      pageCount: 1,
      total: 0,
      skip: 0,
    });
  });

  it("builds deterministic links while omitting empty filters", () => {
    expect(
      buildQueryHref("/products", {
        q: "needle",
        category: "all",
        empty: "",
        page: 2,
      }),
    ).toBe("/products?category=all&page=2&q=needle");
  });
});
