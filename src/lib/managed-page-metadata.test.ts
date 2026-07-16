import { describe, expect, it } from "vitest";

import { createManagedPageMetadata } from "@/lib/managed-page-metadata";
import { getManagedPageDefinition } from "@/lib/managed-page-routes";

const shipping = getManagedPageDefinition("SHIPPING");
if (!shipping) throw new Error("Shipping managed page definition is missing.");

describe("managed page metadata", () => {
  it("uses fallback metadata and the fixed existing canonical without a published override", () => {
    expect(createManagedPageMetadata(shipping, null)).toMatchObject({
      title: { absolute: "Shipping Policy — United States Orders | sheng.an" },
      alternates: { canonical: "/shipping" },
      robots: { index: true, follow: true },
      openGraph: { url: "/shipping" },
    });
  });

  it("uses safe managed SEO and OG data but cannot replace the fixed canonical", () => {
    const metadata = createManagedPageMetadata(
      shipping,
      {
        publicId: "11111111-1111-4111-8111-111111111111",
        routeKey: "SHIPPING",
        title: "Managed shipping",
        body: "Managed shipping details.",
        publishedAt: "2026-07-13T00:00:00.000Z",
        updatedAt: "2026-07-13T01:00:00.000Z",
        seo: {
          title: "Reviewed shipping",
          description: "Reviewed shipping metadata.",
          canonicalUrl: "https://wrong.example/shipping",
          noIndex: true,
          noFollow: false,
          openGraphImage: {
            publicId: "22222222-2222-4222-8222-222222222222",
            url: "/media/shipping.jpg",
            alt: "Shipping",
            width: 1200,
            height: 630,
            renditions: null,
          },
          structuredData: null,
        },
      },
      {},
    );

    expect(metadata).toMatchObject({
      title: { absolute: "Reviewed shipping | sheng.an" },
      description: "Reviewed shipping metadata.",
      alternates: { canonical: "/shipping" },
      robots: { index: false, follow: true },
      openGraph: {
        url: "/shipping",
        images: [
          {
            url: "/media/shipping.jpg",
            alt: "Shipping",
            width: 1200,
            height: 630,
          },
        ],
      },
    });
  });

  it("noindexes query variants even when the clean page is indexable", () => {
    const metadata = createManagedPageMetadata(shipping, null, { ref: "x" });
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });
});
