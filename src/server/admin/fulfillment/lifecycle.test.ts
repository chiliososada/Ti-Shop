import { describe, expect, it } from "vitest";

import {
  allowedShipmentTransitionsForPayment,
  canAdvanceTrackingForPayment,
  canTransitionShipment,
  canTransitionShipmentForPayment,
  isShipmentPhysicallyDispatched,
  orderStatusForFulfillment,
  shipmentStatusForTrackingEvent,
  shipmentTimestampPatch,
} from "@/server/admin/fulfillment/lifecycle";

describe("shipment lifecycle", () => {
  it("prevents manual terminal-state revival", () => {
    expect(canTransitionShipment("DRAFT", "IN_TRANSIT")).toBe(true);
    expect(canTransitionShipment("CANCELED", "IN_TRANSIT")).toBe(false);
    expect(canTransitionShipment("RETURNED", "DELIVERED")).toBe(false);
  });

  it("blocks pre-dispatch progress after payment is no longer paid", () => {
    expect(
      allowedShipmentTransitionsForPayment("REFUNDED", "DRAFT"),
    ).toEqual(["CANCELED"]);
    expect(
      canTransitionShipmentForPayment("REFUNDED", "DRAFT", "IN_TRANSIT"),
    ).toBe(false);
    expect(
      canTransitionShipmentForPayment("REFUNDED", "DRAFT", "CANCELED"),
    ).toBe(true);
    expect(canAdvanceTrackingForPayment("REFUNDED", "DRAFT")).toBe(false);
  });

  it("keeps physical carrier tracking usable after a refund", () => {
    expect(isShipmentPhysicallyDispatched("LABEL_CREATED")).toBe(false);
    expect(isShipmentPhysicallyDispatched("IN_TRANSIT")).toBe(true);
    expect(
      canTransitionShipmentForPayment(
        "REFUNDED",
        "IN_TRANSIT",
        "DELIVERED",
      ),
    ).toBe(true);
    expect(canAdvanceTrackingForPayment("REFUNDED", "IN_TRANSIT")).toBe(
      true,
    );
  });

  it("advances useful tracking scans without regressing delivery", () => {
    expect(shipmentStatusForTrackingEvent("DRAFT", "PICKED_UP")).toBe(
      "IN_TRANSIT",
    );
    expect(shipmentStatusForTrackingEvent("DELIVERED", "IN_TRANSIT")).toBeNull();
    expect(shipmentStatusForTrackingEvent("DELIVERED", "RETURNED")).toBe(
      "RETURNED",
    );
  });

  it("sets database-required shipment timestamps", () => {
    const occurredAt = new Date("2026-07-13T12:00:00Z");
    expect(
      shipmentTimestampPatch(
        { shippedAt: null, deliveredAt: null, canceledAt: null },
        "DELIVERED",
        occurredAt,
      ),
    ).toMatchObject({
      status: "DELIVERED",
      shippedAt: occurredAt,
      deliveredAt: occurredAt,
      canceledAt: null,
    });
  });

  it("moves orders through processing and completion from shipment truth", () => {
    expect(
      orderStatusForFulfillment("CONFIRMED", "PARTIAL", ["DRAFT"]),
    ).toBe("PROCESSING");
    expect(
      orderStatusForFulfillment("PROCESSING", "UNFULFILLED", ["CANCELED"]),
    ).toBe("CONFIRMED");
    expect(
      orderStatusForFulfillment("PROCESSING", "FULFILLED", ["DELIVERED"]),
    ).toBe("COMPLETED");
    expect(
      orderStatusForFulfillment("PROCESSING", "PARTIAL", ["DELIVERED"]),
    ).toBe("PROCESSING");
    expect(
      orderStatusForFulfillment("COMPLETED", "RETURNED", ["RETURNED"]),
    ).toBe("COMPLETED");
  });
});
