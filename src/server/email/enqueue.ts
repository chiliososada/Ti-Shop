import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { ShipmentStatus } from "@/generated/prisma/client";
import { isShipmentPhysicallyDispatched } from "@/server/admin/fulfillment/lifecycle";

export const EMAIL_OUTBOX_EVENT_PREFIX = "email.";

export const EMAIL_EVENT_TYPES = {
  orderConfirmation: "email.order_confirmation",
  paymentConfirmed: "email.payment_confirmed",
  orderShipped: "email.order_shipped",
} as const;

type TransactionClient = Prisma.TransactionClient;

/**
 * Every enqueue happens inside the same transaction as the business change,
 * so a crash can never produce a notified-but-unsaved (or saved-but-silent)
 * order. Delivery is the email outbox worker's job.
 */
export async function enqueueOrderConfirmationEmail(
  tx: TransactionClient,
  input: { orderPublicId: string },
) {
  await tx.outboxEvent.create({
    data: {
      aggregateType: "order",
      aggregateId: input.orderPublicId,
      eventType: EMAIL_EVENT_TYPES.orderConfirmation,
      payload: { orderPublicId: input.orderPublicId },
    },
    select: { id: true },
  });
}

export async function enqueuePaymentConfirmedEmail(
  tx: TransactionClient,
  input: { orderPublicId: string; paymentPublicId: string },
) {
  await tx.outboxEvent.create({
    data: {
      aggregateType: "order",
      aggregateId: input.orderPublicId,
      eventType: EMAIL_EVENT_TYPES.paymentConfirmed,
      payload: {
        orderPublicId: input.orderPublicId,
        paymentPublicId: input.paymentPublicId,
      },
    },
    select: { id: true },
  });
}

export async function enqueueOrderShippedEmail(
  tx: TransactionClient,
  input: { orderPublicId: string; shipmentPublicId: string },
) {
  await tx.outboxEvent.create({
    data: {
      aggregateType: "order",
      aggregateId: input.orderPublicId,
      eventType: EMAIL_EVENT_TYPES.orderShipped,
      payload: {
        orderPublicId: input.orderPublicId,
        shipmentPublicId: input.shipmentPublicId,
      },
    },
    select: { id: true },
  });
}

/**
 * The shipped email fires exactly once per shipment: on the first transition
 * into IN_TRANSIT from a not-yet-dispatched state. A recovery from EXCEPTION
 * back to IN_TRANSIT is not a new dispatch and stays silent.
 */
export function shouldSendShipmentDispatchEmail(
  statusBefore: ShipmentStatus,
  statusAfter: ShipmentStatus,
): boolean {
  return (
    statusAfter === "IN_TRANSIT" && !isShipmentPhysicallyDispatched(statusBefore)
  );
}
