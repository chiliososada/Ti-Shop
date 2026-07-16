import "server-only";

import { CORE_MERCHANDISING_PLACEMENT_KEYS } from "@/domain/merchandising";
import { merchandisingPlacementKeySchema } from "@/server/admin/catalog/organization-validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

const ADMIN_TAG_LIMIT = 200;
const ADMIN_PRODUCT_OPTION_LIMIT = 500;
const ADMIN_PLACEMENT_KEY_LIMIT = 100;
const ADMIN_PLACEMENT_LIMIT = 1_000;

export async function getAdminCatalogOrganization() {
  await requirePermission("catalog.read", "/admin/catalog/organization");
  const db = getDb();

  const [tagTotal, tags, productTotal, products, placementKeyRows] =
    await Promise.all([
      db.tag.count({ where: { deletedAt: null } }),
      db.tag.findMany({
        where: { deletedAt: null },
        orderBy: [{ slug: "asc" }, { id: "asc" }],
        take: ADMIN_TAG_LIMIT,
        select: {
          publicId: true,
          slug: true,
          name: true,
          status: true,
          updatedAt: true,
          _count: { select: { products: true } },
        },
      }),
      db.product.count({ where: { deletedAt: null } }),
      db.product.findMany({
        where: { deletedAt: null },
        orderBy: [{ title: "asc" }, { id: "asc" }],
        take: ADMIN_PRODUCT_OPTION_LIMIT,
        select: {
          publicId: true,
          slug: true,
          title: true,
          status: true,
        },
      }),
      db.merchandisingPlacement.findMany({
        distinct: ["key"],
        orderBy: [{ key: "asc" }, { id: "asc" }],
        take: ADMIN_PLACEMENT_KEY_LIMIT + 1,
        select: { key: true },
      }),
    ]);

  const databaseKeys = placementKeyRows.flatMap(({ key }) =>
    merchandisingPlacementKeySchema.safeParse(key).success ? [key] : [],
  );
  const coreKeys = new Set<string>(CORE_MERCHANDISING_PLACEMENT_KEYS);
  const candidatePlacementKeys = [
    ...CORE_MERCHANDISING_PLACEMENT_KEYS,
    ...databaseKeys.filter((key) => !coreKeys.has(key)).sort(),
  ];
  const placementKeys = candidatePlacementKeys.slice(
    0,
    ADMIN_PLACEMENT_KEY_LIMIT,
  );

  const placementRows = placementKeys.length
    ? await db.merchandisingPlacement.findMany({
        where: { key: { in: placementKeys } },
        orderBy: [{ key: "asc" }, { position: "asc" }, { id: "asc" }],
        take: ADMIN_PLACEMENT_LIMIT + 1,
        select: {
          publicId: true,
          key: true,
          position: true,
          isActive: true,
          updatedAt: true,
          metadata: true,
          product: {
            select: {
              publicId: true,
              slug: true,
              title: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      })
    : [];

  const visiblePlacementRows = placementRows.slice(0, ADMIN_PLACEMENT_LIMIT);
  return {
    tags: tags.map((tag) => ({
      publicId: tag.publicId,
      slug: tag.slug,
      name: tag.name,
      status: tag.status,
      productCount: tag._count.products,
      updatedAt: tag.updatedAt.toISOString(),
    })),
    tagTotal,
    tagsTruncated: tagTotal > tags.length,
    products,
    productTotal,
    productsTruncated: productTotal > products.length,
    placementKeysTruncated:
      placementKeyRows.length > ADMIN_PLACEMENT_KEY_LIMIT ||
      candidatePlacementKeys.length > placementKeys.length,
    placementsTruncated: placementRows.length > visiblePlacementRows.length,
    placementGroups: placementKeys.map((key) => ({
      key,
      placements: visiblePlacementRows
        .filter((placement) => placement.key === key)
        .map((placement) => ({
          publicId: placement.publicId,
          position: placement.position,
          isActive: placement.isActive,
          updatedAt: placement.updatedAt.toISOString(),
          isLegacyManaged: placement.metadata !== null,
          product: {
            publicId: placement.product.publicId,
            slug: placement.product.slug,
            title: placement.product.title,
            status: placement.product.status,
            deleted: placement.product.deletedAt !== null,
          },
        })),
    })),
  };
}
