import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  buildPagination,
  normalizePageSearchParameter,
  normalizeSearchText,
  type SearchParameter,
} from "@/lib/pagination";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { averageUnitCostUsdMinor } from "@/server/finance/math/costing";

const PAGE_SIZE = 25;

const PROCUREMENT_STATUSES = [
  "DRAFT",
  "ORDERED",
  "PAID",
  "RECEIVED",
  "CANCELED",
] as const;

type ProcurementStatusFilter = (typeof PROCUREMENT_STATUSES)[number];

export type ProcurementIndexFilters = {
  q: string;
  status: ProcurementStatusFilter | "";
  page: number;
};

function normalizeChoice<T extends string>(
  value: SearchParameter,
  choices: readonly T[],
): T | "" {
  const candidate = typeof value === "string" ? value : "";
  return (choices as readonly string[]).includes(candidate) ? (candidate as T) : "";
}

export function normalizeProcurementIndexFilters(
  searchParams: Record<string, SearchParameter>,
): ProcurementIndexFilters {
  return {
    q: normalizeSearchText(searchParams.q),
    status: normalizeChoice(searchParams.status, PROCUREMENT_STATUSES),
    page: normalizePageSearchParameter(searchParams.page),
  };
}

function indexWhere(filters: ProcurementIndexFilters): Prisma.ProcurementOrderWhereInput {
  const conditions: Prisma.ProcurementOrderWhereInput[] = [];
  if (filters.q) {
    conditions.push({
      OR: [
        { orderNumber: { contains: filters.q, mode: "insensitive" } },
        { supplier: { name: { contains: filters.q, mode: "insensitive" } } },
      ],
    });
  }
  if (filters.status) {
    conditions.push({ status: filters.status });
  }
  return conditions.length === 0 ? {} : { AND: conditions };
}

export async function getAdminProcurementIndex(
  searchParams: Record<string, SearchParameter>,
) {
  await requirePermission("finance.read", "/admin/finance/procurement");
  const filters = normalizeProcurementIndexFilters(searchParams);
  const where = indexWhere(filters);
  const db = getDb();

  const [total, suppliers] = await Promise.all([
    db.procurementOrder.count({ where }),
    db.supplier.findMany({
      where: { deletedAt: null },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      take: 200,
      select: {
        publicId: true,
        name: true,
        contactName: true,
        contactDetails: true,
        notes: true,
        isActive: true,
        _count: { select: { purchaseOrders: true } },
      },
    }),
  ]);
  const pagination = buildPagination(total, filters.page, PAGE_SIZE);
  const orders = await db.procurementOrder.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.pageSize,
    select: {
      publicId: true,
      orderNumber: true,
      status: true,
      totalMinor: true,
      totalUsdMinor: true,
      fxRateCnyPerUsd: true,
      orderedAt: true,
      receivedAt: true,
      createdAt: true,
      supplier: { select: { name: true, publicId: true } },
      _count: { select: { items: true } },
    },
  });

  return {
    filters,
    pagination,
    suppliers,
    orders: orders.map((order) => ({
      publicId: order.publicId,
      orderNumber: order.orderNumber,
      status: order.status,
      supplierName: order.supplier.name,
      supplierPublicId: order.supplier.publicId,
      itemCount: order._count.items,
      totalCnyMinor: order.totalMinor.toString(),
      totalUsdMinor: order.totalUsdMinor?.toString() ?? null,
      fxRate: order.fxRateCnyPerUsd?.toString() ?? null,
      orderedAt: order.orderedAt?.toISOString() ?? null,
      receivedAt: order.receivedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    })),
  };
}

