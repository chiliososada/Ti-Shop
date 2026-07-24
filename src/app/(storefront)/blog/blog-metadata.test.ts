import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/server/content", () => ({
  getPublicBlogPostBySlug: vi.fn(async (slug: string) =>
    slug === "metadata-test"
      ? {
          publicId: "blog_metadata_test",
          slug,
          title:
            "A deliberately long research article title that needs concise metadata",
          category: "Quality & Testing",
          author: "Flintmarrow Research Team",
          readingMinutes: 7,
          excerpt:
            "A deliberately long description for the public research article that demonstrates concise search metadata without exposing static source data or exceeding the expected search result length by accident.",
          heroImage: {
            publicId: "media_metadata_test",
            url: "/categories/antibacterial.jpg",
            alt: "Research equipment",
            width: 1200,
            height: 630,
          },
          publishedAt: "2026-06-18T00:00:00.000Z",
          body: "## Test\n\nBody",
          format: "markdown",
          structuredContent: null,
          updatedAt: "2026-07-13T00:00:00.000Z",
          seo: {
            title:
              "A deliberately long research article title that needs concise metadata | Flintmarrow",
            description:
              "A deliberately long description for the public research article that demonstrates concise search metadata without exposing static source data or exceeding the expected search result length by accident.",
            canonicalUrl: "/blog/metadata-test",
            noIndex: false,
            noFollow: false,
            openGraphImage: null,
            structuredData: null,
          },
        }
      : null,
  ),
  getPublicBlogPosts: vi.fn(async () => []),
}));

import { generateMetadata } from "@/app/(storefront)/blog/[slug]/page";

describe("blog metadata", () => {
  it("uses the public DTO and keeps SEO text within concise limits", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "metadata-test" }),
      searchParams: Promise.resolve({}),
    });
    const title = metadata.title as { absolute: string };
    const description = metadata.description as string;

    expect(title.absolute.length).toBeLessThanOrEqual(60);
    expect(title.absolute.match(/Flintmarrow/gi)).toHaveLength(1);
    expect(description.length).toBeLessThanOrEqual(155);
    expect(metadata.alternates).toEqual({ canonical: "/blog/metadata-test" });
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("marks query-string variants noindex while keeping links followable", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "metadata-test" }),
      searchParams: Promise.resolve({ ref: "campaign" }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});
