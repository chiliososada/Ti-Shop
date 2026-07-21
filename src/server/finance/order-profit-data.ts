import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  computeOrderProfit,
  type OrderProfitBreakdown,
  type OrderProfitInput,
} from "@/server/finance/math/profit";

/**
 * The single database→profit assembly used by the order profit page, the
 * finance dashboard, partner settlements, and CSV exports. Every consumer
 * sums the same per-order breakdowns, so report totals always reconcile with
 * order-level detail.
 */

export const ORDER_PROFIT_SELECT = {
  id: true,
  publicId: true,
  orderNumber: true,
  customerEmail: true,
  status: true,
  paymentStatus: true,
  currency: true,
  subtotalMinor: true,
  discountMinor: true,
  shippingMinor: true,
  taxMinor: true,
  totalMinor: true,
  confirmedAt: true,
  createdAt: true,
  profitSettledSettlementId: true,
  items: {
    select: {
      id: true,
      quantity: true,
      totalCogsUsdMinor: true,
      unitCostUsdMinor: true,
      totalCost2UsdMinor: true,
      unitCost2UsdMinor: true,
      costIsEstimated: true,
      costSnapshotAt: true,
      compensationEventId: true,
    },
  },
  shipments: {
    select: {
      publicId: true,
      shipmentNumber: true,
      status: true,
      shippingCostMinor: true,
      packagingCostMinor: true,
    },
  },
  conversionEntries: {
    select: {
      allocatedFeeUsdMinor: true,
      allocatedChainFeeUsdMinor: true,
      batch: { select: { status: true, actualFeeUsdMinor: true, batchNumber: true } },
    },
  },
  financialAdjustments: {
    select: {
      publicId: true,
      type: true,
      signedUsdMinor: true,
      isEstimated: true,
      effectiveAt: true,
      reason: true,
      settledInSettlementId: true,
    },
  },
} satisfies Prisma.OrderSelect;

export type OrderProfitRow = Prisma.OrderGetPayload<{
  select: typeof ORDER_PROFIT_SELECT;
}>;

export function assembleOrderProfitInput(order: OrderProfitRow): OrderProfitInput {
  return {
    order: {
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      shippingMinor: order.shippingMinor,
      taxMinor: order.taxMinor,
    },
    items: order.items.map((item) => ({
      quantity: item.quantity,
      totalCogsUsdMinor: item.totalCogsUsdMinor,
      totalCost2UsdMinor: item.totalCost2UsdMinor,
      costIsEstimated: item.costIsEstimated,
      isCompensation: item.compensationEventId !== null,
    })),
    shipments: order.shipments.map((shipment) => ({
      status: shipment.status,
      shippingCostMinor: shipment.shippingCostMinor,
      packagingCostMinor: shipment.packagingCostMinor,
    })),
    conversionEntries: order.conversionEntries.map((entry) => ({
      allocatedFeeUsdMinor: entry.allocatedFeeUsdMinor,
      allocatedChainFeeUsdMinor: entry.allocatedChainFeeUsdMinor,
      batchStatus: entry.batch.status,
      feeIsEstimated:
        entry.batch.status !== "COMPLETED" || entry.batch.actualFeeUsdMinor === null,
    })),
    adjustments: order.financialAdjustments.map((adjustment) => ({
      type: adjustment.type,
      signedUsdMinor: adjustment.signedUsdMinor,
      isEstimated: adjustment.isEstimated,
    })),
  };
}

export function computeProfitForOrderRow(order: OrderProfitRow): OrderProfitBreakdown {
  return computeOrderProfit(assembleOrderProfitInput(order));
}
