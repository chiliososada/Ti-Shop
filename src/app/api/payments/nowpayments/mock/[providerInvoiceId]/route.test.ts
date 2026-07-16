import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getSession: vi.fn(),
  findUser: vi.fn(),
  deleteSessions: vi.fn(),
  findPayment: vi.fn(),
  processEvent: vi.fn(),
}));

vi.mock("@/server/payments/nowpayments/runtime-config", () => ({
  getNowPaymentsRuntimeConfig: mocks.getConfig,
}));
vi.mock("@/server/auth/auth", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } }),
}));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    user: { findUnique: mocks.findUser },
    session: { deleteMany: mocks.deleteSessions },
    payment: { findFirst: mocks.findPayment },
  }),
}));
vi.mock("@/server/payments/nowpayments/process-event", () => ({
  processNowPaymentsEvent: mocks.processEvent,
}));

import { POST } from "./route";

const providerInvoiceId = "mock-invoice-aaaaaaaaaaaaaaaaaaaaaaaa";

function request(status: string, origin = "https://shop.example") {
  return new Request(
    `https://shop.example/api/payments/nowpayments/mock/${providerInvoiceId}`,
    {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
}

const context = {
  params: Promise.resolve({ providerInvoiceId }),
};

describe("development-only NOWPayments simulation", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("SITE_URL", "https://shop.example");
    vi.clearAllMocks();
    mocks.getConfig.mockReturnValue({ mode: "mock" });
    mocks.getSession.mockResolvedValue({
      user: { id: "customer-1" },
      session: { id: "session-1" },
    });
    mocks.findUser.mockResolvedValue({ disabledAt: null });
    mocks.deleteSessions.mockResolvedValue({ count: 1 });
    mocks.findPayment.mockResolvedValue({
      amountMinor: BigInt(4_600),
      currency: "USD",
      order: {
        publicId: "11111111-1111-4111-8111-111111111111",
        orderNumber: "SA-TEST-1",
      },
    });
    mocks.processEvent.mockResolvedValue({
      duplicate: false,
      status: "CONFIRMED",
      orderPaymentStatus: "PAID",
    });
  });

  it("applies a controlled mock event for the authenticated owner", async () => {
    const response = await POST(request("finished"), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      simulated: true,
      providerStatus: "finished",
      paymentStatus: "CONFIRMED",
      orderPaymentStatus: "PAID",
    });
    expect(mocks.findPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          providerInvoiceId,
          order: { is: { userId: "customer-1" } },
        }),
      }),
    );
  });

  it("is hidden unless mock mode is explicitly enabled", async () => {
    mocks.getConfig.mockReturnValue({ mode: "disabled" });

    const response = await POST(request("finished"), context);

    expect(response.status).toBe(404);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.processEvent).not.toHaveBeenCalled();
  });

  it("rejects unknown simulated statuses", async () => {
    const response = await POST(request("refunded"), context);

    expect(response.status).toBe(400);
    expect(mocks.processEvent).not.toHaveBeenCalled();
  });

  it("rejects a disabled account before reading its payment", async () => {
    mocks.findUser.mockResolvedValue({ disabledAt: new Date() });

    const response = await POST(request("finished"), context);

    expect(response.status).toBe(401);
    expect(mocks.deleteSessions).toHaveBeenCalledWith({
      where: { id: "session-1", userId: "customer-1" },
    });
    expect(mocks.findPayment).not.toHaveBeenCalled();
    expect(mocks.processEvent).not.toHaveBeenCalled();
  });
});
