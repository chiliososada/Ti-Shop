import "server-only";

import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import {
  isExternallyRefundableManualPayment,
  isManualAdminPaymentMethod,
  isReviewableManualPayment,
  shouldClosePendingOrderAfterPaymentReview,
} from "@/server/admin/orders/payment-review-policy";
import type {
  ManualPaymentRefundInput,
  ManualPaymentReviewInput,
} from "@/server/admin/orders/validators";
import { isShipmentPhysicallyDispatched } from "@/server/admin/fulfillment/lifecycle";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import {
  consumeOrderInventoryReservations,
  releaseOrderInventoryReservations,
  restoreOrderInventoryAfterPreDispatchRefund,
} from "@/server/orders/inventory";
import { withSerializableRetry } from "@/server/orders/retry";
import {
  aggregateOrderPaymentStatus,
  type LocalPaymentStatus,
} from "@/server/payments/nowpayments/status";

const MANUAL_PAYMENT_METHODS = [
  PaymentMethod.WIRE_TRANSFER,
  PaymentMethod.ZELLE,
  PaymentMethod.OTHER_MANUAL,
] as const;

const REVIEWABLE_PAYMENT_STATUSES = [
  PaymentStatus.PENDING,
  PaymentStatus.REVIEW_REQUIRED,
] as const;

const EXTERNALLY_REFUNDABLE_PAYMENT_METHODS = [
  PaymentMethod.WIRE_TRANSFER,
  PaymentMethod.ZELLE,
] as const;

const INACTIVE_PAYMENT_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.FAILED,
  PaymentStatus.EXPIRED,
  PaymentStatus.CANCELED,
]);

const paymentAuditSelect = {
  publicId: true,
  orderId: true,
  method: true,
  status: true,
  currency: true,
  amountMinor: true,
  confirmedAt: true,
  failedAt: true,
  updatedAt: true,
} as const;

const orderAuditSelect = {
  publicId: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  confirmedAt: true,
  canceledAt: true,
  cancellationReason: true,
  updatedAt: true,
} as const;

function paymentStatusForDecision(
  decision: ManualPaymentReviewInput["decision"],
) {
  return decision === "CONFIRM"
    ? PaymentStatus.CONFIRMED
    : PaymentStatus.FAILED;
}

function metadataObject(
  value: Prisma.JsonValue | null,
): Prisma.InputJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Prisma.InputJsonObject;
}

function recordedExternalRefundReference(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const refund = (value as Record<string, unknown>).externalRefund;
  if (!refund || typeof refund !== "object" || Array.isArray(refund)) {
    return null;
  }
  const reference = (refund as Record<string, unknown>).reference;
  return typeof reference === "string" ? reference : null;
}

