import { describe, expect, it } from "vitest";

import { summarizeWhatsAppSourceArea } from "@/server/admin/customers/summaries";

describe("customer communication summaries", () => {
  it("redacts product slugs, query strings, and fragments", () => {
    const source = "/products/private-slug?email=person@example.com#secret";
    const summary = summarizeWhatsAppSourceArea(source);

    expect(summary).toBe("Product page");
    expect(summary).not.toContain("private-slug");
    expect(summary).not.toContain("person@example.com");
  });

  it("does not echo external URLs", () => {
    expect(
      summarizeWhatsAppSourceArea("https://example.com/customer/private"),
    ).toBe("External source");
  });
});
