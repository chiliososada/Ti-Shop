import { describe, expect, it } from "vitest";

import {
  createPublicPageMetadata,
  DEFAULT_OPEN_GRAPH_IMAGE,
  publicPageTitle,
} from "@/lib/public-page-metadata";

describe("public page metadata", () => {
  it("makes the document and Open Graph metadata agree", () => {
    const metadata = createPublicPageMetadata({
      title: "Shipping Policy — United States Orders",
      description: "Shipping details for supported orders.",
      canonical: "/shipping",
      robots: { index: true, follow: true },
    });

    expect(metadata).toMatchObject({
      title: { absolute: "Shipping Policy — United States Orders | Flintmarrow" },
      description: "Shipping details for supported orders.",
      alternates: { canonical: "/shipping" },
      robots: { index: true, follow: true },
      openGraph: {
        type: "website",
        siteName: "Flintmarrow",
        title: "Shipping Policy — United States Orders | Flintmarrow",
        description: "Shipping details for supported orders.",
        url: "/shipping",
        images: [DEFAULT_OPEN_GRAPH_IMAGE],
      },
      twitter: {
        title: "Shipping Policy — United States Orders | Flintmarrow",
        description: "Shipping details for supported orders.",
      },
    });
  });

  it("does not duplicate an existing site-name prefix or suffix", () => {
    expect(publicPageTitle("Flintmarrow | Research Materials")).toBe(
      "Flintmarrow | Research Materials",
    );
    expect(publicPageTitle("Research Materials | Flintmarrow")).toBe(
      "Research Materials | Flintmarrow",
    );
  });
});