export async function reviewAdminManualPayment(
  input: ManualPaymentReviewInput,
) {
  const returnTo = `/admin/orders`;
  const paymentAuthorization = await requirePermission(
    "payments.manage",
    returnTo,
  );
  await requirePermission("orders.manage", returnTo);

  return withSerializableRetry(() => getDb().$transaction(
    async (tx) => {
      const existing = await tx.payment.findUnique({
        where: { publicId: input.paymentPublicId },
        select: {
          id: true,
          ...paymentAuditSelect,
          order: { select: { id: true, ...orderAuditSelect } },
        },
      });
      if (!existing) {
        return { ok: false as const, reason: "not_found" as const };
      }
      if (!isManualAdminPaymentMethod(existing.method)) {
        return { ok: false as const, reason: "not_manual" as const };
      }
      if (!isReviewableManualPayment(existing.method, existing.status)) {
        return { ok: false as const, reason: "not_reviewable" as const };
      }
      if (
        input.decision === "CONFIRM" &&
        existing.order.status !== OrderStatus.PENDING_PAYMENT
      ) {
        return { ok: false as const, reason: "order_not_payable" as const };
      }

      const now = new Date();
      const nextPaymentStatus = paymentStatusForDecision(input.decision);
      const claimed = await tx.payment.updateMany({
        where: {
          id: existing.id,
          method: { in: [...MANUAL_PAYMENT_METHODS] },
          status: { in: [...REVIEWABLE_PAYMENT_STATUSES] },
        },
        data: {
          status: nextPaymentStatus,
          ...(input.decision === "CONFIRM"
            ? { confirmedAt: now }
            : { failedAt: now }),
        },
      });
      if (claimed.count !== 1) {
        return { ok: false as const, reason: "conflict" as const };
      }

      const afterPayment = await tx.payment.findUniqueOrThrow({
        where: { id: existing.id },
        select: paymentAuditSelect,
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: existing.id,
          eventType:
            input.decision === "CONFIRM"
              ? "admin.manual_payment.confirmed"
              : "admin.manual_payment.rejected",
          statusBefore: existing.status,
          statusAfter: afterPayment.status,
          amountMinor: afterPayment.amountMinor,
          occurredAt: now,
        },
        select: { id: true },
      });

      const attempts = await tx.payment.findMany({
        where: { orderId: existing.order.id },
        select: { status: true },
      });
      const nextOrderPaymentStatus = aggregateOrderPaymentStatus(
        attempts.map(
          ({ status }: { status: PaymentStatus }) =>
            status as LocalPaymentStatus,
        ),
      );
      const shouldConfirmOrder =
        nextOrderPaymentStatus === "PAID" &&
        existing.order.status === OrderStatus.PENDING_PAYMENT;
      const shouldCloseOrder = shouldClosePendingOrderAfterPaymentReview(
        existing.order.status,
        nextOrderPaymentStatus,
      );
      const inventoryConsumption = shouldConfirmOrder
        ? await consumeOrderInventoryReservations(tx, existing.order.id, now)
        : { reservations: 0, quantity: 0 };
      const inventoryRelease = shouldCloseOrder
        ? await releaseOrderInventoryReservations(tx, existing.order.id, now)
        : { reservations: 0, quantity: 0 };
      const afterOrder = await tx.order.update({
        where: { id: existing.order.id },
        data: {
          paymentStatus: nextOrderPaymentStatus,
          ...(shouldConfirmOrder
            ? { status: OrderStatus.CONFIRMED, confirmedAt: now }
            : {}),
          ...(shouldCloseOrder
            ? {
                status: OrderStatus.CANCELED,
                canceledAt: now,
                cancellationReason:
                  "The manual payment attempt was rejected without another active payment attempt.",
              }
            : {}),
        },
        select: orderAuditSelect,
      });

      await writeAdminAuditLog(tx, {
        actorUserId: paymentAuthorization.session.user.id,
        action:
          input.decision === "CONFIRM"
            ? "payments.manual.confirm"
            : "payments.manual.reject",
        resourceType: "payment",
        resourceId: existing.publicId,
        before: { payment: existing, order: existing.order },
        after: { payment: afterPayment, order: afterOrder },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: "payment",
          aggregateId: existing.publicId,
          eventType:
            input.decision === "CONFIRM"
              ? "payment.manual_confirmed"
              : "payment.manual_rejected",
          payload: {
            paymentPublicId: existing.publicId,
            orderPublicId: existing.order.publicId,
            method: existing.method,
            statusBefore: existing.status,
            statusAfter: afterPayment.status,
            orderPaymentStatus: afterOrder.paymentStatus,
            orderStatus: afterOrder.status,
            inventoryReservationsConsumed:
              inventoryConsumption.reservations,
            inventoryQuantityConsumed: inventoryConsumption.quantity,
            inventoryReservationsReleased: inventoryRelease.reservations,
            inventoryQuantityReleased: inventoryRelease.quantity,
          },
        },
        select: { id: true },
      });

      return {
        ok: true as const,
        paymentPublicId: existing.publicId,
        orderPublicId: existing.order.publicId,
        orderNumber: existing.order.orderNumber,
        decision: input.decision,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    },
  ));
}