export async function getAdminProcurementOrder(publicId: string) {
  await requirePermission("finance.read", "/admin/finance/procurement");
  const db = getDb();
  const order = await db.procurementOrder.findFirst({
    where: { publicId },
    select: {
      publicId: true,
      orderNumber: true,
      status: true,
      currency: true,
      goodsMinor: true,
      domesticShippingMinor: true,
      internationalShippingMinor: true,
      customsMinor: true,
      procurementFeeMinor: true,
      packagingMinor: true,
      otherCostMinor: true,
      totalMinor: true,
      fxRateCnyPerUsd: true,
      fxRateDate: true,
      fxRateSource: true,
      fxRateNote: true,
      totalUsdMinor: true,
      orderedAt: true,
      paidAt: true,
      receivedAt: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      supplier: { select: { publicId: true, name: true } },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          publicId: true,
          quantity: true,
          receivedQuantity: true,
          unitPriceMinor: true,
          lineMinor: true,
          allocatedCostMinor: true,
          totalMinor: true,
          totalUsdMinor: true,
          unitCostUsdMinor: true,
          variant: {
            select: {
              publicId: true,
              title: true,
              sku: true,
              product: { select: { title: true } },
            },
          },
        },
      },
    },
  });
  if (!order) return null;

  const [suppliers, locations, variants, costEntries, costStates] = await Promise.all([
    db.supplier.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: "asc" },
      take: 200,
      select: { publicId: true, name: true },
    }),
    db.inventoryLocation.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { publicId: true, code: true, name: true },
    }),
    db.productVariant.findMany({
      where: { deletedAt: null },
      orderBy: [{ product: { title: "asc" } }, { title: "asc" }],
      take: 500,
      select: {
        publicId: true,
        title: true,
        sku: true,
        product: { select: { title: true } },
      },
    }),
    db.inventoryCostEntry.findMany({
      where: { referenceType: { in: ["procurement_order", "procurement_fx_correction"] }, referenceId: publicId },
      orderBy: { id: "asc" },
      select: {
        publicId: true,
        entryType: true,
        quantityDelta: true,
        costDeltaUsdMinor: true,
        quantityAfter: true,
        totalCostAfterUsdMinor: true,
        reason: true,
        occurredAt: true,
        variant: { select: { title: true, sku: true, product: { select: { title: true } } } },
      },
    }),
    db.inventoryCostState.findMany({
      where: {
        variant: { procurementItems: { some: { procurementOrder: { publicId } } } },
      },
      select: {
        quantity: true,
        totalCostUsdMinor: true,
        variant: { select: { publicId: true, title: true, sku: true } },
      },
    }),
  ]);

  return {
    order: {
      ...order,
      goodsMinor: order.goodsMinor.toString(),
      domesticShippingMinor: order.domesticShippingMinor.toString(),
      internationalShippingMinor: order.internationalShippingMinor.toString(),
      customsMinor: order.customsMinor.toString(),
      procurementFeeMinor: order.procurementFeeMinor.toString(),
      packagingMinor: order.packagingMinor.toString(),
      otherCostMinor: order.otherCostMinor.toString(),
      totalMinor: order.totalMinor.toString(),
      totalUsdMinor: order.totalUsdMinor?.toString() ?? null,
      fxRateCnyPerUsd: order.fxRateCnyPerUsd?.toString() ?? null,
      fxRateDate: order.fxRateDate?.toISOString() ?? null,
      orderedAt: order.orderedAt?.toISOString() ?? null,
      paidAt: order.paidAt?.toISOString() ?? null,
      receivedAt: order.receivedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      createdByName: order.createdBy?.name ?? null,
      updatedByName: order.updatedBy?.name ?? null,
      items: order.items.map((item) => ({
        publicId: item.publicId,
        quantity: item.quantity,
        receivedQuantity: item.receivedQuantity,
        unitPriceMinor: item.unitPriceMinor.toString(),
        lineMinor: item.lineMinor.toString(),
        allocatedCostMinor: item.allocatedCostMinor.toString(),
        totalMinor: item.totalMinor.toString(),
        totalUsdMinor: item.totalUsdMinor?.toString() ?? null,
        unitCostUsdMinor: item.unitCostUsdMinor?.toString() ?? null,
        variantPublicId: item.variant.publicId,
        variantTitle: `${item.variant.product.title} · ${item.variant.title}`,
        sku: item.variant.sku,
      })),
    },
    suppliers,
    locations,
    variants: variants.map((variant) => ({
      publicId: variant.publicId,
      label: `${variant.product.title} · ${variant.title}${variant.sku ? ` (${variant.sku})` : ""}`,
    })),
    costEntries: costEntries.map((entry) => ({
      publicId: entry.publicId,
      entryType: entry.entryType,
      quantityDelta: entry.quantityDelta,
      costDeltaUsdMinor: entry.costDeltaUsdMinor.toString(),
      quantityAfter: entry.quantityAfter,
      totalCostAfterUsdMinor: entry.totalCostAfterUsdMinor.toString(),
      reason: entry.reason,
      occurredAt: entry.occurredAt.toISOString(),
      variantLabel: `${entry.variant.product.title} · ${entry.variant.title}${entry.variant.sku ? ` (${entry.variant.sku})` : ""}`,
    })),
    costStates: costStates.map((state) => ({
      variantPublicId: state.variant.publicId,
      variantLabel: `${state.variant.title}${state.variant.sku ? ` (${state.variant.sku})` : ""}`,
      quantity: state.quantity,
      totalCostUsdMinor: state.totalCostUsdMinor.toString(),
      averageUnitCostUsdMinor:
        averageUnitCostUsdMinor({
          quantity: state.quantity,
          totalCostUsdMinor: state.totalCostUsdMinor,
        })?.toString() ?? null,
    })),
  };
}

