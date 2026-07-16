import { describe, expect, it } from "vitest";

import { publicRobots } from "@/app/_lib/public-seo";

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
