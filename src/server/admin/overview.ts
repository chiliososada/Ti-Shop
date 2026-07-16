import "server-only";

import { cache } from "react";

import { PAYMENT_REVIEW_ORDER_WHERE } from "@/server/admin/orders/payment-review-policy";
import { getAdminOverviewAccess } from "@/server/admin/overview-access";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

export const ADMIN_OVERVIEW_ORDER_WINDOW_DAYS = 30;
export const ADMIN_OVERVIEW_LOW_STOCK_THRESHOLD = 5;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

type CountRow = { count: bigint };

function countFromRow(rows: readonly CountRow[]) {
  const count = rows[0]?.count ?? BigInt(0);
  if (count < BigInt(0) || count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Administration metric count is outside the safe range.");
  }
  return Number(count);
}

async function countLowStockVariants() {
  const rows = await getDb().$queryRaw<CountRow[]>`
    SELECT COUNT(*) AS "count"
    FROM (
      SELECT variant."id"
      FROM "app"."product_variants" AS variant
      INNER JOIN "app"."products" AS product
        ON product."id" = variant."product_id"
      LEFT JOIN (
        "app"."inventory_levels" AS level
        INNER JOIN "app"."inventory_locations" AS location
          ON location."id" = level."location_id"
          AND location."is_active" = true
          AND location."country_code" = 'US'
      ) ON level."variant_id" = variant."id"
      WHERE variant."track_inventory" = true
        AND variant."status" = 'active'
        AND variant."deleted_at" IS NULL
        AND product."status" = 'active'
        AND product."deleted_at" IS NULL
      GROUP BY variant."id"
      HAVING COALESCE(
        SUM(
          GREATEST(
            level."on_hand_quantity"
              - level."reserved_quantity"
              - level."safety_stock_quantity",
            0
          )
        ),
        0
      ) <= ${ADMIN_OVERVIEW_LOW_STOCK_THRESHOLD}
    ) AS low_stock_variant
  `;

  return countFromRow(rows);
}

/**
 * Uncached loader kept separate so permission-scoped query behavior can be
 * tested without depending on React's request memoization implementation.
 */
export async function loadAdminOverview(now = new Date()) {
  const authorization = await requirePermission("admin.access", "/admin");
  const db = getDb();
  const access = getAdminOverviewAccess(authorization.permissions);
  const recentOrderCutoff = new Date(
    now.getTime() - ADMIN_OVERVIEW_ORDER_WINDOW_DAYS * MILLISECONDS_PER_DAY,
  );

  const [
    recentOrderCount,
    awaitingPaymentOrderCount,
    paymentReviewOrderCount,
    pendingFulfillmentOrderCount,
    inTransitShipmentCount,
    exceptionShipmentCount,
    lowStockVariantCount,
    customerCount,
    activeAdminCount,
    recentAuditLogs,
  ] = await Promise.all([
    access.metrics.canReadRecentOrders
      ? db.order.count({
          where: {
            createdAt: { gte: recentOrderCutoff },
            status: { not: "DRAFT" },
          },
        })
      : null,
    access.metrics.canReadAwaitingPayment
      ? db.order.count({
          where: {
            status: "PENDING_PAYMENT",
            paymentStatus: { in: ["UNPAID", "PENDING", "PARTIALLY_PAID"] },
          },
        })
      : null,
    access.metrics.canReadPaymentReview
      ? db.order.count({ where: PAYMENT_REVIEW_ORDER_WHERE })
      : null,
    access.metrics.canReadPendingFulfillment
      ? db.order.count({
          where: {
            status: { in: ["CONFIRMED", "PROCESSING"] },
            paymentStatus: "PAID",
            fulfillmentStatus: { in: ["UNFULFILLED", "PARTIAL"] },
          },
        })
      : null,
    access.metrics.canReadShipmentHealth
      ? db.shipment.count({ where: { status: "IN_TRANSIT" } })
      : null,
    access.metrics.canReadShipmentHealth
      ? db.shipment.count({ where: { status: "EXCEPTION" } })
      : null,
    access.metrics.canReadLowInventory ? countLowStockVariants() : null,
    access.metrics.canReadCustomerCount
      ? db.user.count({
          where: {
            customerProfile: { isNot: null },
            adminProfile: null,
            roleAssignments: { none: {} },
          },
        })
      : null,
    access.metrics.canReadAdministratorCount
      ? db.adminProfile.count({
          where: {
            isActive: true,
            user: {
              emailVerified: true,
              disabledAt: null,
              roleAssignments: {
                some: {
                  role: {
                    permissions: {
                      some: { permission: { slug: "admin.access" } },
                    },
                  },
                },
              },
            },
          },
        })
      : null,
    access.canReadAuditLog
      ? db.auditLog.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 5,
          select: {
            id: true,
            action: true,
            resourceType: true,
            createdAt: true,
          },
        })
      : null,
  ]);

  return {
    currentUser: {
      name: authorization.session.user.name,
      email: authorization.session.user.email,
    },
    roles: authorization.roles,
    metrics: {
      recentOrderCount,
      awaitingPaymentOrderCount,
      paymentReviewOrderCount,
      pendingFulfillmentOrderCount,
      inTransitShipmentCount,
      exceptionShipmentCount,
      lowStockVariantCount,
      customerCount,
      activeAdminCount,
    },
    recentAuditLogs,
    access,
  };
}

export const getAdminOverview = cache(loadAdminOverview);
