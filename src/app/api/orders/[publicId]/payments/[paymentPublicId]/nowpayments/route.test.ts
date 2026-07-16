import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUser: vi.fn(),
  deleteSessions: vi.fn(),
  initialize: vi.fn(),
  consumeRateLimit: vi.fn(),
}));

vi.mock("@/server/auth/auth", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } }),
}));

vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    user: { findUnique: mocks.findUser },
    session: { deleteMany: mocks.deleteSessions },
  }),
}));

vi.mock("@/server/payments/nowpayments/initialize", () => ({
  NowPaymentsInitializationError: class extends Error {},
  initializeNowPaymentsInvoice: mocks.initialize,
}));

vi.mock("@/server/security/rate-limit", () => ({
  consumeDatabaseRateLimit: mocks.consumeRateLimit,
}));

import { POST } from "./route";

const orderPublicId = "11111111-1111-4111-8111-111111111111";
const paymentPublicId = "22222222-2222-4222-8222-222222222222";
const idempotencyKey = "33333333-3333-4333-8333-333333333333";

function context() {
  return { params: Promise.resolve({ publicId: orderPublicId, paymentPublicId }) };
}

function request(body: unknown, origin = "https://shop.example") {
  return new Request(
    `https://shop.example/api/orders/${orderPublicId}/payments/${paymentPublicId}/nowpayments`,
    {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("NOWPayments initialization route", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("SITE_URL", "https://shop.example");
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "customer-1" },
      session: { id: "session-1" },
    });
    mocks.findUser.mockResolvedValue({ disabledAt: null });
    mocks.deleteSessions.mockResolvedValue({ count: 1 });
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      retryAfterSeconds: 0,
    });
    mocks.initialize.mockResolvedValue({
      created: true,
      paymentPublicId,
      orderPublicId,
      checkoutUrl: "https://nowpayments.io/payment/example",
      mode: "production",
    });
  });

  it("uses only authenticated resource IDs and a retry key", async () => {
    const response = await POST(request({ idempotencyKey }), context());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.initialize).toHaveBeenCalledWith({
      userId: "customer-1",
      orderPublicId,
      paymentPublicId,
      initializationKey: idempotencyKey,
    });
  });

  it("rejects cross-origin requests before authentication", async () => {
    const response = await POST(
      request({ idempotencyKey }, "https://attacker.example"),
      context(),
    );

    expect(response.status).toBe(403);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("rejects client-supplied amounts and other unknown fields", async () => {
    const response = await POST(
      request({ idempotencyKey, amountMinor: "1" }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("rejects a persisted disabled account even when a cookie resolves", async () => {
    mocks.findUser.mockResolvedValue({ disabledAt: new Date() });

    const response = await POST(request({ idempotencyKey }), context());

    expect(response.status).toBe(401);
    expect(mocks.deleteSessions).toHaveBeenCalledWith({
      where: { id: "session-1", userId: "customer-1" },
    });
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("reports authentication infrastructure failures as unavailable, not signed out", async () => {
    mocks.findUser.mockRejectedValue(new Error("database unavailable"));

    const response = await POST(request({ idempotencyKey }), context());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTHENTICATION_UNAVAILABLE",
    });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });
});
