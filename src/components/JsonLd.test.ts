import { describe, expect, it } from "vitest";

import {
  ArticleJsonLd,
  OrganizationJsonLd,
  ProductJsonLd,
  serializeJsonLd,
  WebPageJsonLd,
  WebSiteJsonLd,
} from "@/components/JsonLd";
import type { PublicProductDetailDto } from "@/domain/catalog";
import type { PublicBlogPostDto } from "@/domain/content";
import { resolvePublicSiteOrigin } from "@/lib/site-url";

type JsonLdElement = {
  props: {
    data: Record<string, unknown>;
  };
};

function dataFrom(element: React.JSX.Element) {
  return (element as JsonLdElement).props.data;
}

function productFixture(
  overrides: Partial<PublicProductDetailDto> = {},
): PublicProductDetailDto {
  return {
    publicId: "product_public_1",
    slug: "example-peptide",
    title: "Example Peptide",
    subtitle: null,
    shortDescription: "A documented research peptide.",
    brand: "Flintmarrow",
    purity: "≥99%",
    isFeatured: false,
    primaryImage: {
      publicId: "media_public_1",
      url: "/products/example.jpg",
      alt: "Example Peptide vial",
      width: 800,
      height: 800,
      renditions: null,
    },
    primaryCategory: {
      publicId: "category_public_1",
      slug: "research",
      name: "Research",
    },
    defaultVariantPublicId: "variant_public_1",
    minimumOrderQuantity: 1,
    priceMode: "fixed",
    price: {
      amountMinor: "12345",
      currency: "USD",
      display: "$123.45",
      kind: "regular",
      taxInclusive: false,
    },
    description: "A documented material.",
    casNumber: "123-45-6",
    appearance: "White powder",
    storageInstructions: "Store cool and dry.",
    publishedAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    categories: [],
    tags: [],
    gallery: [],
    documents: [],
    variants: [
      {
        publicId: "variant_public_1",
        sku: "EXAMPLE-5MG",
        title: "5mg vial",
        optionValues: { size: "5mg" },
        minimumOrderQuantity: 1,
        requiresShipping: true,
        priceMode: "fixed",
        price: {
          amountMinor: "12345",
          currency: "USD",
          display: "$123.45",
          kind: "regular",
          taxInclusive: false,
        },
        directPurchaseAvailable: true,
      },
    ],
    seo: null,
    ...overrides,
  };
}