/**
 * Records a full Wire/Zelle refund that an operator has already completed in
 * the external banking service. This function never initiates or claims to
 * initiate movement of funds.
 */
export async function recordAdminManualPaymentRefund(
  input: ManualPaymentRefundInput,
) {
  const returnTo = "/admin/orders";
  const paymentAuthorization = await requirePermission(
    "payments.manage",
    returnTo,
  );
  await requirePermission("orders.manage", returnTo);

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const existing = await tx.payment.findUnique({
          where: { publicId: input.paymentPublicId },
          select: {
            id: true,
            metadata: true,
            ...paymentAuditSelect,
            order: {
              select: {
                id: true,
                totalMinor: true,
                currency: true,
                fulfillmentStatus: true,
                completedAt: true,
                ...orderAuditSelect,
                payments: {
                  orderBy: [{ id: "asc" }],
                  select: { id: true, status: true },
                },
                shipments: {
                  orderBy: [{ id: "asc" }],
                  select: {
                    publicId: true,
                    shipmentNumber: true,
                    status: true,
                    shippedAt: true,
                  },
                },
              },
            },
          },
        });
        if (!existing) {
          return { ok: false as const, reason: "not_found" as const };
        }

        const previouslyRecordedReference =
          recordedExternalRefundReference(existing.metadata);
        if (existing.status === PaymentStatus.REFUNDED) {
          if (previouslyRecordedReference === input.refundReference) {
            return {
              ok: true as const,
              duplicate: true as const,
              paymentPublicId: existing.publicId,
              orderPublicId: existing.order.publicId,
              orderNumber: existing.order.orderNumber,
              hasPhysicalDispatch: existing.order.shipments.some(
                (shipment) =>
                  shipment.shippedAt !== null ||
                  isShipmentPhysicallyDispatched(shipment.status),
              ),
              inventoryRestoredQuantity: 0,
            };
          }
          return { ok: false as const, reason: "already_refunded" as const };
        }
        if (
          !isExternallyRefundableManualPayment(
            existing.method,
            existing.status,
          )
        ) {
          return {
            ok: false as const,
            reason: isManualAdminPaymentMethod(existing.method)
              ? ("not_refundable" as const)
              : ("not_manual" as const),
          };
        }
        if (
          existing.order.paymentStatus !== "PAID" ||
          !["CONFIRMED", "PROCESSING", "COMPLETED"].includes(
            existing.order.status,
          )
        ) {
          return {
            ok: false as const,
            reason: "order_not_refundable" as const,
          };
        }
        if (
          existing.amountMinor !== existing.order.totalMinor ||
          existing.currency !== existing.order.currency
        ) {
          return {
            ok: false as const,
            reason: "not_full_order_payment" as const,
          };
        }
        if (
          existing.order.payments.some(
            (payment) =>
              payment.id !== existing.id &&
              !INACTIVE_PAYMENT_STATUSES.has(payment.status),
          )
        ) {
          return {
            ok: false as const,
            reason: "other_payment_attempts_require_review" as const,
          };
        }

        const preDispatchShipments = existing.order.shipments.filter(
          (shipment) =>
            shipment.status === "DRAFT" || shipment.status === "LABEL_CREATED",
        );
        if (preDispatchShipments.length > 0) {
          return {
            ok: false as const,
            reason: "cancel_pre_dispatch_shipments_first" as const,
          };
        }
        const hasPhysicalDispatch = existing.order.shipments.some(
          (shipment) =>
            shipment.shippedAt !== null ||
            isShipmentPhysicallyDispatched(shipment.status),
        );

        const now = new Date();
        const externalRefund = {
          reference: input.refundReference,
          ...(input.note ? { note: input.note } : {}),
          recordedAt: now.toISOString(),
          recordedByUserId: paymentAuthorization.session.user.id,
          externalRefundCompleted: true,
          hasPhysicalDispatch,
        } satisfies Prisma.InputJsonObject;
        const claimed = await tx.payment.updateMany({
          where: {
            id: existing.id,
            method: { in: [...EXTERNALLY_REFUNDABLE_PAYMENT_METHODS] },
            status: PaymentStatus.CONFIRMED,
          },
          data: {
            status: PaymentStatus.REFUNDED,
            metadata: {
              ...metadataObject(existing.metadata),
              externalRefund,
            },
          },
        });
        if (claimed.count !== 1) {
          return { ok: false as const, reason: "conflict" as const };
        }

        const afterPayment = await tx.payment.findUniqueOrThrow({
          where: { id: existing.id },
          select: { ...paymentAuditSelect, metadata: true },
        });
        await tx.paymentEvent.create({
          data: {
            paymentId: existing.id,
            eventType: "admin.manual_payment.external_refund_recorded",
            statusBefore: existing.status,
            statusAfter: afterPayment.status,
            amountMinor: existing.amountMinor,
            rawPayload: {
              reference: input.refundReference,
              ...(input.note ? { note: input.note } : {}),
              externalRefundCompleted: true,
            },
            occurredAt: now,
          },
          select: { id: true },
        });

        const restoredInventory = hasPhysicalDispatch
          ? { movements: 0, quantity: 0 }
          : await restoreOrderInventoryAfterPreDispatchRefund(
              tx,
              existing.order.id,
              now,
            );
        const afterOrder = await tx.order.update({
          where: { id: existing.order.id },
          data: {
            paymentStatus: "REFUNDED",
            ...(!hasPhysicalDispatch
              ? {
                  status: OrderStatus.CANCELED,
                  fulfillmentStatus: "CANCELED" as const,
                  canceledAt: now,
                  completedAt: null,
                  cancellationReason:
                    "A full external Wire/Zelle refund was recorded before carrier dispatch.",
                }
              : {}),
          },
          select: {
            ...orderAuditSelect,
            fulfillmentStatus: true,
            completedAt: true,
          },
        });

        await writeAdminAuditLog(tx, {
          actorUserId: paymentAuthorization.session.user.id,
          action: "payments.manual.external_refund_record",
          resourceType: "payment",
          resourceId: existing.publicId,
          before: {
            payment: {
              ...existing,
              metadata: undefined,
              order: undefined,
            },
            order: {
              publicId: existing.order.publicId,
              orderNumber: existing.order.orderNumber,
              status: existing.order.status,
              paymentStatus: existing.order.paymentStatus,
              fulfillmentStatus: existing.order.fulfillmentStatus,
            },
          },
          after: {
            payment: afterPayment,
            order: afterOrder,
            externalRefund: {
              reference: input.refundReference,
              ...(input.note ? { note: input.note } : {}),
              externalRefundCompleted: true,
            },
            hasPhysicalDispatch,
            restoredInventory,
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "payment",
            aggregateId: existing.publicId,
            eventType: "payment.manual_external_refund_recorded",
            payload: {
              paymentPublicId: existing.publicId,
              orderPublicId: existing.order.publicId,
              method: existing.method,
              amountMinor: existing.amountMinor.toString(),
              currency: existing.currency,
              refundReference: input.refundReference,
              externalRefundCompleted: true,
              hasPhysicalDispatch,
              inventoryRestoredQuantity: restoredInventory.quantity,
              orderStatus: afterOrder.status,
              orderPaymentStatus: afterOrder.paymentStatus,
              fulfillmentStatus: afterOrder.fulfillmentStatus,
            },
          },
          select: { id: true },
        });

        return {
          ok: true as const,
          duplicate: false as const,
          paymentPublicId: existing.publicId,
          orderPublicId: existing.order.publicId,
          orderNumber: existing.order.orderNumber,
          hasPhysicalDispatch,
          inventoryRestoredQuantity: restoredInventory.quantity,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    ),
  );
}
