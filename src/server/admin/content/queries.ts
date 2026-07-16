import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { buildPagination, type SearchParameter } from "@/lib/pagination";
import { publicIdSchema } from "@/server/admin/audit/validation";
import {
  ADMIN_CONTENT_PAGE_SIZE,
  parseAdminContentFilters,
} from "@/server/admin/content/filters";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

export async function getAdminContentIndex(
  searchParams: Record<string, SearchParameter> = {},
) {
  await requirePermission("content.read", "/admin/content");

  const { filters, validationError } = parseAdminContentFilters(searchParams);
  const db = getDb();
  const postWhere: Prisma.BlogPostWhereInput = {
    deletedAt: null,
    ...(filters.blogQuery
      ? {
          OR: [
            {
              title: {
                contains: filters.blogQuery,
                mode: "insensitive" as const,
              },
            },
            {
              slug: {
                contains: filters.blogQuery,
                mode: "insensitive" as const,
              },
            },
            {
              category: {
                contains: filters.blogQuery,
                mode: "insensitive" as const,
              },
            },
            {
              authorDisplayName: {
                contains: filters.blogQuery,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };
  const pageWhere: Prisma.PageWhereInput = {
    deletedAt: null,
    managedRoute: null,
    ...(filters.pageQuery
      ? {
          OR: [
            {
              title: {
                contains: filters.pageQuery,
                mode: "insensitive" as const,
              },
            },
            {
              slug: {
                contains: filters.pageQuery,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };
  const faqWhere: Prisma.FaqWhereInput = {
    deletedAt: null,
    ...(filters.faqQuery
      ? {
          OR: [
            {
              question: {
                contains: filters.faqQuery,
                mode: "insensitive" as const,
              },
            },
            {
              slug: {
                contains: filters.faqQuery,
                mode: "insensitive" as const,
              },
            },
            {
              category: {
                contains: filters.faqQuery,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };
  const [postTotal, pageTotal, faqTotal] = await Promise.all([
    db.blogPost.count({ where: postWhere }),
    db.page.count({ where: pageWhere }),
    db.faq.count({ where: faqWhere }),
  ]);
  const postPagination = buildPagination(
    postTotal,
    filters.blogPage,
    ADMIN_CONTENT_PAGE_SIZE,
  );
  const pagePagination = buildPagination(
    pageTotal,
    filters.pagePage,
    ADMIN_CONTENT_PAGE_SIZE,
  );
  const faqPagination = buildPagination(
    faqTotal,
    filters.faqPage,
    ADMIN_CONTENT_PAGE_SIZE,
  );
  const [posts, pages, faqs] = await Promise.all([
    db.blogPost.findMany({
      where: postWhere,
      orderBy: [
        { publishedAt: "desc" },
        { updatedAt: "desc" },
        { id: "desc" },
      ],
      skip: postPagination.skip,
      take: postPagination.pageSize,
      select: {
        publicId: true,
        slug: true,
        title: true,
        category: true,
        status: true,
        format: true,
        publishedAt: true,
        updatedAt: true,
      },
    }),
    db.page.findMany({
      where: pageWhere,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: pagePagination.skip,
      take: pagePagination.pageSize,
      select: {
        publicId: true,
        slug: true,
        title: true,
        status: true,
        format: true,
        publishedAt: true,
        updatedAt: true,
      },
    }),
    db.faq.findMany({
      where: faqWhere,
      orderBy: [{ position: "asc" }, { id: "asc" }],
      skip: faqPagination.skip,
      take: faqPagination.pageSize,
      select: {
        publicId: true,
        slug: true,
        question: true,
        category: true,
        position: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    filters: {
      ...filters,
      blogPage: postPagination.page,
      pagePage: pagePagination.page,
      faqPage: faqPagination.page,
    },
    validationError,
    postPagination: {
      page: postPagination.page,
      pageSize: postPagination.pageSize,
      pageCount: postPagination.pageCount,
      total: postPagination.total,
    },
    pagePagination: {
      page: pagePagination.page,
      pageSize: pagePagination.pageSize,
      pageCount: pagePagination.pageCount,
      total: pagePagination.total,
    },
    faqPagination: {
      page: faqPagination.page,
      pageSize: faqPagination.pageSize,
      pageCount: faqPagination.pageCount,
      total: faqPagination.total,
    },
    posts: posts.map((post) => ({
      publicId: post.publicId,
      slug: post.slug,
      title: post.title,
      category: post.category,
      status: post.status,
      format: post.format,
      publishedAt: iso(post.publishedAt),
      updatedAt: post.updatedAt.toISOString(),
    })),
    pages: pages.map((page) => ({
      publicId: page.publicId,
      slug: page.slug,
      title: page.title,
      status: page.status,
      format: page.format,
      publishedAt: iso(page.publishedAt),
      updatedAt: page.updatedAt.toISOString(),
    })),
    faqs: faqs.map((faq) => ({
      publicId: faq.publicId,
      slug: faq.slug,
      question: faq.question,
      category: faq.category,
      position: faq.position,
      status: faq.status,
      publishedAt: iso(faq.publishedAt),
      updatedAt: faq.updatedAt.toISOString(),
    })),
  };
}

export async function getAdminBlogPost(publicId: string) {
  await requirePermission(
    "content.read",
    `/admin/content/blog/${encodeURIComponent(publicId)}`,
  );
  const parsedId = publicIdSchema.safeParse(publicId);
  if (!parsedId.success) return null;

  const post = await getDb().blogPost.findFirst({
    where: { publicId: parsedId.data, deletedAt: null },
    select: {
      publicId: true,
      slug: true,
      title: true,
      category: true,
      authorDisplayName: true,
      readingMinutes: true,
      excerpt: true,
      body: true,
      format: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
  if (!post) return null;

  return {
    ...post,
    publishedAt: iso(post.publishedAt),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export async function getAdminPage(publicId: string) {
  await requirePermission(
    "content.read",
    `/admin/content/pages/${encodeURIComponent(publicId)}`,
  );
  const parsedId = publicIdSchema.safeParse(publicId);
  if (!parsedId.success) return null;

  const page = await getDb().page.findFirst({
    where: {
      publicId: parsedId.data,
      deletedAt: null,
      managedRoute: null,
    },
    select: {
      publicId: true,
      slug: true,
      title: true,
      body: true,
      format: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
  if (!page) return null;

  return {
    ...page,
    publishedAt: iso(page.publishedAt),
    updatedAt: page.updatedAt.toISOString(),
  };
}

export async function getAdminFaq(publicId: string) {
  await requirePermission(
    "content.read",
    `/admin/content/faq/${encodeURIComponent(publicId)}`,
  );
  const parsedId = publicIdSchema.safeParse(publicId);
  if (!parsedId.success) return null;

  const faq = await getDb().faq.findFirst({
    where: { publicId: parsedId.data, deletedAt: null },
    select: {
      publicId: true,
      slug: true,
      question: true,
      answer: true,
      category: true,
      position: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
  if (!faq) return null;

  return {
    ...faq,
    publishedAt: iso(faq.publishedAt),
    updatedAt: faq.updatedAt.toISOString(),
  };
}