describe("JSON-LD", () => {
  it("escapes script terminators and HTML-significant characters", () => {
    const unsafe = "research </script><script>alert('&')</script>";
    const serialized = serializeJsonLd({ description: unsafe });

    expect(serialized).not.toContain("</script");
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(serialized).toContain("\\u0026");
    expect(JSON.parse(serialized)).toEqual({ description: unsafe });
  });

  it("limits the organization's service area to the United States", () => {
    const organization = dataFrom(OrganizationJsonLd());
    const contactPoints = organization.contactPoint as Array<{
      areaServed: string;
    }>;

    expect(contactPoints).toHaveLength(1);
    expect(contactPoints[0].areaServed).toBe("US");
    expect(organization).not.toHaveProperty("foundingDate");
    expect(organization).not.toHaveProperty("address");
    expect(contactPoints[0]).not.toHaveProperty("availableLanguage");
  });

  it("links the real website, organization, and web-page graph nodes", () => {
    const siteOrigin = resolvePublicSiteOrigin();
    const organization = dataFrom(OrganizationJsonLd());
    const website = dataFrom(WebSiteJsonLd());
    const page = dataFrom(
      WebPageJsonLd({
        title: "Procurement guide",
        description: "A public procurement guide.",
        url: "/pages/procurement-guide",
        datePublished: "2026-07-01T00:00:00.000Z",
        dateModified: "2026-07-02T00:00:00.000Z",
      }),
    );

    expect(website).toMatchObject({
      "@type": "WebSite",
      "@id": `${siteOrigin}/#website`,
      url: siteOrigin,
      publisher: { "@id": `${siteOrigin}/#organization` },
    });
    expect(organization["@id"]).toBe(
      (website.publisher as Record<string, unknown>)["@id"],
    );
    expect(page.isPartOf).toEqual({ "@id": website["@id"] });
    expect(page.publisher).toEqual({ "@id": organization["@id"] });
    expect(website).not.toHaveProperty("potentialAction");
    expect(JSON.stringify(website)).not.toContain("SearchAction");
  });

  it("does not turn a catalog purity field into an analytical verification claim", () => {
    const structuredProduct = dataFrom(
      ProductJsonLd({ product: productFixture() }),
    );
    const properties = structuredProduct.additionalProperty as Array<{
      name: string;
      value: string;
    }>;
    const purity = properties.find(
      (property) => property.name === "Catalog purity field",
    );

    expect(purity).toEqual({
      "@type": "PropertyValue",
      name: "Catalog purity field",
      value: "≥99%",
    });
    expect(JSON.stringify(properties)).not.toMatch(/verified|HPLC|mass spectrometry/iu);
  });

  it("uses the exact variant price and conservative public availability", () => {
    const structuredProduct = dataFrom(
      ProductJsonLd({ product: productFixture() }),
    );
    const offer = structuredProduct.offers as Record<string, unknown>;

    expect(structuredProduct).not.toHaveProperty("sku");
    expect(offer.sku).toBe("EXAMPLE-5MG");
    expect(offer.availability).toBe("https://schema.org/InStock");
    expect(offer.priceCurrency).toBe("USD");
    expect(offer.price).toBe("123.45");
    expect(offer.eligibleQuantity).toEqual({
      "@type": "QuantitativeValue",
      minValue: 1,
      unitCode: "EA",
    });
  });

  it("keeps unsafe asset URLs out of product structured data", () => {
    const structuredProduct = dataFrom(
      ProductJsonLd({
        product: productFixture({
          primaryImage: {
            ...productFixture().primaryImage!,
            url: "https://user:password@cdn.example/product.jpg",
          },
          gallery: [
            {
              ...productFixture().primaryImage!,
              publicId: "media_public_2",
              url: "/products/foo%250abar.jpg",
            },
          ],
        }),
      }),
    );

    expect(structuredProduct).not.toHaveProperty("image");
  });

  it("omits Offer entirely for pricing-on-request products", () => {
    const structuredProduct = dataFrom(
      ProductJsonLd({
        product: productFixture({
          priceMode: "on-request",
          price: null,
          variants: [],
        }),
      }),
    );

    expect(structuredProduct).not.toHaveProperty("offers");
  });

  it("publishes one truthful Offer per direct-sale variant", () => {
    const second = {
      ...productFixture().variants[0],
      publicId: "variant_public_2",
      sku: "EXAMPLE-10MG",
      title: "10mg vial",
      minimumOrderQuantity: 2,
      price: {
        ...productFixture().variants[0].price,
        amountMinor: "20000",
        display: "$200.00",
      },
      directPurchaseAvailable: false,
    };
    const structuredProduct = dataFrom(
      ProductJsonLd({
        product: productFixture({
          variants: [...productFixture().variants, second],
        }),
      }),
    );
    const offers = structuredProduct.offers as Array<
      Record<string, unknown>
    >;

    expect(offers).toHaveLength(2);
    expect(offers[1]).toMatchObject({
      name: "10mg vial",
      sku: "EXAMPLE-10MG",
      price: "200.00",
      availability: "https://schema.org/OutOfStock",
      eligibleQuantity: { minValue: 2 },
    });
  });

  it("uses a product's configured canonical URL in its graph and offer", () => {
    const structuredProduct = dataFrom(
      ProductJsonLd({
        product: productFixture({
          seo: {
            title: null,
            description: null,
            canonicalUrl: "https://catalog.example/research/example-peptide",
            noIndex: false,
            noFollow: false,
            openGraphImage: null,
            structuredData: null,
          },
        }),
      }),
    );
    const offer = structuredProduct.offers as Record<string, unknown>;

    expect(structuredProduct["@id"]).toBe(
      "https://catalog.example/research/example-peptide#product",
    );
    expect(offer.url).toBe(
      "https://catalog.example/research/example-peptide",
    );
  });

  it("uses a blog post's configured canonical URL in its article graph", () => {
    const post: PublicBlogPostDto = {
      publicId: "blog_public_1",
      slug: "research-guide",
      title: "Research guide",
      category: "Guides",
      author: "Flintmarrow",
      readingMinutes: 4,
      excerpt: "A guide.",
      heroImage: null,
      publishedAt: "2026-07-01T00:00:00.000Z",
      body: "Guide body",
      format: "markdown",
      structuredContent: null,
      updatedAt: "2026-07-02T00:00:00.000Z",
      seo: {
        title: null,
        description: null,
        canonicalUrl: "https://journal.example/guides/research-guide",
        noIndex: false,
        noFollow: false,
        openGraphImage: null,
        structuredData: null,
      },
    };
    const structuredArticle = dataFrom(ArticleJsonLd({ post }));

    expect(structuredArticle["@id"]).toBe(
      "https://journal.example/guides/research-guide#article",
    );
    expect(structuredArticle.mainEntityOfPage).toEqual({
      "@type": "WebPage",
      "@id": "https://journal.example/guides/research-guide",
    });
  });
});
