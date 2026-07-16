import { beforeEach, describe, expect, it, vi } from "vitest";

import { signNowPaymentsPayload } from "@/server/payments/nowpayments/canonical-json";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  processEvent: vi.fn(),
}));

vi.mock("@/server/payments/nowpayments/runtime-config", () => ({
  getNowPaymentsRuntimeConfig: mocks.getConfig,
}));

vi.mock("@/server/payments/nowpayments/process-event", () => ({
  NowPaymentsPaymentNotFoundError: class extends Error {},
  processNowPaymentsEvent: mocks.processEvent,
}));

import { POST } from "./route";

const secret = "local-ipn-secret-at-least-16-characters";
const payload = {
  payment_id: "provider-payment-1",
  parent_payment_id: null,
  invoice_id: "provider-invoice-1",
  payment_status: "finished",
  price_amount: "46.00",
  price_currency: "usd",
  pay_amount: "0.001",
  actually_paid: "0.001",
  actually_paid_at_fiat: null,
  pay_currency: "btc",
  pay_address: null,
  payin_extra_id: null,
  order_id: "SA-TEST-1",
  purchase_id: null,
  outcome_amount: null,
  outcome_currency: null,
};

function request(body: unknown, signature?: string) {
  return new Request("https://shop.example/api/payments/nowpayments/ipn", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-nowpayments-sig": signature } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("NOWPayments IPN route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockReturnValue({
      mode: "mock",
      apiBaseUrl: null,
      apiKey: null,
      ipnSecret: secret,
      timeoutMs: 10_000,
    });
    mocks.processEvent.mockResolvedValue({ duplicate: false });
  });

  it("verifies the signature before accepting a valid provider event", async () => {
    const response = await POST(
      request(payload, signNowPaymentsPayload(payload, secret)),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.processEvent).toHaveBeenCalledWith({
      source: "ipn",
      payload,
      rawPayload: payload,
    });
  });

  it("rejects an invalid signature without touching payment state", async () => {
    const response = await POST(request(payload, "0".repeat(128)));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "INVALID_SIGNATURE" });
    expect(mocks.processEvent).not.toHaveBeenCalled();
  });

  it("rejects deeply nested JSON before signature canonicalization can exhaust the stack", async () => {
    let deeplyNested: unknown = { value: true };
    for (let depth = 0; depth < 64; depth += 1) {
      deeplyNested = { child: deeplyNested };
    }

    const response = await POST(request(deeplyNested, "0".repeat(128)));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "PAYLOAD_TOO_COMPLEX" });
    expect(mocks.processEvent).not.toHaveBeenCalled();
  });

  it("fails closed while the integration is disabled", async () => {
    mocks.getConfig.mockReturnValue({
      mode: "disabled",
      apiBaseUrl: null,
      apiKey: null,
      ipnSecret: null,
      timeoutMs: 10_000,
    });

    const response = await POST(request(payload));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "NOWPAYMENTS_DISABLED" });
    expect(mocks.processEvent).not.toHaveBeenCalled();
  });

  it("rejects a signed payload that is missing required provider fields", async () => {
    const invalidPayload = { payment_id: "provider-payment-1" };
    const response = await POST(
      request(
        invalidPayload,
        signNowPaymentsPayload(invalidPayload, secret),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "INVALID_PAYLOAD" });
    expect(mocks.processEvent).not.toHaveBeenCalled();
  });
});
