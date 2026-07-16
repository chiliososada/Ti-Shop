import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import { getDb } from "@/server/db/client";
import {
  evaluateNowPaymentsPayload,
  nowPaymentsEventFingerprint,
} from "@/server/payments/nowpayments/evaluate-ipn";
import type { NowPaymentsPaymentPayload } from "@/server/payments/nowpayments/schemas";
import { positiveDecimalOrNull } from "@/server/payments/nowpayments/decimal";
import { withSerializableRetry } from "@/server/orders/retry";
import {
  aggregateOrderPaymentStatus,
  resolvePaymentStatusTransition,
  type LocalPaymentStatus,
} from "@/server/payments/nowpayments/status";
import {
  consumeOrderInventoryReservations,
  InventoryLifecycleError,
  releaseOrderInventoryReservations,
  restoreOrderInventoryAfterPreDispatchRefund,
} from "@/server/orders/inventory";

export class NowPaymentsPaymentNotFoundError extends Error {
  constructor() {
    super("The NOWPayments event does not match a local payment.");
    this.name = "NowPaymentsPaymentNotFoundError";
  }
}

type EventSource = "ipn" | "reconcile";

type AdminReconciliationAudit = {
  actorUserId: string;
  action: "payments.nowpayments.provider_payment_link";
  expectedPaymentPublicId: string;
  expectedProviderMode: "mock" | "sandbox" | "production";
};

const paymentWithOrder = {
  order: {
    select: {
      id: true,
      publicId: true,
      orderNumber: true,
      currency: true,
      status: true,
      paymentStatus: true,
    },
  },
} as const satisfies Prisma.PaymentInclude;

function occurredAt(payload: NowPaymentsPaymentPayload) {
  const value = payload.updated_at ?? payload.created_at;
  return value ? new Date(value) : new Date();
}

function metadataProviderMode(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const mode = (value as Record<string, unknown>).providerMode;
  return typeof mode === "string" ? mode : null;
}

function assertAdminReconciliationTarget(
  payment: { publicId: string; metadata: Prisma.JsonValue | null },
  audit: AdminReconciliationAudit,
) {
  if (
    payment.publicId !== audit.expectedPaymentPublicId ||
    metadataProviderMode(payment.metadata) !== audit.expectedProviderMode
  ) {
    throw new NowPaymentsPaymentNotFoundError();
  }
}

