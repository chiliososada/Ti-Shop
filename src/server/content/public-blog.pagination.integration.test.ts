import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getPublicBlogPage } from "@/server/content/public-blog";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("public blog pagination", () => {
  const suffix = randomUUID().slice(0, 12);
  const category = `Blog pagination ${suffix}`;
  const slugPrefix = `blog-page-it-${suffix}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const publishedAt = new Date(Date.now() - 60_000);
    await getDb().blogPost.createMany({
      data: [
        ...Array.from({ length: 13 }, (_, index) => ({
          slug: `${slugPrefix}-${String(index + 1).padStart(2, "0")}`,
          title: `Pagination article ${index + 1}`,
          body: "Integration pagination body.",
          category,
          status: "PUBLISHED" as const,
          publishedAt: new Date(publishedAt.getTime() - index),
        })),
        {
          slug: `${slugPrefix}-draft`,
          title: "Pagination draft",
          body: "This draft must not appear.",
          category,
          status: "DRAFT" as const,
          publishedAt: null,
        },
      ],
    });
  });

  afterAll(async () => {
    await getDb().blogPost.deleteMany({
      where: { slug: { startsWith: slugPrefix } },
    });
  });

  it("makes every published article reachable across stable pages", async () => {
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        getPublicBlogPage({ category, page, pageSize: 5 }),
      ),
    );
    const slugs = pages.flatMap((page) =>
      page.posts.map((post) => post.slug),
    );

    expect(pages[0].pagination).toMatchObject({
      page: 1,
      pageCount: 3,
      total: 13,
    });
    expect(slugs).toHaveLength(13);
    expect(new Set(slugs)).toHaveLength(13);
    expect(slugs).not.toContain(`${slugPrefix}-draft`);
  });

  it("clamps an out-of-range page to the final populated page", async () => {
    const result = await getPublicBlogPage({
      category,
      page: 999,
      pageSize: 5,
    });

    expect(result.pagination).toMatchObject({ page: 3, pageCount: 3, total: 13 });
    expect(result.posts).toHaveLength(3);
  });
});
