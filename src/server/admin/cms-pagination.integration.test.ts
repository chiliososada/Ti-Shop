import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: "cms-pagination-integration" } },
    roles: ["integration-test"],
    permissions: new Set([
      "communications.read",
      "content.read",
      "seo.read",
    ]),
  })),
}));

import { getAdminCommunicationsIndex } from "@/server/admin/communications/queries";
import { getAdminContentIndex } from "@/server/admin/content/queries";
import { getAdminSeoIndex } from "@/server/admin/seo/queries";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("admin CMS database pagination", () => {
  const suffix = randomUUID().slice(0, 8);
  const prefix = `cms-page-it-${suffix}`;
  const rows = Array.from({ length: 31 }, (_, index) => ({
    index,
    suffix: String(index).padStart(2, "0"),
  }));

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();

    await db.blogPost.createMany({
      data: rows.map(({ suffix: rowSuffix }) => ({
        slug: `${prefix}-blog-${rowSuffix}`,
        title: `${prefix} blog ${rowSuffix}`,
        body: "Pagination fixture",
        status: "DRAFT" as const,
      })),
    });
    await db.page.createMany({
      data: rows.map(({ suffix: rowSuffix }) => ({
        slug: `${prefix}-page-${rowSuffix}`,
        title: `${prefix} page ${rowSuffix}`,
        body: "Pagination fixture",
        status: "DRAFT" as const,
      })),
    });
    await db.faq.createMany({
      data: rows.map(({ index, suffix: rowSuffix }) => ({
        slug: `${prefix}-faq-${rowSuffix}`,
        question: `${prefix} faq ${rowSuffix}`,
        answer: "Pagination fixture",
        position: index,
        status: "DRAFT" as const,
      })),
    });
    await db.product.createMany({
      data: rows.map(({ suffix: rowSuffix }) => ({
        slug: `${prefix}-product-${rowSuffix}`,
        title: `${prefix} product ${rowSuffix}`,
        status: "DRAFT" as const,
      })),
    });
    await db.category.createMany({
      data: rows.map(({ index, suffix: rowSuffix }) => ({
        slug: `${prefix}-category-${rowSuffix}`,
        name: `${prefix} category ${rowSuffix}`,
        position: index,
        status: "DRAFT" as const,
      })),
    });
    await db.redirect.createMany({
      data: rows.map(({ suffix: rowSuffix }) => ({
        sourcePath: `/${prefix}/old/${rowSuffix}`,
        destinationPath: `/${prefix}/new/${rowSuffix}`,
        statusCode: 301,
      })),
    });
    await db.inquiry.createMany({
      data: rows.map(({ suffix: rowSuffix }) => ({
        inquiryNumber: `CMS-${suffix}-${rowSuffix}`,
        source: "WEB" as const,
        status: "OPEN" as const,
        customerEmail: `${prefix}@example.test`,
        subject: `${prefix} inquiry ${rowSuffix}`,
        message: "Pagination fixture",
      })),
    });
    await db.whatsAppContactIntent.createMany({
      data: rows.map(({ suffix: rowSuffix }) => ({
        sourcePath: `/${prefix}/intent/${rowSuffix}`,
        messageTemplateKey: `${prefix}-template`,
      })),
    });
  });

  afterAll(async () => {
    const db = getDb();
    await db.whatsAppContactIntent.deleteMany({
      where: { sourcePath: { startsWith: `/${prefix}/intent/` } },
    });
    await db.inquiry.deleteMany({
      where: { inquiryNumber: { startsWith: `CMS-${suffix}-` } },
    });
    await db.redirect.deleteMany({
      where: { sourcePath: { startsWith: `/${prefix}/old/` } },
    });
    await db.faq.deleteMany({ where: { slug: { startsWith: prefix } } });
    await db.page.deleteMany({ where: { slug: { startsWith: prefix } } });
    await db.blogPost.deleteMany({ where: { slug: { startsWith: prefix } } });
    await db.product.deleteMany({ where: { slug: { startsWith: prefix } } });
    await db.category.deleteMany({ where: { slug: { startsWith: prefix } } });
  });

  it("discovers later inquiry and WhatsApp intent pages", async () => {
    const result = await getAdminCommunicationsIndex({
      inquiryQ: prefix,
      inquiryPage: "2",
      intentQ: prefix,
      intentPage: "2",
    });

    expect(result.inquiryPagination).toEqual({
      page: 2,
      pageSize: 30,
      pageCount: 2,
      total: 31,
    });
    expect(result.inquiries).toHaveLength(1);
    expect(result.intentPagination).toEqual({
      page: 2,
      pageSize: 30,
      pageCount: 2,
      total: 31,
    });
    expect(result.intents).toHaveLength(1);
  });

  it("discovers later pages for every content collection", async () => {
    const result = await getAdminContentIndex({
      blogQ: prefix,
      blogPage: "2",
      pageQ: prefix,
      pagePage: "2",
      faqQ: prefix,
      faqPage: "2",
    });

    expect(result.postPagination).toMatchObject({ page: 2, total: 31 });
    expect(result.posts).toHaveLength(6);
    expect(result.pagePagination).toMatchObject({ page: 2, total: 31 });
    expect(result.pages).toHaveLength(6);
    expect(result.faqPagination).toMatchObject({ page: 2, total: 31 });
    expect(result.faqs).toHaveLength(6);
  });

  it("discovers later pages for all five SEO index types", async () => {
    for (const entity of [
      "product",
      "category",
      "blog",
      "page",
      "redirect",
    ] as const) {
      const result = await getAdminSeoIndex({ entity, q: prefix, page: "2" });
      expect(result.pagination).toEqual({
        page: 2,
        pageSize: 30,
        pageCount: 2,
        total: 31,
      });
      expect(result.records, entity).toHaveLength(1);
    }
  });
});
