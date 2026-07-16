import { describe, expect, it } from "vitest";

import {
  createPackageSchema,
  createCarrierSchema,
  createShipmentSchema,
  readCreateShipmentFormData,
  trackingEventSchema,
  updateCarrierSchema,
  updateShipmentDetailsSchema,
} from "@/server/admin/fulfillment/validators";

const ORDER_PUBLIC_ID = "00000000-0000-4000-8000-000000000001";
const CARRIER_PUBLIC_ID = "00000000-0000-4000-8000-000000000002";

describe("fulfillment admin validators", () => {
  it("normalizes controlled carrier codes and checks tracking templates", () => {
    const parsed = createCarrierSchema.safeParse({
      code: "ups_us",
      name: "UPS",
      trackingUrlTemplate:
        "https://example.test/track/{trackingNumber}",
      isActive: "on",
    });
    expect(parsed).toMatchObject({
      success: true,
      data: { code: "UPS_US", isActive: true },
    });

    expect(
      createCarrierSchema.safeParse({
        code: "UPS",
        name: "UPS",
        trackingUrlTemplate: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });

  it("keeps carrier code immutable on update", () => {
    expect(
      updateCarrierSchema.safeParse({
        carrierPublicId: CARRIER_PUBLIC_ID,
        code: "CHANGED",
        name: "Carrier",
        trackingUrlTemplate: "",
      }).success,
    ).toBe(false);
  });

  it("accepts ordered quantities without an internal order-item id", () => {
    const form = new FormData();
    form.set("orderPublicId", ORDER_PUBLIC_ID);
    form.set("carrierPublicId", CARRIER_PUBLIC_ID);
    form.set("serviceLevel", "Ground");
    form.set("trackingNumber", "TEST123");
    form.set("estimatedDeliveryAt", "2026-07-20T17:00:00-04:00");
    form.append("lineQuantity", "1");
    form.append("lineQuantity", "0");

    const fields = readCreateShipmentFormData(form);
    expect(fields.success).toBe(true);
    if (!fields.success) return;
    expect(createShipmentSchema.safeParse(fields.data)).toMatchObject({
      success: true,
      data: { lineQuantities: [1, 0] },
    });
    expect(fields.data).not.toHaveProperty("orderItemId");
  });

  it("rejects extra shipment fields and all-zero quantities", () => {
    const form = new FormData();
    form.set("orderPublicId", ORDER_PUBLIC_ID);
    form.set("carrierPublicId", CARRIER_PUBLIC_ID);
    form.set("serviceLevel", "");
    form.set("trackingNumber", "");
    form.set("estimatedDeliveryAt", "");
    form.append("lineQuantity", "0");
    form.set("orderItemId", "123");
    expect(readCreateShipmentFormData(form).success).toBe(false);

    expect(
      createShipmentSchema.safeParse({
        orderPublicId: ORDER_PUBLIC_ID,
        carrierPublicId: CARRIER_PUBLIC_ID,
        serviceLevel: "",
        trackingNumber: "",
        estimatedDeliveryAt: "",
        lineQuantities: ["0"],
      }).success,
    ).toBe(false);
  });

  it("rejects control characters in manually entered tracking fields", () => {
    expect(
      createShipmentSchema.safeParse({
        orderPublicId: ORDER_PUBLIC_ID,
        carrierPublicId: CARRIER_PUBLIC_ID,
        serviceLevel: "Ground",
        trackingNumber: "TRACK-123\nInjected-header: value",
        estimatedDeliveryAt: "",
        lineQuantities: ["1"],
      }).success,
    ).toBe(false);
    expect(
      createCarrierSchema.safeParse({
        code: "SAFE",
        name: "Carrier",
        trackingUrlTemplate:
          "https://user:secret@example.test/{trackingNumber}",
      }).success,
    ).toBe(false);
  });

  it("requires timezone timestamps and a message for informational events", () => {
    expect(
      trackingEventSchema.safeParse({
        shipmentPublicId: ORDER_PUBLIC_ID,
        status: "INFO",
        message: "",
        location: "",
        occurredAt: "2026-07-13T12:00:00",
      }).success,
    ).toBe(false);
    expect(
      trackingEventSchema.safeParse({
        shipmentPublicId: ORDER_PUBLIC_ID,
        status: "IN_TRANSIT",
        message: "Carrier scan recorded manually.",
        location: "Tokyo",
        occurredAt: "2026-07-13T12:00:00Z",
      }).success,
    ).toBe(true);
  });

  it("validates shipment estimates and complete package dimensions", () => {
    expect(
      updateShipmentDetailsSchema.safeParse({
        shipmentPublicId: ORDER_PUBLIC_ID,
        serviceLevel: "Ground",
        trackingNumber: "TRACK-123",
        estimatedDeliveryAt: "2026-07-20T17:00:00",
      }).success,
    ).toBe(false);
    expect(
      createPackageSchema.safeParse({
        shipmentPublicId: ORDER_PUBLIC_ID,
        weightGrams: "250",
        lengthMillimeters: "100",
        widthMillimeters: "",
        heightMillimeters: "50",
      }).success,
    ).toBe(false);
    expect(
      createPackageSchema.safeParse({
        shipmentPublicId: ORDER_PUBLIC_ID,
        weightGrams: "250",
        lengthMillimeters: "100",
        widthMillimeters: "80",
        heightMillimeters: "50",
      }),
    ).toMatchObject({
      success: true,
      data: {
        weightGrams: 250,
        lengthMillimeters: 100,
        widthMillimeters: 80,
        heightMillimeters: 50,
      },
    });
  });
});
