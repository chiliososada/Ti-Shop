import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  buildPagination,
  normalizePageSearchParameter,
  normalizeSearchText,
  type SearchParameter,
} from "@/lib/pagination";
import { publicIdSchema } from "@/server/admin/audit/validation";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

const INVENTORY_LEVEL_PAGE_SIZE = 50;

export type AdminInventoryIndexFilters = {
  q: string;
  page: number;
};

export function normalizeAdminInventoryIndexFilters(
  searchParams: Record<string, SearchParameter>,
): AdminInventoryIndexFilters {
  return {
    q: normalizeSearchText(searchParams.q),
    page: normalizePageSearchParameter(searchParams.page),
  };
}

export async function getAdminInventoryIndex(
  searchParams: Record<string, SearchParameter> = {},
) {
  const authorization = await requirePermission(
    "inventory.read",
    "/admin/inventory",
  );
  const filters = normalizeAdminInventoryIndexFilters(searchParams);
  const db = getDb();
  const levelWhere: Prisma.InventoryLevelWhereInput = {
    location: { countryCode: "US" },
    ...(filters.q
      ? {
          OR: [
            {
              location: {
                code: { contains: filters.q, mode: "insensitive" },
              },
            },
            {
              location: {
                name: { contains: filters.q, mode: "insensitive" },
              },
            },
            {
              variant: {
                sku: { contains: filters.q, mode: "insensitive" },
              },
            },
            {
              variant: {
                title: { contains: filters.q, mode: "insensitive" },
              },
            },
            {
              variant: {
                product: {
                  title: { contains: filters.q, mode: "insensitive" },
                },
              },
            },
          ],
        }
      : {}),
  };
  const levelTotal = await db.inventoryLevel.count({ where: levelWhere });
  const pagination = buildPagination(
    levelTotal,
    filters.page,
    INVENTORY_LEVEL_PAGE_SIZE,
  );
  const [locations, variants, levels, movements] = await Promise.all([
    db.inventoryLocation.findMany({
      where: { countryCode: "US" },
      orderBy: [{ isActive: "desc" }, { code: "asc" }, { id: "asc" }],
      select: {
        publicId: true,
        code: true,
        name: true,
        region: true,
        city: true,
        countryCode: true,
        isActive: true,
        updatedAt: true,
        _count: { select: { levels: true } },
      },
    }),
    db.productVariant.findMany({
      where: {
        deletedAt: null,
        product: { is: { deletedAt: null } },
      },
      orderBy: [
        { product: { title: "asc" } },
        { position: "asc" },
        { publicId: "asc" },
      ],
      select: {
        publicId: true,
        sku: true,
        title: true,
        status: true,
        trackInventory: true,
        product: { select: { title: true, publicId: true } },
      },
    }),
    db.inventoryLevel.findMany({
      where: levelWhere,
      orderBy: [
        { location: { code: "asc" } },
        { locationId: "asc" },
        { variant: { product: { title: "asc" } } },
        { variant: { position: "asc" } },
        { variantId: "asc" },
      ],
      skip: pagination.skip,
      take: pagination.pageSize,
      select: {
        onHandQuantity: true,
        reservedQuantity: true,
        safetyStockQuantity: true,
        allowBackorder: true,
        updatedAt: true,
        location: {
          select: {
            publicId: true,
            code: true,
            name: true,
            isActive: true,
          },
        },
        variant: {
          select: {
            publicId: true,
            title: true,
            sku: true,
            trackInventory: true,
            product: { select: { publicId: true, title: true } },
          },
        },
      },
    }),
    db.inventoryMovement.findMany({
      where: { inventoryLevel: { location: { countryCode: "US" } } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        publicId: true,
        type: true,
        quantityDelta: true,
        onHandAfter: true,
        reason: true,
        occurredAt: true,
        inventoryLevel: {
          select: {
            location: { select: { publicId: true, code: true } },
            variant: {
              select: {
                publicId: true,
                sku: true,
                title: true,
                product: { select: { title: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    canManage: authorization.permissions.has("inventory.manage"),
    filters: { ...filters, page: pagination.page },
    pagination,
    locations: locations.map((location) => ({
      publicId: location.publicId,
      code: location.code,
      name: location.name,
      region: location.region,
      city: location.city,
      countryCode: location.countryCode,
      isActive: location.isActive,
      levelCount: location._count.levels,
      updatedAt: location.updatedAt.toISOString(),
    })),
    variants: variants.map((variant) => ({
      publicId: variant.publicId,
      productPublicId: variant.product.publicId,
      productTitle: variant.product.title,
      title: variant.title,
      sku: variant.sku,
      status: variant.status,
      trackInventory: variant.trackInventory,
    })),
    levels: levels.map((level) => ({
      locationPublicId: level.location.publicId,
      locationCode: level.location.code,
      locationName: level.location.name,
      locationIsActive: level.location.isActive,
      variantPublicId: level.variant.publicId,
      productPublicId: level.variant.product.publicId,
      productTitle: level.variant.product.title,
      variantTitle: level.variant.title,
      sku: level.variant.sku,
      trackInventory: level.variant.trackInventory,
      onHandQuantity: level.onHandQuantity,
      reservedQuantity: level.reservedQuantity,
      safetyStockQuantity: level.safetyStockQuantity,
      allowBackorder: level.allowBackorder,
      updatedAt: level.updatedAt.toISOString(),
    })),
    movements: movements.map((movement) => ({
      publicId: movement.publicId,
      type: movement.type,
      quantityDelta: movement.quantityDelta,
      onHandAfter: movement.onHandAfter,
      reason: movement.reason,
      occurredAt: movement.occurredAt.toISOString(),
      locationPublicId: movement.inventoryLevel.location.publicId,
      locationCode: movement.inventoryLevel.location.code,
      variantPublicId: movement.inventoryLevel.variant.publicId,
      productTitle: movement.inventoryLevel.variant.product.title,
      variantTitle: movement.inventoryLevel.variant.title,
      sku: movement.inventoryLevel.variant.sku,
    })),
  };
}

export async function getAdminInventoryLocation(candidatePublicId: string) {
  const parsedId = publicIdSchema.safeParse(candidatePublicId);
  const returnTo = parsedId.success
    ? `/admin/inventory/locations/${parsedId.data}`
    : "/admin/inventory";
  const authorization = await requirePermission("inventory.read", returnTo);
  if (!parsedId.success) return null;

  const location = await getDb().inventoryLocation.findFirst({
    where: { publicId: parsedId.data, countryCode: "US" },
    select: {
      publicId: true,
      code: true,
      name: true,
      region: true,
      city: true,
      countryCode: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { levels: true } },
    },
  });
  if (!location) return null;

  return {
    canManage: authorization.permissions.has("inventory.manage"),
    publicId: location.publicId,
    code: location.code,
    name: location.name,
    region: location.region,
    city: location.city,
    countryCode: location.countryCode,
    isActive: location.isActive,
    levelCount: location._count.levels,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}