export async function processNowPaymentsEvent({
  source,
  payload,
  rawPayload,
  adminReconciliationAudit,
}: {
  source: EventSource;
  payload: NowPaymentsPaymentPayload;
  rawPayload: Record<string, unknown>;
  adminReconciliationAudit?: AdminReconciliationAudit;
}) {
  const db = getDb();
  const fingerprint = nowPaymentsEventFingerprint(source, rawPayload);

  // Retry-wrapped like the admin manual-review path: payment confirmation
  // contends with procurement receipts on inventory_cost_state, and a 40001
  // abort must not surface as a webhook 503 / operator error.
  return withSerializableRetry(() =>
    db.$transaction(
    async (tx) => {
      const duplicate = await tx.paymentEvent.findUnique({
        where: { providerEventId: fingerprint },
        select: {
          paymentId: true,
          payment: {
            select: {
              publicId: true,
              status: true,
              providerPaymentId: true,
              providerInvoiceId: true,
              providerStatus: true,
              metadata: true,
              order: {
                select: {
                  publicId: true,
                  orderNumber: true,
                  status: true,
                  paymentStatus: true,
                },
              },
            },
          },
        },
      });
      if (duplicate) {
        if (adminReconciliationAudit) {
          assertAdminReconciliationTarget(
            duplicate.payment,
            adminReconciliationAudit,
          );
          await writeAdminAuditLog(tx, {
            actorUserId: adminReconciliationAudit.actorUserId,
            action: adminReconciliationAudit.action,
            resourceType: "payment",
            resourceId: duplicate.payment.publicId,
            before: {
              paymentStatus: duplicate.payment.status,
              orderStatus: duplicate.payment.order.status,
              orderPaymentStatus: duplicate.payment.order.paymentStatus,
            },
            after: {
              paymentStatus: duplicate.payment.status,
              orderStatus: duplicate.payment.order.status,
              orderPaymentStatus: duplicate.payment.order.paymentStatus,
              providerPaymentId: duplicate.payment.providerPaymentId,
              providerInvoiceId: duplicate.payment.providerInvoiceId,
              providerStatus: duplicate.payment.providerStatus,
              providerPayloadValidated: true,
              duplicateProviderEvent: true,
            },
          });
        }
        return {
          duplicate: true,
          paymentId: duplicate.paymentId,
          paymentPublicId: duplicate.payment.publicId,
          orderPublicId: duplicate.payment.order.publicId,
          status: duplicate.payment.status,
        };
      }

      let payment = await tx.payment.findUnique({
        where: { providerPaymentId: payload.payment_id },
        include: paymentWithOrder,
      });

      if (!payment && payload.parent_payment_id) {
        const parent = await tx.payment.findUnique({
          where: { providerPaymentId: payload.parent_payment_id },
          include: paymentWithOrder,
        });
        if (!parent || parent.method !== "NOWPAYMENTS") {
          throw new NowPaymentsPaymentNotFoundError();
        }
        payment = await tx.payment.create({
          data: {
            orderId: parent.orderId,
            idempotencyKey: `nowpayments-repeat:${payload.payment_id}`,
            method: "NOWPAYMENTS",
            status: "REVIEW_REQUIRED",
            currency: parent.currency,
            amountMinor: parent.amountMinor,
            providerPaymentId: payload.payment_id,
            parentProviderPaymentId: payload.parent_payment_id,
            providerStatus: payload.payment_status,
            metadata: { repeatedDeposit: true },
          },
          include: paymentWithOrder,
        });
      }

      if (!payment && payload.invoice_id) {
        payment = await tx.payment.findUnique({
          where: { providerInvoiceId: payload.invoice_id },
          include: paymentWithOrder,
        });
      }
      if (!payment || payment.method !== "NOWPAYMENTS") {
        throw new NowPaymentsPaymentNotFoundError();
      }
      if (adminReconciliationAudit) {
        assertAdminReconciliationTarget(payment, adminReconciliationAudit);
      }

      const evaluation = evaluateNowPaymentsPayload(payload, {
        orderNumber: payment.order.orderNumber,
        currency: payment.currency,
        amountMinor: payment.amountMinor,
      });
      let nextStatus = resolvePaymentStatusTransition(
        payment.status as LocalPaymentStatus,
        evaluation.decision.paymentStatus,
      );
      const eventTime = occurredAt(payload);
      const attemptsBeforeUpdate = await tx.payment.findMany({
        where: { orderId: payment.orderId },
        select: { id: true, status: true },
      });
      const isPaidStatus = (status: LocalPaymentStatus) =>
        status === "CONFIRMED" || status === "OVERPAID";
      const firstPaidTransition =
        isPaidStatus(nextStatus) &&
        !isPaidStatus(payment.status as LocalPaymentStatus);
      let forcedReviewReason: string | null = null;

      if (firstPaidTransition) {
        if (payment.order.status !== "PENDING_PAYMENT") {
          nextStatus = "REVIEW_REQUIRED";
          forcedReviewReason = "ORDER_NOT_PAYABLE";
        } else {
          try {
            await consumeOrderInventoryReservations(
              tx,
              payment.orderId,
              eventTime,
            );
          } catch (error) {
            if (!(error instanceof InventoryLifecycleError)) throw error;
            nextStatus = "REVIEW_REQUIRED";
            forcedReviewReason = "INVENTORY_RESERVATION_INCOMPLETE";
          }
        }
      }

      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: nextStatus,
          providerPaymentId: payment.providerPaymentId ?? payload.payment_id,
          providerInvoiceId: payment.providerInvoiceId ?? payload.invoice_id,
          providerPurchaseId: payload.purchase_id,
          parentProviderPaymentId: payload.parent_payment_id,
          providerStatus: evaluation.decision.providerStatus,
          cryptoCurrency: payload.pay_currency?.toUpperCase() ?? null,
          cryptoAmount: payload.pay_amount,
          actuallyPaid: payload.actually_paid,
          outcomeAmount: payload.outcome_amount,
          outcomeCurrency: payload.outcome_currency?.toUpperCase() ?? null,
          payAddress: payload.pay_address,
          payExtraId: payload.payin_extra_id,
          ...(nextStatus === "CONFIRMED" || nextStatus === "OVERPAID"
            ? { confirmedAt: payment.confirmedAt ?? eventTime }
            : {}),
          ...(nextStatus === "FAILED"
            ? { failedAt: payment.failedAt ?? eventTime }
            : {}),
          ...(nextStatus === "CANCELED"
            ? { canceledAt: payment.canceledAt ?? eventTime }
            : {}),
          ...(nextStatus === "EXPIRED"
            ? { expiresAt: payment.expiresAt ?? eventTime }
            : {}),
        },
      });

      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          providerEventId: fingerprint,
          eventType: `nowpayments.${source}.${evaluation.decision.providerStatus}`,
          statusBefore: payment.status,
          statusAfter: updatedPayment.status,
          amountMinor: evaluation.priceAmountMinor,
          cryptoAmount: positiveDecimalOrNull(payload.actually_paid),
          rawPayload: rawPayload as Prisma.InputJsonObject,
          occurredAt: eventTime,
        },
      });

      const orderPaymentStatus = aggregateOrderPaymentStatus(
        attemptsBeforeUpdate.map(({ id, status }) =>
          id === payment.id
            ? (nextStatus as LocalPaymentStatus)
            : (status as LocalPaymentStatus),
        ),
      );
      const shouldConfirmOrder =
        orderPaymentStatus === "PAID" &&
        payment.order.status === "PENDING_PAYMENT";
      const shouldCloseOrder =
        payment.order.status === "PENDING_PAYMENT" &&
        (orderPaymentStatus === "FAILED" || orderPaymentStatus === "VOIDED");
      let hasPhysicalDispatch = false;
      if (orderPaymentStatus === "REFUNDED") {
        hasPhysicalDispatch = Boolean(
          await tx.shipment.findFirst({
            where: {
              orderId: payment.orderId,
              shippedAt: { not: null },
              status: { not: "CANCELED" },
            },
            select: { id: true },
          }),
        );
      }
      const shouldCancelBeforeDispatch =
        orderPaymentStatus === "REFUNDED" &&
        !hasPhysicalDispatch &&
        (payment.order.status === "CONFIRMED" ||
          payment.order.status === "PROCESSING");
      const fulfillmentBlockedReason = shouldCancelBeforeDispatch
        ? "PAYMENT_REFUNDED_BEFORE_DISPATCH"
        : orderPaymentStatus !== "PAID"
          ? "PAYMENT_NOT_PAID"
          : null;

      const canceledPreDispatchShipments: Array<{
        publicId: string;
        statusBefore: string;
      }> = [];
      if (shouldCancelBeforeDispatch) {
        const shipments = await tx.shipment.findMany({
          where: {
            orderId: payment.orderId,
            status: { in: ["DRAFT", "LABEL_CREATED"] },
          },
          orderBy: [{ id: "asc" }],
          select: {
            id: true,
            publicId: true,
            status: true,
            items: {
              orderBy: [{ orderItemId: "asc" }],
              select: { orderItemId: true, quantity: true },
            },
          },
        });
        for (const shipment of shipments) {
          for (const item of shipment.items) {
            const released = await tx.orderItem.updateMany({
              where: {
                id: item.orderItemId,
                fulfilledQuantity: { gte: item.quantity },
              },
              data: { fulfilledQuantity: { decrement: item.quantity } },
            });
            if (released.count !== 1) {
              throw new InventoryLifecycleError(
                "Pre-dispatch shipment allocations changed during refund processing.",
              );
            }
          }
          await tx.shipmentItem.deleteMany({
            where: { shipmentId: shipment.id },
          });
          const canceled = await tx.shipment.updateMany({
            where: { id: shipment.id, status: shipment.status },
            data: { status: "CANCELED", canceledAt: eventTime },
          });
          if (canceled.count !== 1) {
            throw new InventoryLifecycleError(
              "Pre-dispatch shipment status changed during refund processing.",
            );
          }
          canceledPreDispatchShipments.push({
            publicId: shipment.publicId,
            statusBefore: shipment.status,
          });
          await tx.outboxEvent.create({
            data: {
              aggregateType: "shipment",
              aggregateId: shipment.publicId,
              eventType: "shipment.canceled_after_payment_refund",
              payload: {
                shipmentPublicId: shipment.publicId,
                orderPublicId: payment.order.publicId,
                statusBefore: shipment.status,
                statusAfter: "CANCELED",
                allocationsReleased: true,
              },
            },
            select: { id: true },
          });
        }
      }

      const restoredInventory = shouldCancelBeforeDispatch
        ? await restoreOrderInventoryAfterPreDispatchRefund(
            tx,
            payment.orderId,
            eventTime,
          )
        : { movements: 0, quantity: 0 };

      if (shouldCloseOrder) {
        await releaseOrderInventoryReservations(
          tx,
          payment.orderId,
          eventTime,
        );
      }

      const updatedOrder = await tx.order.update({
        where: { id: payment.orderId },
        data: {
          paymentStatus: orderPaymentStatus,
          ...(shouldConfirmOrder
            ? { status: "CONFIRMED", confirmedAt: eventTime }
            : {}),
          ...(shouldCloseOrder
            ? {
                status: "CANCELED",
                canceledAt: eventTime,
                cancellationReason:
                  "The online payment attempt ended without a completed payment.",
              }
            : {}),
          ...(shouldCancelBeforeDispatch
            ? {
                status: "CANCELED",
                fulfillmentStatus: "CANCELED",
                canceledAt: eventTime,
                cancellationReason:
                  "Payment was refunded before physical dispatch; fulfillment is blocked.",
              }
            : {}),
        },
        select: {
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: "payment",
          aggregateId: payment.publicId,
          eventType: "payment.status_changed",
          payload: {
            paymentPublicId: payment.publicId,
            orderPublicId: payment.order.publicId,
            statusBefore: payment.status,
            statusAfter: updatedPayment.status,
            providerStatus: evaluation.decision.providerStatus,
            orderPaymentStatus: updatedOrder.paymentStatus,
            orderStatusBefore: payment.order.status,
            orderStatusAfter: updatedOrder.status,
            fulfillmentStatusAfter: updatedOrder.fulfillmentStatus,
            fulfillmentBlockedReason,
            canceledPreDispatchShipments,
            restoredInventoryQuantity: restoredInventory.quantity,
            requiresReview:
              evaluation.decision.requiresReview ||
              evaluation.integrityIssues.length > 0 ||
              forcedReviewReason !== null,
            integrityIssues: [
              ...evaluation.integrityIssues,
              ...(forcedReviewReason ? [forcedReviewReason] : []),
            ],
          },
        },
      });

      if (adminReconciliationAudit) {
        await writeAdminAuditLog(tx, {
          actorUserId: adminReconciliationAudit.actorUserId,
          action: adminReconciliationAudit.action,
          resourceType: "payment",
          resourceId: payment.publicId,
          before: {
            paymentStatus: payment.status,
            providerPaymentId: payment.providerPaymentId,
            providerInvoiceId: payment.providerInvoiceId,
            providerStatus: payment.providerStatus,
            orderStatus: payment.order.status,
            orderPaymentStatus: payment.order.paymentStatus,
          },
          after: {
            paymentStatus: updatedPayment.status,
            providerPaymentId: updatedPayment.providerPaymentId,
            providerInvoiceId: updatedPayment.providerInvoiceId,
            providerStatus: updatedPayment.providerStatus,
            orderStatus: updatedOrder.status,
            orderPaymentStatus: updatedOrder.paymentStatus,
            providerPayloadValidated: true,
            duplicateProviderEvent: false,
          },
        });
      }

      return {
        duplicate: false,
        paymentId: payment.id,
        paymentPublicId: payment.publicId,
        orderPublicId: payment.order.publicId,
        status: updatedPayment.status,
        orderPaymentStatus,
        orderStatus: updatedOrder.status,
        fulfillmentStatus: updatedOrder.fulfillmentStatus,
        fulfillmentBlockedReason,
        canceledPreDispatchShipmentCount:
          canceledPreDispatchShipments.length,
        restoredInventoryQuantity: restoredInventory.quantity,
        requiresReview:
          evaluation.decision.requiresReview ||
          evaluation.integrityIssues.length > 0 ||
          forcedReviewReason !== null,
      };
    },
    { isolationLevel: "Serializable", maxWait: 5_000, timeout: 10_000 },
    ),
  );
}
