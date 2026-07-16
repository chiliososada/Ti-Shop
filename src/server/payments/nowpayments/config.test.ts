import { describe, expect, it } from "vitest";

import { parseNowPaymentsRuntimeConfig } from "@/server/payments/nowpayments/config";

describe("NOWPayments runtime config", () => {
  it("defaults to disabled without credentials", () => {
    expect(parseNowPaymentsRuntimeConfig({}, "production")).toMatchObject({
      mode: "disabled",
      apiKey: null,
      ipnSecret: null,
    });
  });

  it("permits explicit mock only outside production", () => {
    const input = {
      NOWPAYMENTS_MODE: "mock",
      NOWPAYMENTS_IPN_SECRET: "a-local-secret-at-least-16",
    };
    expect(parseNowPaymentsRuntimeConfig(input, "test").mode).toBe("mock");
    expect(() => parseNowPaymentsRuntimeConfig(input, "production")).toThrow(
      /forbidden/u,
    );
  });

  it("pins production to the official API host and blocks cross-mode hosts", () => {
    const base = {
      NOWPAYMENTS_MODE: "production",
      NOWPAYMENTS_API_KEY: "key",
      NOWPAYMENTS_IPN_SECRET: "a-production-secret-value",
    };
    expect(parseNowPaymentsRuntimeConfig(base, "production").apiBaseUrl).toBe(
      "https://api.nowpayments.io/v1",
    );
    expect(() =>
      parseNowPaymentsRuntimeConfig(
        { ...base, NOWPAYMENTS_API_BASE_URL: "https://evil.example/v1" },
        "production",
      ),
    ).toThrow(/host/u);
  });

  it("requires an explicitly documented non-production endpoint for sandbox", () => {
    expect(() =>
      parseNowPaymentsRuntimeConfig(
        {
          NOWPAYMENTS_MODE: "sandbox",
          NOWPAYMENTS_API_KEY: "key",
          NOWPAYMENTS_IPN_SECRET: "a-sandbox-secret-value",
        },
        "development",
      ),
    ).toThrow(/API_BASE_URL/u);
  });
});
