import type {
  FulfillmentStatus,
  OrderPaymentStatus,
  OrderStatus,
  ShipmentStatus,
  TrackingEventStatus,
} from "@/generated/prisma/client";

const MANUAL_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  DRAFT: ["LABEL_CREATED", "IN_TRANSIT", "CANCELED"],
  LABEL_CREATED: ["IN_TRANSIT", "CANCELED"],
  IN_TRANSIT: ["DELIVERED", "EXCEPTION", "RETURNED"],
  EXCEPTION: ["IN_TRANSIT", "DELIVERED", "RETURNED"],
  DELIVERED: ["RETURNED"],
  RETURNED: [],
  CANCELED: [],
};

const EVENT_TARGETS: Partial<Record<TrackingEventStatus, ShipmentStatus>> = {
  LABEL_CREATED: "LABEL_CREATED",
  PICKED_UP: "IN_TRANSIT",
  IN_TRANSIT: "IN_TRANSIT",
  OUT_FOR_DELIVERY: "IN_TRANSIT",
  DELIVERED: "DELIVERED",
  EXCEPTION: "EXCEPTION",
  RETURNED: "RETURNED",
};

export function allowedShipmentTransitions(status: ShipmentStatus) {
  return MANUAL_TRANSITIONS[status];
}

export function canTransitionShipment(
  current: ShipmentStatus,
  next: ShipmentStatus,
) {
  return MANUAL_TRANSITIONS[current].includes(next);
}

/**
 * A label is still reversible warehouse work. Once a carrier has possession of
 * the package, physical tracking remains authoritative even if payment is
 * later refunded or put under review.
 */
export function isShipmentPhysicallyDispatched(status: ShipmentStatus) {
  return (
    status === "IN_TRANSIT" ||
    status === "EXCEPTION" ||
    status === "DELIVERED" ||
    status === "RETURNED"
  );
}

export function allowedShipmentTransitionsForPayment(
  paymentStatus: OrderPaymentStatus,
  shipmentStatus: ShipmentStatus,
) {
  const transitions = allowedShipmentTransitions(shipmentStatus);
  if (
    paymentStatus === "PAID" ||
    isShipmentPhysicallyDispatched(shipmentStatus)
  ) {
    return transitions;
  }
  return transitions.filter((status) => status === "CANCELED");
}

export function canTransitionShipmentForPayment(
  paymentStatus: OrderPaymentStatus,
  current: ShipmentStatus,
  next: ShipmentStatus,
) {
  return allowedShipmentTransitionsForPayment(
    paymentStatus,
    current,
  ).includes(next);
}

export function canAdvanceTrackingForPayment(
  paymentStatus: OrderPaymentStatus,
  shipmentStatus: ShipmentStatus,
) {
  return (
    paymentStatus === "PAID" ||
    isShipmentPhysicallyDispatched(shipmentStatus)
  );
}

/**
 * Keeps the customer-facing order lifecycle aligned with merchant-maintained
 * shipments. A draft allocation starts processing, canceling the last draft
 * returns the order to confirmed, and only complete delivery completes it.
 */
export function orderStatusForFulfillment(
  current: OrderStatus,
  fulfillment: FulfillmentStatus,
  shipmentStatuses: readonly ShipmentStatus[],
): OrderStatus {
  if (
    current === "DRAFT" ||
    current === "PENDING_PAYMENT" ||
    current === "CANCELED" ||
    current === "COMPLETED"
  ) {
    return current;
  }

  const active = shipmentStatuses.filter((status) => status !== "CANCELED");
  if (
    fulfillment === "FULFILLED" &&
    active.length > 0 &&
    active.every((status) => status === "DELIVERED")
  ) {
    return "COMPLETED";
  }
  if (active.length > 0) return "PROCESSING";
  if (current === "PROCESSING" && fulfillment === "UNFULFILLED") {
    return "CONFIRMED";
  }
  return current;
}

/**
 * Tracking events may arrive without every intermediate carrier scan. They may
 * advance a shipment, but never revive a canceled/returned shipment or regress
 * a delivered shipment. An exception can be cleared by a later in-transit scan.
 */
export function shipmentStatusForTrackingEvent(
  current: ShipmentStatus,
  event: TrackingEventStatus,
): ShipmentStatus | null {
  const target = EVENT_TARGETS[event];
  if (!target || current === "CANCELED" || current === "RETURNED") return null;
  if (target === current) return null;
  if (current === "DELIVERED") return target === "RETURNED" ? target : null;
  if (current === "EXCEPTION" && target === "IN_TRANSIT") return target;
  if (target === "EXCEPTION") {
    return current === "IN_TRANSIT" ? target : null;
  }

  const rank: Record<ShipmentStatus, number> = {
    DRAFT: 0,
    LABEL_CREATED: 1,
    IN_TRANSIT: 2,
    EXCEPTION: 2,
    DELIVERED: 3,
    RETURNED: 4,
    CANCELED: 5,
  };
  return rank[target] > rank[current] ? target : null;
}

export function shipmentTimestampPatch(
  current: {
    shippedAt: Date | null;
    deliveredAt: Date | null;
    canceledAt: Date | null;
  },
  next: ShipmentStatus,
  occurredAt: Date,
) {
  return {
    status: next,
    shippedAt:
      next === "IN_TRANSIT" || next === "DELIVERED" || next === "RETURNED"
        ? (current.shippedAt ?? occurredAt)
        : current.shippedAt,
    deliveredAt:
      next === "DELIVERED"
        ? (current.deliveredAt ?? occurredAt)
        : current.deliveredAt,
    canceledAt:
      next === "CANCELED"
        ? (current.canceledAt ?? occurredAt)
        : current.canceledAt,
  };
}
