import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  PublicPlacementRow,
  PublicProductDetailRow,
} from "@/server/catalog/query-contracts";
import {
  mapPublicPlacements,
  mapPublicProductDetail,
  mapPublicProductSummary,
  isConservativelyAvailableForMinimum,
  selectCurrentUsdPrice,
} from "@/server/catalog/mappers";
import {
  buildCurrentUsdPriceWhere,
  buildPublicDirectSaleVariantWhere,
  buildPublishedProductWhere,
  buildPublicProductDetailSelect,
  buildPublicProductSummarySelect,
} from "@/server/catalog/query-contracts";

const NOW = new Date("2026-07-13T12:00:00.000Z");

function image(
  publicId: string,
  publicUrl: string,
  altText: string,
) {
  return {
    publicId,
    kind: "IMAGE" as const,
    publicUrl,
    altText,
    mimeType: null,
    width: 800,
    height: 800,
    variants: null,
    uploadStatus: "READY" as const,
    isPrivate: false,
    deletedAt: null,
  };
}

function price(
  amountMinor: number,
  overrides: Partial<
    PublicProductDetailRow["variants"][number]["prices"][number]
  > = {},
) {
  return {
    amountMinor: BigInt(amountMinor),
    currency: "USD",
    kind: "REGULAR" as const,
    countryCode: "US",
    taxInclusive: false,
    isActive: true,
    startsAt: null,
    endsAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function productRow(): PublicProductDetailRow {
  return {
    publicId: "00000000-0000-4000-8000-000000000001",
    slug: "selank-5mg",
    title: "Selank 5mg",
    subtitle: null,
    shortDescription: "Research peptide",
    brand: "Flintmarrow",
    purity: "≥99%",
    isFeatured: true,
    description: "For laboratory research only.",
    casNumber: "129954-34-3",
    appearance: "White lyophilized powder",
    storageInstructions: "Store frozen.",
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T08:30:00.000Z"),
    variants: [
      {
        publicId: "00000000-0000-4000-8000-000000000002",
        sku: "SELANK-5MG",
        title: "5mg vial",
        priceMode: "FIXED",
        optionValues: { size: "5mg" },
        requiresShipping: true,
        trackInventory: true,
        inventoryLevels: [
          {
            onHandQuantity: 10,
            reservedQuantity: 2,
            safetyStockQuantity: 1,
          },
        ],
        position: 0,
        prices: [price(4950)],
      },
    ],
    media: [
      {
        role: "GALLERY",
        position: 0,
        variant: {
          product: { publicId: "00000000-0000-4000-8000-000000000001" },
        },
        media: image(
          "00000000-0000-4000-8000-000000000003",
          "/products/selank-gallery.jpg",
          "Gallery",
        ),
      },
      {
        role: "PRIMARY",
        position: 2,
        variant: {
          product: { publicId: "00000000-0000-4000-8000-000000000001" },
        },
        media: image(
          "00000000-0000-4000-8000-000000000004",
          "/products/selank-primary-second.jpg",
          "Second primary",
        ),
      },
      {
        role: "PRIMARY",
        position: 1,
        variant: {
          product: { publicId: "00000000-0000-4000-8000-000000000001" },
        },
        media: image(
          "00000000-0000-4000-8000-000000000005",
          "/products/selank-primary.jpg",
          "Primary",
        ),
      },
    ],
    categories: [
      {
        position: 0,
        category: {
          publicId: "00000000-0000-4000-8000-000000000006",
          slug: "neuroscience",
          name: "Neuroscience",
        },
      },
    ],
    tags: [{ tag: { slug: "research", name: "Research" } }],
    seo: {
      title: "Selank 5mg Research Peptide",
      description: "Public description",
      canonicalUrl: "/products/selank-5mg",
      noIndex: false,
      noFollow: false,
      structuredData: { "@type": "Product" },
      openGraphMedia: null,
    },
  };
}

describe("public catalog query contracts", () => {
  it("requires published, active, non-deleted product rows", () => {
    expect(buildPublishedProductWhere(NOW)).toEqual({
      status: "ACTIVE",
      deletedAt: null,
      publishedAt: { not: null, lte: NOW },
    });
  });

  it("limits prices to current US/USD public windows", () => {
    expect(buildCurrentUsdPriceWhere(NOW)).toMatchObject({
      currency: "USD",
      isActive: true,
      deletedAt: null,
      AND: [
        { OR: [{ countryCode: "US" }, { countryCode: null }] },
        { OR: [{ startsAt: null }, { startsAt: { lte: NOW } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: NOW } }] },
      ],
    });
  });

  it("queries primary media explicitly and never defines gallery as its fallback", () => {
    const summarySelect = buildPublicProductSummarySelect(NOW);
    const select = buildPublicProductDetailSelect(NOW);
    expect(summarySelect.media.where).toMatchObject({ role: "PRIMARY" });
    expect(summarySelect.media.where).not.toHaveProperty("variantId");
    expect(select.media.where).toMatchObject({
      OR: [
        {
          role: { in: ["PRIMARY", "GALLERY"] },
          media: { kind: "IMAGE", isPrivate: false, deletedAt: null },
        },
        {
          role: "DOCUMENT",
          media: { kind: "DOCUMENT", isPrivate: false, deletedAt: null },
        },
      ],
    });
    expect(summarySelect.variants.where).toEqual(
      buildPublicDirectSaleVariantWhere(NOW),
    );
    expect(select.variants.where).toEqual(
      buildPublicDirectSaleVariantWhere(NOW),
    );
    expect(select.variants.select.inventoryLevels.where).toEqual({
      location: { is: { isActive: true, countryCode: "US" } },
    });
  });
});

describe("public catalog DTO mappers", () => {
  it("serializes dates and bigint money without leaking Prisma records", () => {
    const dto = mapPublicProductDetail(productRow(), NOW);

    expect(dto).toMatchObject({
      slug: "selank-5mg",
      price: {
        amountMinor: "4950",
        currency: "USD",
        display: "$49.50",
      },
      publishedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-07-01T08:30:00.000Z",
      minimumOrderQuantity: 1,
    });
    expect(dto?.variants[0]).toMatchObject({
      priceMode: "fixed",
      directPurchaseAvailable: true,
    });
    expect(() => JSON.stringify(dto)).not.toThrow();
    expect(JSON.stringify(dto)).not.toContain('"id"');
  });

  it("maps the default variant MOQ from structured option data", () => {
    const row = productRow();
    row.variants[0].optionValues = {
      size: "5mg",
      minimumOrderQuantity: 4,
    };

    const summary = mapPublicProductSummary(row, NOW);
    const detail = mapPublicProductDetail(row, NOW);
    expect(summary.minimumOrderQuantity).toBe(4);
    expect(detail?.minimumOrderQuantity).toBe(4);
    expect(detail?.variants[0].minimumOrderQuantity).toBe(4);
  });

  it("uses only the lowest-position PRIMARY image", () => {
    const dto = mapPublicProductSummary(productRow(), NOW);
    expect(dto.primaryImage?.url).toBe("/products/selank-primary.jpg");

    const galleryOnly = productRow();
    galleryOnly.media = galleryOnly.media.filter(
      (item) => item.role === "GALLERY",
    );
    expect(mapPublicProductSummary(galleryOnly, NOW).primaryImage).toBeNull();

    const crossProductVariant = productRow();
    crossProductVariant.media = crossProductVariant.media
      .filter((item) => item.role === "PRIMARY")
      .map((item) => ({
        ...item,
        variant: {
          product: { publicId: "00000000-0000-4000-8000-999999999999" },
        },
      }));
    expect(
      mapPublicProductSummary(crossProductVariant, NOW).primaryImage,
    ).toBeNull();
  });

  it("keeps private, deleted, and non-HTTPS remote images out of the public gallery", () => {
    const row = productRow();
    row.media.push(
      {
        role: "GALLERY",
        position: 10,
        variant: null,
        media: {
          ...image(
            "00000000-0000-4000-8000-000000000020",
            "/products/private.jpg",
            "Private image",
          ),
          isPrivate: true,
        },
      },
      {
        role: "GALLERY",
        position: 11,
        variant: null,
        media: {
          ...image(
            "00000000-0000-4000-8000-000000000021",
            "http://cdn.example/insecure.jpg",
            "Insecure image",
          ),
        },
      },
      {
        role: "GALLERY",
        position: 12,
        variant: null,
        media: {
          ...image(
            "00000000-0000-4000-8000-000000000022",
            "https://cdn.example/public.jpg",
            "Public HTTPS image",
          ),
        },
      },
      {
        role: "GALLERY",
        position: 13,
        variant: null,
        media: {
          ...image(
            "00000000-0000-4000-8000-000000000023",
            "/products/deleted.jpg",
            "Deleted image",
          ),
          deletedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      },
    );

    const detail = mapPublicProductDetail(row, NOW);
    expect(detail?.gallery.map(({ publicId }) => publicId)).toContain(
      "00000000-0000-4000-8000-000000000022",
    );
    expect(JSON.stringify(detail)).not.toMatch(
      /Private image|Insecure image|Deleted image/u,
    );
  });

  it("exposes only safe public document media without inventing document types", () => {
    const row = productRow();
    row.media.push(
      {
        role: "DOCUMENT",
        position: 10,
        variant: null,
        media: {
          ...image(
            "00000000-0000-4000-8000-000000000010",
            "/documents/selank-reference.pdf",
            "Manufacturer reference file",
          ),
          kind: "DOCUMENT",
          mimeType: "application/pdf",
        },
      },
      {
        role: "DOCUMENT",
        position: 11,
        variant: null,
        media: {
          ...image(
            "00000000-0000-4000-8000-000000000011",
            "/documents/private.pdf",
            "Private file",
          ),
          kind: "DOCUMENT",
          mimeType: "application/pdf",
          isPrivate: true,
        },
      },
      {
        role: "DOCUMENT",
        position: 12,
        variant: null,
        media: {
          ...image(
            "00000000-0000-4000-8000-000000000012",
            "javascript:alert(1)",
            "Unsafe file",
          ),
          kind: "DOCUMENT",
          mimeType: "text/html",
        },
      },
      {
        role: "DOCUMENT",
        position: 13,
        variant: null,
        media: {
          ...image(
            "00000000-0000-4000-8000-000000000013",
            "/documents/mislabeled.html",
            "Mislabeled file",
          ),
          kind: "DOCUMENT",
          mimeType: "application/pdf",
        },
      },
    );

    const detail = mapPublicProductDetail(row, NOW);
    expect(detail?.documents).toEqual([
      {
        publicId: "00000000-0000-4000-8000-000000000010",
        url: "/documents/selank-reference.pdf",
        label: "Manufacturer reference file",
        mimeType: "application/pdf",
      },
    ]);
    expect(JSON.stringify(detail)).not.toMatch(
      /Private file|Unsafe file|Mislabeled file/u,
    );
    expect(JSON.stringify(detail)).not.toMatch(/COA|SDS/u);
  });

  it("prefers an exact US price and rejects expired or inactive candidates", () => {
    const selected = selectCurrentUsdPrice(
      [
        price(2500, { countryCode: null, kind: "SALE" }),
        price(3500, { countryCode: "US", kind: "REGULAR" }),
        price(1000, {
          countryCode: "US",
          kind: "SALE",
          endsAt: new Date("2026-07-13T11:59:59.000Z"),
        }),
        price(500, { countryCode: "US", isActive: false }),
      ],
      NOW,
    );

    expect(selected).toMatchObject({
      amountMinor: "3500",
      display: "$35.00",
      kind: "regular",
    });
  });

  it("always returns null pricing for an on-request default variant", () => {
    const row = productRow();
    row.variants[0].priceMode = "ON_REQUEST";
    expect(mapPublicProductSummary(row, NOW)).toMatchObject({
      defaultVariantPublicId: null,
      priceMode: null,
      price: null,
    });
    expect(mapPublicProductDetail(row, NOW)?.variants).toEqual([]);
  });

  it("omits malformed direct-sale variants and exposes no exact stock quantity", () => {
    const row = productRow();
    row.variants.push({
      ...row.variants[0],
      publicId: "00000000-0000-4000-8000-000000000099",
      title: "Malformed variant",
      optionValues: { minimumOrderQuantity: 0 },
      position: 1,
    });

    const detail = mapPublicProductDetail(row, NOW);
    expect(detail?.variants).toHaveLength(1);
    expect(detail?.variants[0]).not.toHaveProperty("inventoryLevels");
    expect(detail?.variants[0]).not.toHaveProperty("onHandQuantity");
    expect(JSON.stringify(detail)).not.toContain("reservedQuantity");
  });

  it("uses only free quantity above reservations and safety stock for the public availability flag", () => {
    expect(
      isConservativelyAvailableForMinimum({
        trackInventory: true,
        minimumOrderQuantity: 4,
        levels: [
          {
            onHandQuantity: 5,
            reservedQuantity: 3,
            safetyStockQuantity: 1,
          },
          {
            onHandQuantity: 4,
            reservedQuantity: 1,
            safetyStockQuantity: 0,
          },
        ],
      }),
    ).toBe(true);
    expect(
      isConservativelyAvailableForMinimum({
        trackInventory: true,
        minimumOrderQuantity: 5,
        levels: [
          {
            onHandQuantity: 5,
            reservedQuantity: 3,
            safetyStockQuantity: 1,
          },
          {
            onHandQuantity: 4,
            reservedQuantity: 1,
            safetyStockQuantity: 0,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isConservativelyAvailableForMinimum({
        trackInventory: false,
        minimumOrderQuantity: 99,
        levels: [],
      }),
    ).toBe(true);
  });

  it("exposes only the validated category-signature presentation fields", () => {
    const rows: PublicPlacementRow[] = [
      {
        key: "legacy-category-signatures",
        position: 0,
        metadata: {
          source: "src/data/featured.ts",
          categorySlug: "neuroscience",
          index: "01",
          image: "/products/selank-primary.jpg",
          productName: "Selank 5mg",
          benefit: "A public research summary.",
        },
        product: productRow(),
      },
    ];

    expect(
      mapPublicPlacements(
        rows,
        ["legacy-category-signatures"],
        8,
        NOW,
      ),
    ).toMatchObject({
      "legacy-category-signatures": [
        {
          position: 0,
          presentation: {
            categorySlug: "neuroscience",
            imageUrl: "/products/selank-primary.jpg",
          },
          product: { slug: "selank-5mg" },
        },
      ],
    });
  });
});
