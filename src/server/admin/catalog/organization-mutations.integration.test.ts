import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["catalog-organization-integration"],
    permissions: new Set(["catalog.read", "catalog.manage"]),
  })),
}));

import {
  archiveOrDeleteAdminTag,
  createAdminPlacement,
  createAdminTag,
  deleteAdminPlacement,
  updateAdminPlacement,
  updateAdminProductTags,
  updateAdminTag,
} from "@/server/admin/catalog/organization-mutations";
import {
  placementCreateFormSchema,
  placementDeleteFormSchema,
  placementUpdateFormSchema,
  productTagAssignmentFormSchema,
  tagArchiveOrDeleteFormSchema,
  tagCreateFormSchema,
  tagUpdateFormSchema,
} from "@/server/admin/catalog/organization-validators";
import { getPublicHomePlacements, getPublicProductBySlug } from "@/server/catalog/public-catalog";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("catalog tags and merchandising administration", () => {
  const suffix = randomUUID().slice(0, 8);
  const roleSlug = `catalog-org-it-${suffix}`;
  const categorySlug = `catalog-org-category-${suffix}`;
  const placementKey = `catalog-org-placement-${suffix}`;
  const productSlugs = [
    `catalog-org-product-a-${suffix}`,
    `catalog-org-product-b-${suffix}`,
    `catalog-org-anchor-${suffix}`,
  ];
  const tagSlugs = [`catalog-org-tag-a-${suffix}`, `catalog-org-tag-b-${suffix}`];
  const tagSubmissionIds = [randomUUID(), randomUUID()];
  const placementSubmissionIds = [randomUUID(), randomUUID()];
  let actorUserId = "";
  let deniedUserId = "";
  let roleId = BigInt(0);
  let categoryId = BigInt(0);
  const productIds: bigint[] = [];
  const productPublicIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const permission = await db.permission.upsert({
      where: { slug: "catalog.manage" },
      update: {},
      create: {
        slug: "catalog.manage",
        name: "Manage catalog",
        description: "Integration fixture permission",
      },
      select: { id: true },
    });
    const role = await db.role.create({
      data: {
        slug: roleSlug,
        name: `Catalog organization integration ${suffix}`,
        isSystem: false,
        permissions: { create: { permissionId: permission.id } },
      },
      select: { id: true },
    });
    roleId = role.id;
    const actor = await db.user.create({
      data: {
        name: "Catalog organization integration administrator",
        email: `catalog-org-admin-${suffix}@example.invalid`,
        emailVerified: true,
        adminProfile: { create: { isActive: true } },
        roleAssignments: { create: { roleId: role.id } },
      },
      select: { id: true },
    });
    const denied = await db.user.create({
      data: {
        name: "Catalog organization denied administrator",
        email: `catalog-org-denied-${suffix}@example.invalid`,
        emailVerified: true,
        adminProfile: { create: { isActive: true } },
      },
      select: { id: true },
    });
    actorUserId = actor.id;
    deniedUserId = denied.id;
    authorization.actorUserId = actor.id;

    const publishedAt = new Date(Date.now() - 60_000);
    const category = await db.category.create({
      data: {
        slug: categorySlug,
        name: `Catalog organization category ${suffix}`,
        status: "ACTIVE",
        publishedAt,
      },
      select: { id: true },
    });
    categoryId = category.id;

    for (const [index, slug] of productSlugs.entries()) {
      const active = index < 2;
      const product = await db.product.create({
        data: {
          slug,
          title: `Catalog organization product ${index + 1}`,
          status: active ? "ACTIVE" : "DRAFT",
          publishedAt: active ? publishedAt : null,
          categories: active
            ? { create: { categoryId: category.id, position: 0 } }
            : undefined,
          variants: active
            ? {
                create: {
                  title: "Default",
                  status: "ACTIVE",
                  priceMode: "FIXED",
                  publishedAt,
                  trackInventory: false,
                  optionValues: { minimumOrderQuantity: 1 },
                  prices: {
                    create: {
                      currency: "USD",
                      countryCode: "US",
                      amountMinor: BigInt(2_500 + index * 100),
                      isActive: true,
                    },
                  },
                },
              }
            : undefined,
        },
        select: { id: true, publicId: true },
      });
      productIds.push(product.id);
      productPublicIds.push(product.publicId);
    }

    await db.merchandisingPlacement.create({
      data: {
        key: placementKey,
        productId: productIds[2],
        position: 900_000,
        isActive: false,
        metadata: { fixture: true },
      },
    });
  });

  afterAll(async () => {
    authorization.actorUserId = actorUserId;
    const db = getDb();
    await db.outboxEvent.deleteMany({
      where: {
        OR: [
          { aggregateId: { in: tagSubmissionIds } },
          { aggregateId: { in: placementSubmissionIds } },
          { aggregateId: { in: productPublicIds } },
        ],
      },
    });
    await db.auditLog.deleteMany({
      where: { actorUserId: { in: [actorUserId, deniedUserId] } },
    });
    await db.merchandisingPlacement.deleteMany({ where: { key: placementKey } });
    await db.productTag.deleteMany({ where: { productId: { in: productIds } } });
    await db.tag.deleteMany({ where: { slug: { in: tagSlugs } } });
    const variants = await db.productVariant.findMany({
      where: { productId: { in: productIds } },
      select: { id: true },
    });
    await db.price.deleteMany({
      where: { variantId: { in: variants.map(({ id }) => id) } },
    });
    await db.productVariant.deleteMany({ where: { productId: { in: productIds } } });
    await db.productCategory.deleteMany({ where: { productId: { in: productIds } } });
    await db.product.deleteMany({ where: { id: { in: productIds } } });
    if (categoryId !== BigInt(0)) {
      await db.category.deleteMany({ where: { id: categoryId } });
    }
    if (roleId !== BigInt(0)) await db.role.deleteMany({ where: { id: roleId } });
    await db.user.deleteMany({ where: { id: { in: [actorUserId, deniedUserId] } } });
  });

  it("creates tags idempotently, assigns them, and archives an associated tag", async () => {
    const tagInput = tagCreateFormSchema.parse({
      submissionId: tagSubmissionIds[0],
      slug: tagSlugs[0],
      name: "Integration active tag",
      status: "ACTIVE",
    });
    const created = await Promise.all([
      createAdminTag(tagInput),
      createAdminTag(tagInput),
    ]);
    expect(created.every((result) => result.ok)).toBe(true);
    expect(
      created.filter((result) => result.ok && !result.duplicate),
    ).toHaveLength(1);

    const unchanged = await updateAdminTag(
      tagUpdateFormSchema.parse({
        publicId: tagSubmissionIds[0],
        slug: tagSlugs[0],
        name: "Integration active tag",
        status: "ACTIVE",
      }),
    );
    expect(unchanged).toMatchObject({ ok: true, duplicate: true });

    const assignment = productTagAssignmentFormSchema.parse({
      productPublicId: productPublicIds[0],
      tagPublicIds: [tagSubmissionIds[0]],
    });
    expect(await updateAdminProductTags(assignment)).toMatchObject({
      ok: true,
      duplicate: false,
    });
    expect(await updateAdminProductTags(assignment)).toMatchObject({
      ok: true,
      duplicate: true,
    });

    const archiveInput = tagArchiveOrDeleteFormSchema.parse({
      publicId: tagSubmissionIds[0],
    });
    expect(await archiveOrDeleteAdminTag(archiveInput)).toMatchObject({
      ok: true,
      duplicate: false,
      mode: "archived",
    });
    expect(await archiveOrDeleteAdminTag(archiveInput)).toMatchObject({
      ok: true,
      duplicate: true,
      mode: "archived",
    });
    expect(
      await getDb().tag.findUnique({
        where: { publicId: tagSubmissionIds[0] },
        select: { status: true, _count: { select: { products: true } } },
      }),
    ).toEqual({ status: "ARCHIVED", _count: { products: 1 } });
    expect((await getPublicProductBySlug(productSlugs[0]))?.tags).toEqual([]);
  });

  it("hard-deletes only an unused tag", async () => {
    const created = await createAdminTag(
      tagCreateFormSchema.parse({
        submissionId: tagSubmissionIds[1],
        slug: tagSlugs[1],
        name: "Integration unused tag",
        status: "DRAFT",
      }),
    );
    expect(created).toMatchObject({ ok: true, duplicate: false });
    const deleted = await archiveOrDeleteAdminTag(
      tagArchiveOrDeleteFormSchema.parse({ publicId: tagSubmissionIds[1] }),
    );
    expect(deleted).toMatchObject({
      ok: true,
      duplicate: false,
      mode: "deleted",
    });
    expect(
      await archiveOrDeleteAdminTag(
        tagArchiveOrDeleteFormSchema.parse({ publicId: tagSubmissionIds[1] }),
      ),
    ).toMatchObject({ ok: true, duplicate: true, mode: "deleted" });
    expect(
      await getDb().tag.findUnique({ where: { publicId: tagSubmissionIds[1] } }),
    ).toBeNull();
  });

  it("adds only under an existing key, filters inactive public rows, swaps positions, and removes safely", async () => {
    const legacyAnchor = await getDb().merchandisingPlacement.findFirstOrThrow({
      where: { key: placementKey, position: 900_000 },
      select: { publicId: true },
    });
    expect(
      await updateAdminPlacement(
        placementUpdateFormSchema.parse({
          placementPublicId: legacyAnchor.publicId,
          placementKey,
          position: "899999",
        }),
      ),
    ).toEqual({ ok: false, reason: "legacy_managed" });
    expect(
      await deleteAdminPlacement(
        placementDeleteFormSchema.parse({
          placementPublicId: legacyAnchor.publicId,
          placementKey,
        }),
      ),
    ).toEqual({ ok: false, reason: "legacy_managed" });
    expect(
      await createAdminPlacement(
        placementCreateFormSchema.parse({
          submissionId: randomUUID(),
          placementKey: "legacy-featured-products",
          productPublicId: productPublicIds[0],
          position: "50",
          isActive: "on",
        }),
      ),
    ).toEqual({ ok: false, reason: "legacy_reserved_position" });

    const firstInput = placementCreateFormSchema.parse({
      submissionId: placementSubmissionIds[0],
      placementKey,
      productPublicId: productPublicIds[0],
      position: "900001",
      isActive: "on",
    });
    const firstResults = await Promise.all([
      createAdminPlacement(firstInput),
      createAdminPlacement(firstInput),
    ]);
    expect(firstResults.every((result) => result.ok)).toBe(true);
    expect(
      firstResults.filter((result) => result.ok && !result.duplicate),
    ).toHaveLength(1);
    expect(
      await updateAdminPlacement(
        placementUpdateFormSchema.parse({
          placementPublicId: placementSubmissionIds[0],
          placementKey,
          position: "900000",
          isActive: "on",
        }),
      ),
    ).toEqual({ ok: false, reason: "legacy_position_conflict" });

    expect(
      await createAdminPlacement(
        placementCreateFormSchema.parse({
          submissionId: placementSubmissionIds[1],
          placementKey,
          productPublicId: productPublicIds[1],
          position: "900002",
        }),
      ),
    ).toMatchObject({ ok: true, duplicate: false });

    const publicPlacement = await getPublicHomePlacements([placementKey], 8);
    expect(publicPlacement[placementKey]?.map(({ product }) => product.publicId)).toEqual([
      productPublicIds[0],
    ]);

    const move = placementUpdateFormSchema.parse({
      placementPublicId: placementSubmissionIds[1],
      placementKey,
      position: "900001",
      isActive: "on",
    });
    expect(await updateAdminPlacement(move)).toMatchObject({
      ok: true,
      duplicate: false,
    });
    expect(await updateAdminPlacement(move)).toMatchObject({
      ok: true,
      duplicate: true,
    });
    const positions = await getDb().merchandisingPlacement.findMany({
      where: { publicId: { in: placementSubmissionIds } },
      orderBy: { publicId: "asc" },
      select: { publicId: true, position: true, isActive: true },
    });
    expect(new Set(positions.map(({ position }) => position))).toEqual(
      new Set([900_001, 900_002]),
    );
    expect(positions.every(({ isActive }) => isActive)).toBe(true);

    for (const placementPublicId of placementSubmissionIds) {
      expect(
        await deleteAdminPlacement(
          placementDeleteFormSchema.parse({
            placementPublicId,
            placementKey,
          }),
        ),
      ).toMatchObject({ ok: true, duplicate: false });
      expect(
        await deleteAdminPlacement(
          placementDeleteFormSchema.parse({
            placementPublicId,
            placementKey,
          }),
        ),
      ).toMatchObject({ ok: true, duplicate: true });
    }
    expect(
      await getDb().merchandisingPlacement.count({
        where: { publicId: { in: placementSubmissionIds } },
      }),
    ).toBe(0);
  });

  it("rechecks catalog.manage inside the transaction and emits only for real changes", async () => {
    const eventTypes = [
      "catalog.tag.created",
      "catalog.tag.deleted",
      "catalog.tag.archived",
      "catalog.product.tags.updated",
      "catalog.merchandising_placement.created",
      "catalog.merchandising_placement.updated",
      "catalog.merchandising_placement.deleted",
    ];
    const [auditCount, outboxCount] = await Promise.all([
      getDb().auditLog.count({ where: { actorUserId } }),
      getDb().outboxEvent.count({
        where: {
          eventType: { in: eventTypes },
          aggregateId: {
            in: [
              ...tagSubmissionIds,
              ...placementSubmissionIds,
              ...productPublicIds,
            ],
          },
        },
      }),
    ]);
    expect({ auditCount, outboxCount }).toEqual({
      auditCount: 10,
      outboxCount: 10,
    });

    authorization.actorUserId = deniedUserId;
    try {
      const deniedId = randomUUID();
      expect(
        await createAdminTag(
          tagCreateFormSchema.parse({
            submissionId: deniedId,
            slug: `catalog-org-denied-${suffix}`,
            name: "Must not be created",
            status: "DRAFT",
          }),
        ),
      ).toEqual({ ok: false, reason: "permission_changed" });
      expect(
        await getDb().tag.findUnique({ where: { publicId: deniedId } }),
      ).toBeNull();
    } finally {
      authorization.actorUserId = actorUserId;
    }
  });
});
