import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  mapPublicDocument,
  mapPublicImage,
  mapPublicSeo,
  type PublicDocumentRow,
  type PublicImageRow,
} from "@/server/catalog/shared-mappers";

function imageRow(publicUrl: string): PublicImageRow {
  return {
    publicId: "00000000-0000-4000-8000-000000000001",
    kind: "IMAGE",
    publicUrl,
    altText: "Public image",
    width: 800,
    height: 800,
    isPrivate: false,
    deletedAt: null,
  };
}

function documentRow(publicUrl: string): PublicDocumentRow {
  return {
    ...imageRow(publicUrl),
    kind: "DOCUMENT",
    mimeType: "application/pdf",
  };
}

describe("public asset DTO mapping", () => {
  it("uses the fail-closed asset policy for images and documents", () => {
    expect(mapPublicImage(imageRow("https://cdn.example/image.jpg"), "Image"))
      .toMatchObject({ url: "https://cdn.example/image.jpg" });
    expect(
      mapPublicDocument(
        documentRow("https://cdn.example/reference.pdf"),
        "Reference",
      ),
    ).toMatchObject({ url: "https://cdn.example/reference.pdf" });

    for (const unsafe of [
      "http://cdn.example/image.jpg",
      "https://user:pass@cdn.example/image.jpg",
      "/products/foo%255cbar.jpg",
      "/products/foo%250abar.jpg",
    ]) {
      expect(mapPublicImage(imageRow(unsafe), "Image")).toBeNull();
      expect(
        mapPublicDocument(documentRow(unsafe.replace(/\.jpg$/u, ".pdf")), "Reference"),
      ).toBeNull();
    }
  });

  it("fails closed for an unsafe Open Graph asset and an insecure canonical URL", () => {
    const seo = mapPublicSeo({
      title: "Catalog item",
      description: null,
      canonicalUrl: "http://catalog.example/products/item",
      noIndex: false,
      noFollow: false,
      structuredData: null,
      openGraphMedia: imageRow("https://user:pass@cdn.example/og.jpg"),
    });

    expect(seo?.canonicalUrl).toBeNull();
    expect(seo?.openGraphImage).toBeNull();
  });

  it("maps an eligible Open Graph override and hardened HTTPS canonical", () => {
    const seo = mapPublicSeo({
      title: "Catalog item",
      description: null,
      canonicalUrl: "https://catalog.example/products/item",
      noIndex: false,
      noFollow: false,
      structuredData: null,
      openGraphMedia: imageRow("/media/item-og.jpg"),
    });

    expect(seo?.canonicalUrl).toBe(
      "https://catalog.example/products/item",
    );
    expect(seo?.openGraphImage).toMatchObject({
      publicId: "00000000-0000-4000-8000-000000000001",
      url: "/media/item-og.jpg",
    });
  });
});
