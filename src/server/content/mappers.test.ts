import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PublicBlogDetailRow } from "@/server/content/query-contracts";
import { parseLegacyBlogContent } from "@/server/content/legacy-content";
import { mapPublicBlogDetail } from "@/server/content/mappers";
import { buildPublishedBlogPostWhere } from "@/server/content/query-contracts";

const NOW = new Date("2026-07-13T12:00:00.000Z");

function blogRow(): PublicBlogDetailRow {
  return {
    publicId: "00000000-0000-4000-8000-000000000011",
    slug: "peptide-quality-basics",
    title: "Peptide Quality Basics",
    category: "Quality & Testing",
    authorDisplayName: "sheng.an Research Team",
    readingMinutes: 7,
    excerpt: "How to evaluate research peptide quality.",
    publishedAt: new Date("2026-06-18T00:00:00.000Z"),
    updatedAt: new Date("2026-06-20T08:00:00.000Z"),
    heroMedia: {
      publicId: "00000000-0000-4000-8000-000000000012",
      kind: "IMAGE",
      publicUrl: "/categories/quality.jpg",
      altText: "Quality testing",
      width: 1200,
      height: 630,
      variants: null,
      uploadStatus: "READY" as const,
      isPrivate: false,
      deletedAt: null,
    },
    body: "Plain article source",
    contentData: {
      schemaVersion: 1,
      body: [
        { type: "h2", text: "What quality means" },
        { type: "p", text: "Identity and purity are distinct measurements." },
      ],
      takeaways: ["Check batch-specific evidence."],
      faqs: [{ q: "Is a generic COA enough?", a: "No." }],
      keyword: "peptide quality",
      related: ["certificate-of-analysis"],
      cover: "/categories/quality.jpg",
      legacyPosition: 0,
    },
    format: "MARKDOWN",
    seo: {
      title: "Peptide Quality Basics",
      description: "Quality guide",
      canonicalUrl: "/blog/peptide-quality-basics",
      noIndex: false,
      noFollow: false,
      structuredData: { "@type": "Article" },
      openGraphMedia: null,
    },
  };
}

describe("public blog query contracts", () => {
  it("requires published, non-deleted posts whose publish date has arrived", () => {
    expect(buildPublishedBlogPostWhere(NOW)).toEqual({
      status: "PUBLISHED",
      deletedAt: null,
      publishedAt: { not: null, lte: NOW },
    });
  });
});

describe("legacy blog content parsing", () => {
  it("maps the known legacy schema to a client-safe DTO", () => {
    const parsed = parseLegacyBlogContent(blogRow().contentData);
    expect(parsed).toMatchObject({
      faqs: [{ question: "Is a generic COA enough?", answer: "No." }],
      keyword: "peptide quality",
      relatedSlugs: ["certificate-of-analysis"],
    });
    expect(parsed?.body[0]).toEqual({
      type: "h2",
      text: "What quality means",
    });
  });

  it("fails closed for unknown or malformed legacy data", () => {
    expect(
      parseLegacyBlogContent({
        body: [{ type: "script", text: "private payload" }],
      }),
    ).toBeNull();
    expect(
      parseLegacyBlogContent({ body: [], internalDraftNotes: "do not expose" }),
    ).toBeNull();
  });

  it("never returns the raw contentData object from the public mapper", () => {
    const row = blogRow();
    row.contentData = { internalDraftNotes: "secret" };
    const dto = mapPublicBlogDetail(row);

    expect(dto?.structuredContent).toBeNull();
    expect(JSON.stringify(dto)).not.toContain("internalDraftNotes");
    expect(JSON.stringify(dto)).not.toContain("secret");
    expect(dto).toMatchObject({
      publishedAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-20T08:00:00.000Z",
    });
  });

  it("does not expose an insecure or credentialed blog hero asset", () => {
    const insecure = blogRow();
    if (insecure.heroMedia) {
      insecure.heroMedia.publicUrl = "http://cdn.example/hero.jpg";
    }
    expect(mapPublicBlogDetail(insecure)?.heroImage).toBeNull();

    const credentialed = blogRow();
    if (credentialed.heroMedia) {
      credentialed.heroMedia.publicUrl =
        "https://user:password@cdn.example/hero.jpg";
    }
    expect(mapPublicBlogDetail(credentialed)?.heroImage).toBeNull();
  });
});
