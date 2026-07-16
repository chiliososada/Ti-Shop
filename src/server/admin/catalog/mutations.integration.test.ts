import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["catalog.read", "catalog.manage"]),
  })),
}));

import {
  createAdminCategory,
  createAdminProduct,
  createAdminProductMedia,
  createAdminVariant,
  updateAdminProduct,
  updateAdminProductCategories,
  updateAdminVariant,
} from "@/server/admin/catalog/mutations";
import {
  categoryAssignmentFormSchema,
  createCategoryFormSchema,
  createProductFormSchema,
  createProductMediaFormSchema,
  createVariantFormSchema,
  productFormSchema,
  variantFormSchema,
} from "@/server/admin/catalog/validators";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("catalog admin database invariants", () => {
  const suffix = randomUUID();
  const slugSuffix = suffix.slice(0, 8);
  const productSlug = `catalog-it-${slugSuffix}`;
  const categorySlug = `catalog-it-category-${slugSuffix}`;
  const sku = `CATALOG-IT-${slugSuffix.toUpperCase()}`;
  const sourceUrl = `https://cdn.example.com/catalog-it-${suffix}.jpg`;
  let actorUserId = "";
  let productPublicId = "";
  let categoryPublicId = "";
  let variantPublicId = "";
  let mediaPublicId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const actor = await getDb().user.create({
      data: {
        name: "Catalog integration admin",
        email: `catalog-admin-${suffix}@example.invalid`,
      },
      select: { id: true },
    });
    actorUserId = actor.id;
    authorization.actorUserId = actor.id;
  });

  afterAll(async () => {
    if (!actorUserId) return;
    const db = getDb();
    await db.auditLog.deleteMany({ where: { actorUserId } });
    await db.outboxEvent.deleteMany({
      where: {
        eventType: { startsWith: "catalog." },
        aggregateId: {
          in: [productPublicId, categoryPublicId, variantPublicId].filter(Boolean),
        },
      },
    });
    if (productPublicId) {
      const product = await db.product.findUnique({
        where: { publicId: productPublicId },
        select: { id: true, variants: { select: { id: true } } },
      });
      if (product) {
        const variantIds = product.variants.map(({ id }) => id);
        await db.price.deleteMany({ where: { variantId: { in: variantIds } } });
        await db.productMedia.deleteMany({ where: { productId: product.id } });
        await db.productCategory.deleteMany({ where: { productId: product.id } });
        await db.productVariant.deleteMany({ where: { productId: product.id } });
        await db.product.delete({ where: { id: product.id } });
      }
    }
    if (categoryPublicId) {
      await db.category.deleteMany({ where: { publicId: categoryPublicId } });
    }
    if (mediaPublicId) {
      await db.media.deleteMany({ where: { publicId: mediaPublicId } });
    }
    await db.user.deleteMany({ where: { id: actorUserId } });
  });

  it("creates, relates, prices, audits, emits, and archives without replacing identities", async () => {
    const product = await createAdminProduct(
      createProductFormSchema.parse({
        slug: productSlug,
        title: "Catalog integration product",
        position: "0",
      }),
    );
    expect(product.ok).toBe(true);
    if (!product.ok) return;
    productPublicId = product.publicId;

    const duplicateSlug = await createAdminProduct(
      createProductFormSchema.parse({
        slug: productSlug,
        title: "Duplicate",
        position: "0",
      }),
    );
    expect(duplicateSlug).toEqual({ ok: false, reason: "slug_conflict" });

    const category = await createAdminCategory(
      createCategoryFormSchema.parse({
        slug: categorySlug,
        name: "Catalog integration category",
        position: "0",
      }),
    );
    expect(category.ok).toBe(true);
    if (!category.ok) return;
    categoryPublicId = category.publicId;

    const variant = await createAdminVariant(
      createVariantFormSchema.parse({
        productPublicId,
        title: "Integration variant",
        sku,
        status: "DRAFT",
        priceMode: "ON_REQUEST",
        usdPrice: "",
        minimumOrderQuantity: "5",
        position: "0",
        publishedAt: "",
        trackInventory: "on",
        optionValues: '{"size":"integration"}',
      }),
    );
    expect(variant.ok).toBe(true);
    if (!variant.ok) return;
    variantPublicId = variant.variantPublicId;

    const publishedAt = "2026-07-13T12:00:00Z";
    const updatedVariant = await updateAdminVariant(
      variantFormSchema.parse({
        productPublicId,
        variantPublicId,
        title: "Integration variant 5 pack",
        sku,
        status: "ACTIVE",
        priceMode: "FIXED",
        usdPrice: "123.45",
        minimumOrderQuantity: "5",
        position: "2",
        publishedAt,
        trackInventory: "on",
        optionValues: '{"size":"integration"}',
      }),
    );
    expect(updatedVariant.ok).toBe(true);

    const assigned = await updateAdminProductCategories(
      categoryAssignmentFormSchema.parse({
        productPublicId,
        primaryCategoryPublicId: categoryPublicId,
        categoryPublicIds: [categoryPublicId],
      }),
    );
    expect(assigned.ok).toBe(true);

    const attached = await createAdminProductMedia(
      createProductMediaFormSchema.parse({
        productPublicId,
        existingMediaPublicId: "",
        sourceUrl,
        kind: "IMAGE",
        variantPublicId: "",
        role: "PRIMARY",
        altText: "Integration image",
        position: "0",
      }),
    );
    expect(attached.ok).toBe(true);
    if (attached.ok) mediaPublicId = attached.mediaPublicId;

    const activeProductInput = {
      publicId: productPublicId,
      title: "Catalog integration product",
      subtitle: "Operational test",
      shortDescription: "Integration only",
      description: "Integration only",
      brand: "",
      purity: "",
      casNumber: "",
      appearance: "",
      storageInstructions: "",
      status: "ACTIVE",
      publishedAt,
      isFeatured: "on",
      position: "1",
    } as const;
    const activated = await updateAdminProduct(
      productFormSchema.parse(activeProductInput),
    );
    expect(activated.ok).toBe(true);
    const archived = await updateAdminProduct(
      productFormSchema.parse({ ...activeProductInput, status: "ARCHIVED" }),
    );
    expect(archived.ok).toBe(true);

    const db = getDb();
    const [stored, auditCount, outboxCount] = await Promise.all([
      db.product.findUniqueOrThrow({
        where: { publicId: productPublicId },
        select: {
          publicId: true,
          slug: true,
          status: true,
          deletedAt: true,
          categories: { select: { position: true, category: { select: { publicId: true } } } },
          media: { select: { role: true, media: { select: { publicId: true } } } },
          variants: {
            select: {
              publicId: true,
              title: true,
              sku: true,
              status: true,
              optionValues: true,
              position: true,
              prices: { where: { isActive: true }, select: { amountMinor: true, currency: true } },
            },
          },
        },
      }),
      db.auditLog.count({ where: { actorUserId } }),
      db.outboxEvent.count({
        where: {
          eventType: { startsWith: "catalog." },
          aggregateId: { in: [productPublicId, categoryPublicId, variantPublicId] },
        },
      }),
    ]);
    expect(stored).toMatchObject({
      publicId: productPublicId,
      slug: productSlug,
      status: "ARCHIVED",
      deletedAt: null,
      categories: [{ position: 0, category: { publicId: categoryPublicId } }],
      media: [{ role: "PRIMARY", media: { publicId: mediaPublicId } }],
      variants: [
        {
          publicId: variantPublicId,
          title: "Integration variant 5 pack",
          sku,
          status: "ACTIVE",
          position: 2,
          optionValues: { size: "integration", minimumOrderQuantity: 5 },
          prices: [{ amountMinor: BigInt(12_345), currency: "USD" }],
        },
      ],
    });
    expect(auditCount).toBe(8);
    expect(outboxCount).toBe(8);
  });
});
