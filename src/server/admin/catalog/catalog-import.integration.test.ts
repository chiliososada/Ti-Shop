import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["catalog-import-integration"],
    permissions: new Set(["catalog.manage"]),
  })),
}));

import { parseCatalogImportCsv } from "@/server/admin/catalog/catalog-import";
import { processAdminCatalogImport } from "@/server/admin/catalog/catalog-import-mutations";
import { CATALOG_CSV_COLUMNS, serializeCatalogCsv } from "@/server/admin/catalog/csv";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("catalog CSV import database invariants", () => {
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const roleSlug = `catalog-import-${short}`;
  const productSlug = `catalog-import-product-${short}`;
  const oldCategorySlug = `catalog-import-old-${short}`;
  const newCategorySlug = `catalog-import-new-${short}`;
  const sku = `CSV-${short.toUpperCase()}`;
  let actorUserId = "";
  let secondActorUserId = "";
  let roleId = BigInt(0);
  let productPublicId = "";
  let variantPublicId = "";
  let oldCategoryId = BigInt(0);
  let newCategoryId = BigInt(0);
  let importHash = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.BETTER_AUTH_SECRET ??=
      "catalog-import-integration-only-secret-2026-07-13";
    process.env.SITE_URL ??= "http://localhost:3000";
    const db = getDb();
    const permission = await db.permission.upsert({
      where: { slug: "catalog.manage" },
      update: {},
      create: {
        slug: "catalog.manage",
        name: "Manage catalog",
        description: "Catalog import integration permission",
      },
      select: { id: true },
    });
    const role = await db.role.create({
      data: {
        slug: roleSlug,
        name: `Catalog import ${short}`,
        isSystem: false,
        permissions: { create: { permissionId: permission.id } },
      },
      select: { id: true },
    });
    roleId = role.id;
    const actor = await db.user.create({
      data: {
        name: "Catalog import integration administrator",
        email: `catalog-import-${suffix}@example.invalid`,
        emailVerified: true,
        adminProfile: { create: { isActive: true } },
        roleAssignments: { create: { roleId: role.id } },
      },
      select: { id: true },
    });
    actorUserId = actor.id;
    authorization.actorUserId = actor.id;
    const secondActor = await db.user.create({
      data: {
        name: "Second catalog import integration administrator",
        email: `catalog-import-second-${suffix}@example.invalid`,
        emailVerified: true,
        adminProfile: { create: { isActive: true } },
        roleAssignments: { create: { roleId: role.id } },
      },
      select: { id: true },
    });
    secondActorUserId = secondActor.id;

    const [oldCategory, newCategory] = await Promise.all([
      db.category.create({
        data: { slug: oldCategorySlug, name: "Old import category", status: "ACTIVE", publishedAt: new Date() },
        select: { id: true },
      }),
      db.category.create({
        data: { slug: newCategorySlug, name: "New import category", status: "ACTIVE", publishedAt: new Date() },
        select: { id: true },
      }),
    ]);
    oldCategoryId = oldCategory.id;
    newCategoryId = newCategory.id;
    const product = await db.product.create({
      data: {
        slug: productSlug,
        title: "Before CSV import",
        status: "DRAFT",
        categories: { create: { categoryId: oldCategory.id, position: 0 } },
        variants: {
          create: {
            title: "Before variant import",
            sku,
            status: "DRAFT",
            priceMode: "ON_REQUEST",
            optionValues: { minimumOrderQuantity: 1 },
            trackInventory: true,
            position: 0,
          },
        },
      },
      select: {
        publicId: true,
        variants: { select: { publicId: true } },
      },
    });
    productPublicId = product.publicId;
    variantPublicId = product.variants[0].publicId;
  });

  afterAll(async () => {
    if (!actorUserId) return;
    const db = getDb();
    await db.outboxEvent.deleteMany({ where: { aggregateId: importHash || "never" } });
    await db.auditLog.deleteMany({ where: { actorUserId } });
    const product = await db.product.findUnique({
      where: { publicId: productPublicId },
      select: { id: true, variants: { select: { id: true } } },
    });
    if (product) {
      await db.price.deleteMany({ where: { variantId: { in: product.variants.map(({ id }) => id) } } });
      await db.productCategory.deleteMany({ where: { productId: product.id } });
      await db.productVariant.deleteMany({ where: { productId: product.id } });
      await db.product.delete({ where: { id: product.id } });
    }
    await db.category.deleteMany({ where: { id: { in: [oldCategoryId, newCategoryId] } } });
    await db.user.deleteMany({
      where: { id: { in: [actorUserId, secondActorUserId] } },
    });
    if (roleId !== BigInt(0)) await db.role.deleteMany({ where: { id: roleId } });
  });

  function document(categorySlug = newCategorySlug) {
    const source = serializeCatalogCsv([{
      productPublicId,
      productSlug,
      productTitle: "After CSV import",
      productStatus: "ACTIVE",
      productPublishedAt: "2026-07-13T12:00:00.000Z",
      primaryCategorySlug: categorySlug,
      categorySlugs: categorySlug,
      variantPublicId,
      variantTitle: "After variant import",
      sku,
      variantStatus: "ACTIVE",
      variantPublishedAt: "2026-07-13T12:00:00.000Z",
      priceMode: "FIXED",
      usdPrice: "12.34",
      minimumOrderQuantity: "2",
      trackInventory: "true",
      position: "3",
      optionValues: '{"size":"integration"}',
    }], CATALOG_CSV_COLUMNS);
    const parsed = parseCatalogImportCsv(source);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.issues));
    return {
      parsed: parsed.document,
      hash: createHash("sha256").update(source).digest("hex"),
    };
  }

  it("previews without writes, applies atomically, and rejects token replay", async () => {
    const fixture = document();
    importHash = fixture.hash;
    const preview = await processAdminCatalogImport(fixture.parsed, {
      mode: "preview",
      sha256: fixture.hash,
    });
    expect(preview).toMatchObject({
      ok: true,
      summary: {
        applied: false,
        productChangeCount: 1,
        variantChangeCount: 1,
        categoryAssignmentChangeCount: 1,
        priceChangeCount: 1,
        totalChangeCount: 4,
      },
    });
    expect(await getDb().product.findUniqueOrThrow({
      where: { publicId: productPublicId },
      select: { title: true },
    })).toEqual({ title: "Before CSV import" });
    if (!preview.ok || !preview.previewToken) {
      throw new Error("Preview did not return an approval token.");
    }
    expect(preview.previewToken).not.toContain(actorUserId);
    expect(preview.previewToken).not.toContain(fixture.hash);
    expect(preview.previewToken.split(".")).toHaveLength(4);

    const applied = await processAdminCatalogImport(fixture.parsed, {
      mode: "apply",
      sha256: fixture.hash,
      previewToken: preview.previewToken,
    });
    expect(applied).toMatchObject({ ok: true, summary: { applied: true } });

    const replay = await processAdminCatalogImport(fixture.parsed, {
      mode: "apply",
      sha256: fixture.hash,
      previewToken: preview.previewToken,
    });
    expect(replay).toMatchObject({
      ok: false,
      reason: "stale_preview",
    });

    const db = getDb();
    const stored = await db.product.findUniqueOrThrow({
      where: { publicId: productPublicId },
      select: {
        title: true,
        status: true,
        publishedAt: true,
        categories: { select: { categoryId: true, position: true } },
        variants: {
          select: {
            title: true,
            status: true,
            priceMode: true,
            optionValues: true,
            position: true,
            prices: { where: { isActive: true }, select: { amountMinor: true, currency: true, countryCode: true } },
          },
        },
      },
    });
    expect(stored).toMatchObject({
      title: "After CSV import",
      status: "ACTIVE",
      categories: [{ categoryId: newCategoryId, position: 0 }],
      variants: [{
        title: "After variant import",
        status: "ACTIVE",
        priceMode: "FIXED",
        optionValues: { size: "integration", minimumOrderQuantity: 2 },
        position: 3,
        prices: [{ amountMinor: BigInt(1_234), currency: "USD", countryCode: "US" }],
      }],
    });
    expect(stored.publishedAt?.toISOString()).toBe("2026-07-13T12:00:00.000Z");

    const [audits, outbox] = await Promise.all([
      db.auditLog.findMany({
        where: { actorUserId, action: "catalog.import.apply", resourceId: fixture.hash },
        select: { before: true, after: true },
      }),
      db.outboxEvent.findMany({
        where: { aggregateType: "catalog_import", aggregateId: fixture.hash },
        select: { payload: true },
      }),
    ]);
    expect(audits).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(audits[0].before).toEqual({
      sha256: fixture.hash,
      rowCount: 1,
      productCount: 1,
      variantCount: 1,
    });
    expect(audits[0].after).toEqual({
      sha256: fixture.hash,
      rowCount: 1,
      productCount: 1,
      variantCount: 1,
      productChangeCount: 1,
      variantChangeCount: 1,
      categoryAssignmentChangeCount: 1,
      priceChangeCount: 1,
      totalChangeCount: 4,
    });
    expect(outbox[0].payload).toEqual(audits[0].after);
  });

  it("binds approval to the previewing actor and exact file hash", async () => {
    const fixture = document();
    const preview = await processAdminCatalogImport(fixture.parsed, {
      mode: "preview",
      sha256: fixture.hash,
    });
    if (!preview.ok || !preview.previewToken) {
      throw new Error("Preview did not return an approval token.");
    }

    authorization.actorUserId = secondActorUserId;
    try {
      await expect(
        processAdminCatalogImport(fixture.parsed, {
          mode: "apply",
          sha256: fixture.hash,
          previewToken: preview.previewToken,
        }),
      ).resolves.toMatchObject({ ok: false, reason: "stale_preview" });
    } finally {
      authorization.actorUserId = actorUserId;
    }

    await expect(
      processAdminCatalogImport(fixture.parsed, {
        mode: "apply",
        sha256: "0".repeat(64),
        previewToken: preview.previewToken,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "stale_preview" });
  });

  it("rejects every covered database revision changed by a concurrent editor", async () => {
    const db = getDb();
    const product = await db.product.findUniqueOrThrow({
      where: { publicId: productPublicId },
      select: {
        id: true,
        variants: {
          where: { publicId: variantPublicId },
          select: { id: true },
        },
      },
    });
    const variantId = product.variants[0].id;
    const price = await db.price.findFirstOrThrow({
      where: {
        variantId,
        currency: "USD",
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    const beforeCounts = await Promise.all([
      db.auditLog.count({
        where: { actorUserId, action: "catalog.import.apply" },
      }),
      db.outboxEvent.count({
        where: { aggregateType: "catalog_import", aggregateId: importHash },
      }),
    ]);

    const cases = [
      {
        mutate: () => db.product.update({
          where: { id: product.id },
          data: { title: "Concurrent product edit" },
        }),
        assertPreserved: async () => {
          expect(await db.product.findUniqueOrThrow({
            where: { id: product.id },
            select: { title: true },
          })).toEqual({ title: "Concurrent product edit" });
        },
        restore: () => db.product.update({
          where: { id: product.id },
          data: { title: "After CSV import" },
        }),
      },
      {
        mutate: () => db.productVariant.update({
          where: { id: variantId },
          data: { title: "Concurrent variant edit" },
        }),
        assertPreserved: async () => {
          expect(await db.productVariant.findUniqueOrThrow({
            where: { id: variantId },
            select: { title: true },
          })).toEqual({ title: "Concurrent variant edit" });
        },
        restore: () => db.productVariant.update({
          where: { id: variantId },
          data: { title: "After variant import" },
        }),
      },
      {
        mutate: () => db.price.update({
          where: { id: price.id },
          data: { amountMinor: BigInt(1_300) },
        }),
        assertPreserved: async () => {
          expect(await db.price.findUniqueOrThrow({
            where: { id: price.id },
            select: { amountMinor: true },
          })).toEqual({ amountMinor: BigInt(1_300) });
        },
        restore: () => db.price.update({
          where: { id: price.id },
          data: { amountMinor: BigInt(1_234) },
        }),
      },
      {
        mutate: () => db.productCategory.update({
          where: {
            productId_categoryId: {
              productId: product.id,
              categoryId: newCategoryId,
            },
          },
          data: { position: 7 },
        }),
        assertPreserved: async () => {
          expect(await db.productCategory.findUniqueOrThrow({
            where: {
              productId_categoryId: {
                productId: product.id,
                categoryId: newCategoryId,
              },
            },
            select: { position: true },
          })).toEqual({ position: 7 });
        },
        restore: () => db.productCategory.update({
          where: {
            productId_categoryId: {
              productId: product.id,
              categoryId: newCategoryId,
            },
          },
          data: { position: 0 },
        }),
      },
      {
        mutate: () => db.category.update({
          where: { id: newCategoryId },
          data: { name: "Concurrent category edit" },
        }),
        assertPreserved: async () => {
          expect(await db.category.findUniqueOrThrow({
            where: { id: newCategoryId },
            select: { name: true },
          })).toEqual({ name: "Concurrent category edit" });
        },
        restore: () => db.category.update({
          where: { id: newCategoryId },
          data: { name: "New import category" },
        }),
      },
    ];

    for (const scenario of cases) {
      const fixture = document();
      const preview = await processAdminCatalogImport(fixture.parsed, {
        mode: "preview",
        sha256: fixture.hash,
      });
      if (!preview.ok || !preview.previewToken) {
        throw new Error("Preview did not return an approval token.");
      }

      await scenario.mutate();
      const stale = await processAdminCatalogImport(fixture.parsed, {
        mode: "apply",
        sha256: fixture.hash,
        previewToken: preview.previewToken,
      });
      expect(stale).toMatchObject({ ok: false, reason: "stale_preview" });
      await scenario.assertPreserved();
      await scenario.restore();
    }

    expect(await Promise.all([
      db.auditLog.count({
        where: { actorUserId, action: "catalog.import.apply" },
      }),
      db.outboxEvent.count({
        where: { aggregateType: "catalog_import", aggregateId: importHash },
      }),
    ])).toEqual(beforeCounts);
  });

  it("rejects an unknown category during preview before any product or variant write", async () => {
    const before = await getDb().product.findUniqueOrThrow({
      where: { publicId: productPublicId },
      select: { title: true, updatedAt: true },
    });
    const fixture = document(`missing-${short}`);
    const result = await processAdminCatalogImport(fixture.parsed, {
      mode: "preview",
      sha256: fixture.hash,
    });
    expect(result).toMatchObject({ ok: false, reason: "unknown_category" });
    expect(await getDb().product.findUniqueOrThrow({
      where: { publicId: productPublicId },
      select: { title: true, updatedAt: true },
    })).toEqual(before);
  });

  it("rechecks active catalog permission inside the transaction", async () => {
    await getDb().userRole.delete({
      where: { userId_roleId: { userId: actorUserId, roleId } },
    });
    const fixture = document();
    const result = await processAdminCatalogImport(fixture.parsed, {
      mode: "preview",
      sha256: fixture.hash,
    });
    expect(result).toMatchObject({ ok: false, reason: "permission_changed" });
  });
});
