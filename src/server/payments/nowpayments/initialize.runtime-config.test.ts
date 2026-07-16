import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/server/db/client", () => ({
  getDb: mocks.getDb,
}));

describe("NOWPayments initialization runtime configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("fails closed before database access when the production origin is insecure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "http://shop.example");
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "uRlbMjMbtg8d2wHvjXfY6kNCHafX5qL5SgQj4OP3lcrfMzPkdc9AsDLa1xV2G7Qb",
    );
    vi.stubEnv("NOWPAYMENTS_MODE", "disabled");

    const {
      initializeNowPaymentsInvoice,
      NowPaymentsInitializationError,
    } = await import("@/server/payments/nowpayments/initialize");

    await expect(
      initializeNowPaymentsInvoice({
        userId: "user-id",
        orderPublicId: "00000000-0000-4000-8000-000000000001",
        paymentPublicId: "00000000-0000-4000-8000-000000000002",
        initializationKey: "00000000-0000-4000-8000-000000000003",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: NowPaymentsInitializationError.name,
        code: "NOWPAYMENTS_UNAVAILABLE",
        status: 503,
      }),
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
