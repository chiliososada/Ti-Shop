import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EMAIL_EVENT_TYPES,
  enqueueOrderConfirmationEmail,
  enqueueOrderShippedEmail,
  enqueuePaymentConfirmedEmail,
  shouldSendShipmentDispatchEmail,
} from "@/server/email/enqueue";

function fakeTx() {
  const create = vi.fn().mockResolvedValue({ id: BigInt(1) });
  return { tx: { outboxEvent: { create } } as never, create };
}

describe("email enqueue helpers", () => {
  it("writes an order confirmation event keyed by the order", async () => {
    const { tx, create } = fakeTx();
    await enqueueOrderConfirmationEmail(tx, { orderPublicId: "order-1" });
    expect(create).toHaveBeenCalledWith({
      data: {
        aggregateType: "order",
        aggregateId: "order-1",
        eventType: EMAIL_EVENT_TYPES.orderConfirmation,
        payload: { orderPublicId: "order-1" },
      },
      select: { id: true },
    });
  });

  it("records payment and shipment references in their payloads", async () => {
    const { tx, create } = fakeTx();
    await enqueuePaymentConfirmedEmail(tx, {
      orderPublicId: "order-1",
      paymentPublicId: "pay-1",
    });
    await enqueueOrderShippedEmail(tx, {
      orderPublicId: "order-1",
      shipmentPublicId: "ship-1",
    });
    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: EMAIL_EVENT_TYPES.paymentConfirmed,
          payload: { orderPublicId: "order-1", paymentPublicId: "pay-1" },
        }),
      }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: EMAIL_EVENT_TYPES.orderShipped,
          payload: { orderPublicId: "order-1", shipmentPublicId: "ship-1" },
        }),
      }),
    );
  });
});

describe("shouldSendShipmentDispatchEmail", () => {
  it("fires on the first physical dispatch", () => {
    expect(shouldSendShipmentDispatchEmail("DRAFT", "IN_TRANSIT")).toBe(true);
    expect(shouldSendShipmentDispatchEmail("LABEL_CREATED", "IN_TRANSIT")).toBe(
      true,
    );
  });

  it("stays silent on recovery, delivery, and non-dispatch transitions", () => {
    expect(shouldSendShipmentDispatchEmail("EXCEPTION", "IN_TRANSIT")).toBe(
      false,
    );
    expect(shouldSendShipmentDispatchEmail("IN_TRANSIT", "DELIVERED")).toBe(
      false,
    );
    expect(shouldSendShipmentDispatchEmail("DRAFT", "LABEL_CREATED")).toBe(
      false,
    );
    expect(shouldSendShipmentDispatchEmail("DRAFT", "CANCELED")).toBe(false);
  });
});
