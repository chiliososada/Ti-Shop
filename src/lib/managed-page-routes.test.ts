import { describe, expect, it } from "vitest";

import {
  MANAGED_PAGE_DEFINITIONS,
  managedPagePublicPath,
} from "@/lib/managed-page-routes";

describe("managed page route registry", () => {
  it("keeps every established storefront canonical path", () => {
    expect(
      MANAGED_PAGE_DEFINITIONS.map(({ routeKey, path }) => [routeKey, path]),
    ).toEqual([
      ["ABOUT", "/about"],
      ["SHIPPING", "/shipping"],
      ["RETURNS_AND_REFUNDS", "/returns"],
      ["PRIVACY_POLICY", "/privacy"],
      ["TERMS_OF_SERVICE", "/terms"],
      ["PAYMENT_POLICY", "/payment-policy"],
      ["RESEARCH_USE_POLICY", "/research-use"],
    ]);
  });

  it("uses /pages only for ordinary pages", () => {
    expect(managedPagePublicPath("PRIVACY_POLICY", "internal")).toBe(
      "/privacy",
    );
    expect(managedPagePublicPath(null, "procurement-guide")).toBe(
      "/pages/procurement-guide",
    );
  });
});
