import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createNowPaymentsClient,
  isTrustedNowPaymentsCheckoutUrl,
} from "./client";

const input = {
  orderNumber: "SA-TEST-1",
  amountMinor: BigInt(4_600),
  description: "Research-use order SA-TEST-1",
  ipnCallbackUrl: "https://shop.example/api/payments/nowpayments/ipn",
  successUrl: "https://shop.example/checkout/success?order=example",
  cancelUrl: "https://shop.example/account/orders/example?payment=cancelled",
  partiallyPaidUrl:
    "https://shop.example/account/orders/example?payment=partially-paid",
};

describe("NOWPayments client", () => {
  it("creates one invoice request with server-derived USD fields", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: "invoice-1",
        order_id: input.orderNumber,
        price_amount: "46.00",
        price_currency: "usd",
        pay_currency: null,
        invoice_url: "https://nowpayments.io/payment/invoice-1",
      }),
    );
    const client = createNowPaymentsClient(
      {
        mode: "production",
        apiBaseUrl: "https://api.nowpayments.io/v1",
        apiKey: "api-key",
        ipnSecret: "ipn-secret-at-least-16",
        timeoutMs: 10_000,
      },
      fetchImplementation,
    );

    await expect(client.createInvoice(input)).resolves.toMatchObject({
      providerInvoiceId: "invoice-1",
      invoiceUrl: "https://nowpayments.io/payment/invoice-1",
      priceAmount: "46.00",
      priceCurrency: "usd",
      mode: "production",
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0];
    expect(url).toBe("https://api.nowpayments.io/v1/invoice");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-api-key": "api-key" });
    expect(JSON.parse(String(init?.body))).toEqual({
      price_amount: 46,
      price_currency: "usd",
      ipn_callback_url: input.ipnCallbackUrl,
      order_id: input.orderNumber,
      order_description: input.description,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      partially_paid_url: input.partiallyPaidUrl,
      is_fixed_rate: false,
      is_fee_paid_by_user: false,
    });
  });

  it("never exposes an untrusted provider checkout URL", async () => {
    const client = createNowPaymentsClient(
      {
        mode: "production",
        apiBaseUrl: "https://api.nowpayments.io/v1",
        apiKey: "api-key",
        ipnSecret: "ipn-secret-at-least-16",
        timeoutMs: 10_000,
      },
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          id: "invoice-1",
          order_id: input.orderNumber,
          price_amount: "46",
          price_currency: "usd",
          pay_currency: null,
          invoice_url: "https://attacker.example/payment/invoice-1",
        }),
      ),
    );

    await expect(client.createInvoice(input)).rejects.toThrow(
      "untrusted checkout URL",
    );
  });

  it("keeps mock checkout links on the configured local site", async () => {
    const client = createNowPaymentsClient({
      mode: "mock",
      apiBaseUrl: null,
      apiKey: null,
      ipnSecret: "mock-secret-at-least-16",
      timeoutMs: 10_000,
    });
    const invoice = await client.createInvoice(input);

    expect(invoice.mode).toBe("mock");
    expect(
      isTrustedNowPaymentsCheckoutUrl(
        invoice.invoiceUrl,
        "mock",
        "https://shop.example",
      ),
    ).toBe(true);
    expect(
      isTrustedNowPaymentsCheckoutUrl(
        invoice.invoiceUrl,
        "mock",
        "https://other.example",
      ),
    ).toBe(false);
  });
});
