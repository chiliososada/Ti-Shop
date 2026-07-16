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

const PAGE_SIZE = 25;

const EVENT_STATUSES = ["DRAFT", "APPROVED", "COMPLETED", "VOIDED"] as const;

export type AfterSalesIndexFilters = {
  q: string;
  status: (typeof EVENT_STATUSES)[number] | "";
  page: number;
};

export function normalizeAfterSalesIndexFilters(
  searchParams: Record<string, SearchParameter>,
): AfterSalesIndexFilters {
  const status = typeof searchParams.status === "string" ? searchParams.status : "";
  return {
    q: normalizeSearchText(searchParams.q),
    status: (EVENT_STATUSES as readonly string[]).includes(status)
      ? (status as (typeof EVENT_STATUSES)[number])
      : "",
    page: normalizePageSearchParameter(searchParams.page),
  };
}

export async function getAdminAfterSalesIndex(
  searchParams: Record<string, SearchParameter>,
) {
  await requirePermission("finance.read", "/admin/finance/after-sales");
  const filters = normalizeAfterSalesIndexFilters(searchParams);
  const conditions: Prisma.AfterSalesEventWhereInput[] = [];
  if (filters.q) {
    conditions.push({
      OR: [
        { order: { orderNumber: { contains: filters.q, mode: "insensitive" } } },
        { order: { customerEmail: { contains: filters.q, mode: "insensitive" } } },
        { reason: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }
  if (filters.status) conditions.push({ status: filters.status });
  const where = conditions.length === 0 ? {} : { AND: conditions };

  const db = getDb();
  const total = await db.afterSalesEvent.count({ where });
  const pagination = buildPagination(total, filters.page, PAGE_SIZE);
  const events = await db.afterSalesEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.pageSize,
    select: {
      publicId: true,
      status: true,
      responsibility: true,
      reason: true,
      refundAmountMinor: true,
      shippingRefundMinor: true,
      createdAt: true,
      completedAt: true,
      order: { select: { orderNumber: true, publicId: true, customerEmail: true } },
      _count: { select: { items: true } },
    },
  });

  return {
    filters,
    pagination,
    events: events.map((event) => ({
      publicId: event.publicId,
      status: event.status,
      responsibility: event.responsibility,
      reason: event.reason.slice(0, 140),
      refundTotalMinor: (event.refundAmountMinor + event.shippingRefundMinor).toString(),
      itemCount: event._count.items,
      orderNumber: event.order.orderNumber,
      orderPublicId: event.order.publicId,
      customerEmail: event.order.customerEmail,
      createdAt: event.createdAt.toISOString(),
      completedAt: event.completedAt?.toISOString() ?? null,
    })),
  };
}

export async function getAdminAfterSalesEvent(publicId: string) {
  await requirePermission("finance.read", "/admin/finance/after-sales");
  const db = getDb();
  const event = await db.afterSalesEvent.findFirst({
    where: { publicId },
    select: {
      publicId: true,
      status: true,
      responsibility: true,
      reason: true,
      refundAmountMinor: true,
      shippingRefundMinor: true,
      returnShippingCostMinor: true,
      compensationShippingCostMinor: true,
      evidenceNotes: true,
      completedAt: true,
      voidedAt: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      order: {
        select: {
          publicId: true,
          orderNumber: true,
          customerEmail: true,
          totalMinor: true,
          userId: true,
          items: {
            select: {
              id: true,
              productName: true,
              variantName: true,
              sku: true,
              quantity: true,
              unitPriceMinor: true,
              compensationEventId: true,
            },
          },
        },
      },
      items: {
        orderBy: { id: "asc" },
        select: {
          publicId: true,
          kind: true,
          quantity: true,
          disposition: true,
          restocked: true,
          compensationDelivery: true,
          unitCostUsdMinor: true,
          totalCostUsdMinor: true,
          appliedToOrder: { select: { orderNumber: true, publicId: true } },
          orderItem: { select: { productName: true, variantName: true } },
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
      adjustments: {
        orderBy: { id: "asc" },
        select: {
          publicId: true,
          type: true,
          signedUsdMinor: true,
          isEstimated: true,
          effectiveAt: true,
          reason: true,
        },
      },
    },
  });
  if (!event) return null;

  const [locations, variants, openOrders] = await Promise.all([
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
    event.order.userId
      ? db.order.findMany({
          where: {
            userId: event.order.userId,
            status: { in: ["DRAFT", "PENDING_PAYMENT"] },
            publicId: { not: event.order.publicId },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { publicId: true, orderNumber: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    event: {
      publicId: event.publicId,
      status: event.status,
      responsibility: event.responsibility,
      reason: event.reason,
      refundAmountMinor: event.refundAmountMinor.toString(),
      shippingRefundMinor: event.shippingRefundMinor.toString(),
      returnShippingCostMinor: event.returnShippingCostMinor.toString(),
      compensationShippingCostMinor: event.compensationShippingCostMinor.toString(),
      evidenceNotes: event.evidenceNotes,
      completedAt: event.completedAt?.toISOString() ?? null,
      voidedAt: event.voidedAt?.toISOString() ?? null,
      createdAt: event.createdAt.toISOString(),
      createdByName: event.createdBy?.name ?? null,
      approvedByName: event.approvedBy?.name ?? null,
      order: {
        publicId: event.order.publicId,
        orderNumber: event.order.orderNumber,
        customerEmail: event.order.customerEmail,
        totalMinor: event.order.totalMinor.toString(),
        items: event.order.items
          .filter((item) => item.compensationEventId === null)
          .map((item) => ({
            id: item.id.toString(),
            label: `${item.productName}${item.variantName ? ` · ${item.variantName}` : ""}${item.sku ? ` (${item.sku})` : ""} × ${item.quantity}`,
          })),
      },
      items: event.items.map((item) => ({
        publicId: item.publicId,
        kind: item.kind,
        quantity: item.quantity,
        disposition: item.disposition,
        restocked: item.restocked,
        compensationDelivery: item.compensationDelivery,
        unitCostUsdMinor: item.unitCostUsdMinor?.toString() ?? null,
        totalCostUsdMinor: item.totalCostUsdMinor?.toString() ?? null,
        appliedToOrderNumber: item.appliedToOrder?.orderNumber ?? null,
        appliedToOrderPublicId: item.appliedToOrder?.publicId ?? null,
        variantLabel: `${item.variant.product.title} · ${item.variant.title}${item.variant.sku ? ` (${item.variant.sku})` : ""}`,
      })),
      adjustments: event.adjustments.map((adjustment) => ({
        publicId: adjustment.publicId,
        type: adjustment.type,
        signedUsdMinor: adjustment.signedUsdMinor.toString(),
        isEstimated: adjustment.isEstimated,
        effectiveAt: adjustment.effectiveAt.toISOString(),
        reason: adjustment.reason,
      })),
    },
    locations,
    variants: variants.map((variant) => ({
      publicId: variant.publicId,
      label: `${variant.product.title} · ${variant.title}${variant.sku ? ` (${variant.sku})` : ""}`,
    })),
    openOrders,
  };
}

export const AFTER_SALES_CSV_COLUMNS = [
  "eventPublicId",
  "orderNumber",
  "status",
  "responsibility",
  "reason",
  "refundUsd",
  "shippingRefundUsd",
  "returnShippingCostUsd",
  "compensationShippingCostUsd",
  "itemKind",
  "variant",
  "quantity",
  "disposition",
  "delivery",
  "restocked",
  "itemCostUsd",
  "originalCurrency",
  "costState",
  "createdAt",
  "completedAt",
] as const;

function usdString(minor: bigint): string {
  const negative = minor < BigInt(0);
  const abs = (negative ? -minor : minor).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

export async function getAfterSalesExportRows() {
  await requirePermission("finance.export", "/admin/finance/after-sales");
  const events = await getDb().afterSalesEvent.findMany({
    orderBy: { id: "asc" },
    take: 10_000,
    select: {
      publicId: true,
      status: true,
      responsibility: true,
      reason: true,
      refundAmountMinor: true,
      shippingRefundMinor: true,
      returnShippingCostMinor: true,
      compensationShippingCostMinor: true,
      createdAt: true,
      completedAt: true,
      order: { select: { orderNumber: true } },
      items: {
        select: {
          kind: true,
          quantity: true,
          disposition: true,
          compensationDelivery: true,
          restocked: true,
          totalCostUsdMinor: true,
          variant: { select: { title: true, sku: true, product: { select: { title: true } } } },
        },
      },
    },
  });

  return events.flatMap((event) => {
    const base = {
      eventPublicId: event.publicId,
      orderNumber: event.order.orderNumber,
      status: event.status,
      responsibility: event.responsibility,
      reason: event.reason.slice(0, 500),
      refundUsd: usdString(event.refundAmountMinor),
      shippingRefundUsd: usdString(event.shippingRefundMinor),
      returnShippingCostUsd: usdString(event.returnShippingCostMinor),
      compensationShippingCostUsd: usdString(event.compensationShippingCostMinor),
      originalCurrency: "USD",
      costState: event.status === "COMPLETED" ? "Finalized" : "Estimated",
      createdAt: event.createdAt.toISOString(),
      completedAt: event.completedAt?.toISOString() ?? "",
    };
    if (event.items.length === 0) {
      return [
        {
          ...base,
          itemKind: "",
          variant: "",
          quantity: "",
          disposition: "",
          delivery: "",
          restocked: "",
          itemCostUsd: "",
        },
      ];
    }
    return event.items.map((item) => ({
      ...base,
      itemKind: item.kind,
      variant: `${item.variant.product.title} · ${item.variant.title}`,
      quantity: String(item.quantity),
      disposition: item.disposition ?? "",
      delivery: item.compensationDelivery ?? "",
      restocked: item.restocked ? "yes" : "no",
      itemCostUsd: item.totalCostUsdMinor === null ? "" : usdString(item.totalCostUsdMinor),
    }));
  });
}
