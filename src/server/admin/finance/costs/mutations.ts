import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

type MutationResult =
  | { ok: true; orderPublicId: string }
  | { ok: false; reason: string; message: string };

/**
 * Records the real carrier charge and packaging spend for one shipment.
 * These figures move the order's profit from Estimated to Finalized on the
 * logistics dimension; they never touch what the customer was charged.
 */
export async function recordShipmentCosts(input: {
  shipmentPublicId: string;
  shippingCostMinor: bigint;
  packagingCostMinor: bigint;
}): Promise<MutationResult> {
  const authorization = await requirePermission("finance.costs.manage", "/admin/finance");
  const actorUserId = authorization.session.user.id;
  if (input.shippingCostMinor < BigInt(0) || input.packagingCostMinor < BigInt(0)) {
    return { ok: false, reason: "negative", message: "Costs cannot be negative." };
  }

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const shipment = await tx.shipment.findFirst({
          where: { publicId: input.shipmentPublicId },
          select: {
            id: true,
            publicId: true,
            shipmentNumber: true,
            shippingCostMinor: true,
            packagingCostMinor: true,
            order: { select: { id: true, publicId: true, profitSettledSettlementId: true } },
          },
        });
        if (!shipment) {
          return { ok: false as const, reason: "not_found", message: "Shipment not found." };
        }
        if (shipment.order.profitSettledSettlementId !== null) {
          return {
            ok: false as const,
            reason: "settled",
            message:
              "This order's profit is locked in a partner settlement. Record the difference as a financial adjustment instead.",
          };
        }

        const before = {
          shippingCostMinor: shipment.shippingCostMinor?.toString() ?? null,
          packagingCostMinor: shipment.packagingCostMinor?.toString() ?? null,
        };
        await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            shippingCostMinor: input.shippingCostMinor,
            packagingCostMinor: input.packagingCostMinor,
          },
          select: { id: true },
        });
        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "finance.shipment.costs.record",
          resourceType: "shipment",
          resourceId: shipment.publicId,
          before,
          after: {
            shippingCostMinor: input.shippingCostMinor.toString(),
            packagingCostMinor: input.packagingCostMinor.toString(),
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "finance",
            aggregateId: shipment.order.publicId,
            eventType: "finance.shipment.costs.recorded",
            payload: {
              shipmentPublicId: shipment.publicId,
              orderPublicId: shipment.order.publicId,
            },
          },
          select: { id: true },
        });
        return { ok: true as const, orderPublicId: shipment.order.publicId };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      },
    ),
  );
}
