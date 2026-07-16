import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ManagedPageContent } from "@/components/ManagedPageContent";
import { getManagedPageDefinition } from "@/lib/managed-page-routes";

describe("managed storefront page rendering", () => {
  it("renders safe blocks at the fixed route and always retains compliance copy", () => {
    const definition = getManagedPageDefinition("PAYMENT_POLICY");
    if (!definition) throw new Error("Payment policy definition is missing.");

    const html = renderToStaticMarkup(
      createElement(ManagedPageContent, {
        definition,
        page: {
          publicId: "11111111-1111-4111-8111-111111111111",
          routeKey: "PAYMENT_POLICY",
          title: "Reviewed payment policy",
          body: "## Verification\n\nOnly the method shown on the order may be used.\n\n- Await administrator confirmation",
          publishedAt: "2026-07-13T00:00:00.000Z",
          updatedAt: "2026-07-13T01:00:00.000Z",
          seo: null,
        },
      }),
    );

    expect(html).toContain("Reviewed payment policy");
    expect(html).toContain("Await administrator confirmation");
    expect(html).toContain("Required compliance notice");
    expect(html).toContain("not for human or veterinary use");
    expect(html).toContain("browser return never proves payment");
    expect(html).toMatch(
      /https:\/\/[^"<]+\/payment-policy#webpage/u,
    );
  });
});
