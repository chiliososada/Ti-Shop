import { describe, expect, it } from "vitest";

import { normalizePublicProductSort } from "@/server/catalog/inputs";
import { buildPublicProductOrderBy } from "@/server/catalog/query-contracts";

describe("public product sorting inputs", () => {
  it("accepts only the exact public sort vocabulary", () => {
    expect(normalizePublicProductSort("recommended")).toBe("recommended");
    expect(normalizePublicProductSort("name-asc")).toBe("name-asc");
    expect(normalizePublicProductSort("name-desc")).toBe("name-desc");
    expect(normalizePublicProductSort("newest")).toBe("newest");

    for (const value of [
      " newest ",
      "NEWEST",
      "price-asc",
      ["newest"],
      1,
      null,
      undefined,
    ]) {
      expect(normalizePublicProductSort(value)).toBe("recommended");
    }
  });

  it("uses an immutable id tie-breaker for every database order", () => {
    expect(buildPublicProductOrderBy("recommended")).toEqual([
      { position: "asc" },
      { title: "asc" },
      { id: "asc" },
    ]);
    expect(buildPublicProductOrderBy("name-asc")).toEqual([
      { title: "asc" },
      { id: "asc" },
    ]);
    expect(buildPublicProductOrderBy("name-desc")).toEqual([
      { title: "desc" },
      { id: "asc" },
    ]);
    expect(buildPublicProductOrderBy("newest")).toEqual([
      { publishedAt: "desc" },
      { id: "asc" },
    ]);
  });
});
