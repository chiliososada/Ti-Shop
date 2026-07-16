import { describe, expect, it } from "vitest";

import {
  blogCreateFormSchema,
  blogFormSchema,
  faqCreateFormSchema,
  managedPageFormSchema,
  pageCreateFormSchema,
} from "@/server/admin/content/validators";

describe("content admin validators", () => {
  it("accepts an explicit UTC publication time", () => {
    const result = blogFormSchema.safeParse({
      publicId: "00000000-0000-4000-8000-000000000001",
      title: "Article",
      category: "Research",
      authorDisplayName: "Research Team",
      readingMinutes: "7",
      excerpt: "Summary",
      body: "# Article",
      format: "MARKDOWN",
      status: "PUBLISHED",
      publishedAt: "2026-07-13T12:00:00Z",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.publishedAt?.toISOString()).toBe(
        "2026-07-13T12:00:00.000Z",
      );
    }
  });

  it("rejects timezone-free publication times", () => {
    const result = blogFormSchema.safeParse({
      publicId: "00000000-0000-4000-8000-000000000001",
      title: "Article",
      category: "",
      authorDisplayName: "",
      readingMinutes: "",
      excerpt: "",
      body: "Article body",
      format: "MARKDOWN",
      status: "PUBLISHED",
      publishedAt: "2026-07-13T12:00:00",
    });
    expect(result.success).toBe(false);
  });

  it("strictly validates a new article slug and draft content", () => {
    const base = {
      slug: "new-research-article",
      title: "New research article",
      category: "Research",
      authorDisplayName: "Research Team",
      readingMinutes: "5",
      excerpt: "Summary",
      body: "# Reviewed article",
      format: "MARKDOWN",
      status: "DRAFT",
      publishedAt: "",
    };

    expect(blogCreateFormSchema.safeParse(base).success).toBe(true);
    expect(
      blogCreateFormSchema.safeParse({ ...base, slug: "Unsafe Slug" }).success,
    ).toBe(false);
    expect(
      blogCreateFormSchema.safeParse({ ...base, unexpected: "field" }).success,
    ).toBe(false);
  });

  it("strictly validates page slugs and publication state", () => {
    const base = {
      slug: "procurement-guide",
      title: "Procurement guide",
      body: "Reviewed body",
      format: "MARKDOWN",
      status: "PUBLISHED",
      publishedAt: "2026-07-13T12:00:00Z",
    };
    expect(pageCreateFormSchema.safeParse(base).success).toBe(true);
    expect(
      pageCreateFormSchema.safeParse({ ...base, slug: "Unsafe Slug" }).success,
    ).toBe(false);
    expect(
      pageCreateFormSchema.safeParse({ ...base, publishedAt: "" }).success,
    ).toBe(false);
    expect(
      pageCreateFormSchema.safeParse({ ...base, unexpected: "field" }).success,
    ).toBe(false);
    expect(
      pageCreateFormSchema.safeParse({
        ...base,
        slug: "managed-route-shipping",
      }).success,
    ).toBe(false);
  });

  it("accepts safe managed-page blocks and requires a publish time", () => {
    const base = {
      routeKey: "SHIPPING",
      title: "Shipping policy",
      body: "## Destinations\n\nSupported United States destinations are reviewed per order.",
      status: "PUBLISHED",
      publishedAt: "2026-07-13T12:00:00Z",
    };
    expect(managedPageFormSchema.safeParse(base).success).toBe(true);
    expect(
      managedPageFormSchema.safeParse({ ...base, publishedAt: "" }).success,
    ).toBe(false);
    expect(
      managedPageFormSchema.safeParse({ ...base, routeKey: "CONTACT" }).success,
    ).toBe(false);
  });

  it.each([
    "<script>alert(1)</script>",
    "Wire account number: 1234567890",
    "NOWPayments IPN secret: abcdefghijklmnop",
    "Contact private.person@example.com",
  ])("rejects sensitive or executable managed-page content", (body) => {
    expect(
      managedPageFormSchema.safeParse({
        routeKey: "PAYMENT_POLICY",
        title: "Payment policy",
        body,
        status: "DRAFT",
        publishedAt: "",
      }).success,
    ).toBe(false);
  });

  it("accepts an ordered draft FAQ and rejects negative positions", () => {
    const base = {
      slug: "payment-methods",
      question: "Which payment methods are enabled?",
      answer: "Use only the method shown for the order.",
      category: "Ordering",
      position: "2",
      status: "DRAFT",
      publishedAt: "",
    };
    expect(faqCreateFormSchema.safeParse(base).success).toBe(true);
    expect(
      faqCreateFormSchema.safeParse({ ...base, position: "-1" }).success,
    ).toBe(false);
  });
});
