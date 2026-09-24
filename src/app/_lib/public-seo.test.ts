import { describe, expect, it } from "vitest";

import {
  catalogListingSeo,
  isValidListingPage,
  publicRobots,
} from "@/app/_lib/public-seo";

describe("public query-page robots policy", () => {
  it("keeps canonical listings indexable and every filtered or paged URL no-index", () => {
    expect(publicRobots({})).toEqual({ index: true, follow: true });
    expect(publicRobots({ page: "2" })).toEqual({
      index: false,
      follow: true,
    });
    expect(publicRobots({ category: "peptides", q: "needle" })).toEqual({
      index: false,
      follow: true,
    });
    expect(publicRobots({ sort: "newest" })).toEqual({
      index: false,
      follow: true,
    });
  });
});

describe("catalog listing pagination policy", () => {
  it("gives real listing pages their own indexable canonical", () => {
    expect(catalogListingSeo("/products", {}, 1)).toEqual({
      canonical: "/products",
      robots: { index: true, follow: true },
    });
    expect(catalogListingSeo("/products", { page: "3" }, 3)).toEqual({
      canonical: "/products?page=3",
      robots: { index: true, follow: true },
    });
  });

  it("keeps filtered, sorted and searched variants out of the index", () => {
    expect(
      catalogListingSeo("/products", { page: "2", sort: "name-asc" }, 2).robots,
    ).toEqual({ index: false, follow: true });
    expect(catalogListingSeo("/products", { q: "tirz" }, 1).robots).toEqual({
      index: false,
      follow: true,
    });
  });

  it("rejects clamped or malformed page parameters", () => {
    expect(isValidListingPage({}, 1)).toBe(true);
    expect(isValidListingPage({ page: "2" }, 2)).toBe(true);
    expect(isValidListingPage({ page: "999" }, 8)).toBe(false);
    expect(isValidListingPage({ page: "abc" }, 1)).toBe(false);
    expect(isValidListingPage({ page: "1" }, 1)).toBe(true);
    expect(catalogListingSeo("/products", { page: "999" }, 8).robots.index).toBe(
      false,
    );
  });
});