export const PROCUREMENT_CSV_COLUMNS = [
  "orderNumber",
  "status",
  "supplier",
  "variant",
  "sku",
  "quantity",
  "unitPriceCny",
  "lineCny",
  "allocatedExtraCny",
  "totalCny",
  "originalCurrency",
  "fxRateCnyPerUsd",
  "fxRateDate",
  "fxRateSource",
  "fxRateNote",
  "totalUsd",
  "unitCostUsd",
  "orderedAt",
  "paidAt",
  "receivedAt",
  "costState",
] as const;

function cnyString(minor: bigint): string {
  const negative = minor < BigInt(0);
  const abs = negative ? -minor : minor;
  const digits = abs.toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export async function getProcurementExportRows() {
  await requirePermission("finance.export", "/admin/finance/procurement");
  const rows = await getDb().procurementOrderItem.findMany({
    orderBy: [{ procurementOrderId: "asc" }, { id: "asc" }],
    take: 10_000,
    select: {
      quantity: true,
      unitPriceMinor: true,
      lineMinor: true,
      allocatedCostMinor: true,
      totalMinor: true,
      totalUsdMinor: true,
      unitCostUsdMinor: true,
      variant: { select: { title: true, sku: true, product: { select: { title: true } } } },
      procurementOrder: {
        select: {
          orderNumber: true,
          status: true,
          currency: true,
          fxRateCnyPerUsd: true,
          fxRateDate: true,
          fxRateSource: true,
          fxRateNote: true,
          orderedAt: true,
          paidAt: true,
          receivedAt: true,
          supplier: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    orderNumber: row.procurementOrder.orderNumber,
    status: row.procurementOrder.status,
    supplier: row.procurementOrder.supplier.name,
    variant: `${row.variant.product.title} · ${row.variant.title}`,
    sku: row.variant.sku ?? "",
    quantity: String(row.quantity),
    unitPriceCny: cnyString(row.unitPriceMinor),
    lineCny: cnyString(row.lineMinor),
    allocatedExtraCny: cnyString(row.allocatedCostMinor),
    totalCny: cnyString(row.totalMinor),
    originalCurrency: row.procurementOrder.currency,
    fxRateCnyPerUsd: row.procurementOrder.fxRateCnyPerUsd?.toString() ?? "",
    fxRateDate: row.procurementOrder.fxRateDate?.toISOString() ?? "",
    fxRateSource: row.procurementOrder.fxRateSource ?? "",
    fxRateNote: row.procurementOrder.fxRateNote ?? "",
    totalUsd: row.totalUsdMinor === null ? "" : cnyString(row.totalUsdMinor),
    unitCostUsd: row.unitCostUsdMinor === null ? "" : cnyString(row.unitCostUsdMinor),
    orderedAt: row.procurementOrder.orderedAt?.toISOString() ?? "",
    paidAt: row.procurementOrder.paidAt?.toISOString() ?? "",
    receivedAt: row.procurementOrder.receivedAt?.toISOString() ?? "",
    costState: row.procurementOrder.status === "RECEIVED" ? "Finalized" : "Estimated",
  }));
}
