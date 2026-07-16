import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("NOWPayments runtime availability", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is unavailable when the provider is disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NOWPAYMENTS_MODE", "disabled");
    const { isNowPaymentsRuntimeOperational } = await import(
      "./runtime-config"
    );

    expect(isNowPaymentsRuntimeOperational()).toBe(false);
  });

  it("is available for an explicitly configured local mock", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NOWPAYMENTS_MODE", "mock");
    vi.stubEnv(
      "NOWPAYMENTS_IPN_SECRET",
      "local-mock-secret-at-least-sixteen",
    );
    const { isNowPaymentsRuntimeOperational } = await import(
      "./runtime-config"
    );

    expect(isNowPaymentsRuntimeOperational()).toBe(true);
  });

  it("fails closed for an invalid provider configuration", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NOWPAYMENTS_MODE", "sandbox");
    vi.stubEnv("NOWPAYMENTS_API_KEY", "sandbox-key");
    vi.stubEnv(
      "NOWPAYMENTS_IPN_SECRET",
      "sandbox-secret-at-least-sixteen",
    );
    vi.stubEnv("NOWPAYMENTS_API_BASE_URL", "");
    const { isNowPaymentsRuntimeOperational } = await import(
      "./runtime-config"
    );

    expect(isNowPaymentsRuntimeOperational()).toBe(false);
  });
});
