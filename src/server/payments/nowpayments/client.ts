import "server-only";

import { createHash } from "node:crypto";

import type { NowPaymentsRuntimeConfig } from "@/server/payments/nowpayments/config";
import {
  usdMinorToDecimalString,
  usdMinorToNumber,
} from "@/server/payments/nowpayments/decimal";
import {
  nowPaymentsInvoiceResponseSchema,
  nowPaymentsPaymentPayloadSchema,
  type NowPaymentsPaymentPayload,
} from "@/server/payments/nowpayments/schemas";

export type CreateNowPaymentsInvoiceInput = {
  orderNumber: string;
  amountMinor: bigint;
  description: string;
  ipnCallbackUrl: string;
  successUrl: string;
  cancelUrl: string;
  partiallyPaidUrl: string;
  payCurrency?: string;
};

export type NowPaymentsInvoice = {
  providerInvoiceId: string;
  invoiceUrl: string;
  priceAmount: string;
  priceCurrency: string;
  payCurrency: string | null;
  mode: "mock" | "sandbox" | "production";
};

export interface NowPaymentsClient {
  createInvoice(
    input: CreateNowPaymentsInvoiceInput,
  ): Promise<NowPaymentsInvoice>;
  getPayment(providerPaymentId: string): Promise<NowPaymentsPaymentPayload>;
}

export class NowPaymentsUnavailableError extends Error {
  constructor() {
    super("NOWPayments is disabled or not configured.");
    this.name = "NowPaymentsUnavailableError";
  }
}

export class NowPaymentsApiError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = "NowPaymentsApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

export function isTrustedNowPaymentsCheckoutUrl(
  value: string,
  mode: "mock" | "sandbox" | "production",
  siteOrigin?: string,
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (mode === "mock") {
    return (
      Boolean(siteOrigin) &&
      url.origin === siteOrigin &&
      url.pathname.startsWith("/checkout/mock/")
    );
  }

  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (url.hostname === "nowpayments.io" ||
      url.hostname.endsWith(".nowpayments.io"))
  );
}

function assertTrustedProviderUrl(
  value: string,
  mode: "sandbox" | "production",
) {
  if (!isTrustedNowPaymentsCheckoutUrl(value, mode)) {
    throw new NowPaymentsApiError(
      "NOWPayments returned an untrusted checkout URL.",
      null,
      false,
    );
  }
  return new URL(value).toString();
}

async function readJsonResponse(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 128 * 1_024) {
    throw new NowPaymentsApiError(
      "NOWPayments response exceeded the size limit.",
      response.status,
      false,
    );
  }

  const text = await response.text();
  if (text.length > 128 * 1_024) {
    throw new NowPaymentsApiError(
      "NOWPayments response exceeded the size limit.",
      response.status,
      false,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new NowPaymentsApiError(
      "NOWPayments returned invalid JSON.",
      response.status,
      response.status >= 500,
    );
  }

  if (!response.ok) {
    throw new NowPaymentsApiError(
      "NOWPayments rejected the request.",
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }
  return payload;
}

class HttpNowPaymentsClient implements NowPaymentsClient {
  constructor(
    private readonly config: NowPaymentsRuntimeConfig & {
      mode: "sandbox" | "production";
      apiBaseUrl: string;
      apiKey: string;
      ipnSecret: string;
    },
    private readonly fetchImplementation: typeof fetch,
  ) {}

  private async request(path: string, init?: RequestInit) {
    try {
      const response = await this.fetchImplementation(
        `${this.config.apiBaseUrl}${path}`,
        {
          ...init,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-api-key": this.config.apiKey,
            ...init?.headers,
          },
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
      return await readJsonResponse(response);
    } catch (error) {
      if (error instanceof NowPaymentsApiError) {
        throw error;
      }
      throw new NowPaymentsApiError(
        "NOWPayments request failed before a verified response was received.",
        null,
        true,
      );
    }
  }

  async createInvoice(input: CreateNowPaymentsInvoiceInput) {
    const payload = await this.request("/invoice", {
      method: "POST",
      body: JSON.stringify({
        price_amount: usdMinorToNumber(input.amountMinor),
        price_currency: "usd",
        ...(input.payCurrency ? { pay_currency: input.payCurrency } : {}),
        ipn_callback_url: input.ipnCallbackUrl,
        order_id: input.orderNumber,
        order_description: input.description,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        partially_paid_url: input.partiallyPaidUrl,
        is_fixed_rate: false,
        is_fee_paid_by_user: false,
      }),
    });
    const result = nowPaymentsInvoiceResponseSchema.safeParse(payload);
    if (!result.success) {
      throw new NowPaymentsApiError(
        "NOWPayments returned an invalid invoice response.",
        null,
        false,
      );
    }
    return {
      providerInvoiceId: result.data.id,
      invoiceUrl: assertTrustedProviderUrl(
        result.data.invoice_url,
        this.config.mode,
      ),
      priceAmount: result.data.price_amount,
      priceCurrency: result.data.price_currency.toLowerCase(),
      payCurrency: result.data.pay_currency?.toLowerCase() ?? null,
      mode: this.config.mode,
    };
  }

  async getPayment(providerPaymentId: string) {
    if (!/^[a-zA-Z0-9_-]{1,255}$/u.test(providerPaymentId)) {
      throw new NowPaymentsApiError("Invalid provider payment ID.", null, false);
    }
    const payload = await this.request(
      `/payment/${encodeURIComponent(providerPaymentId)}`,
    );
    const result = nowPaymentsPaymentPayloadSchema.safeParse(payload);
    if (!result.success) {
      throw new NowPaymentsApiError(
        "NOWPayments returned an invalid payment response.",
        null,
        false,
      );
    }
    return result.data;
  }
}

class MockNowPaymentsClient implements NowPaymentsClient {
  private readonly payments = new Map<string, NowPaymentsPaymentPayload>();

  async createInvoice(input: CreateNowPaymentsInvoiceInput) {
    const digest = createHash("sha256")
      .update(`${input.orderNumber}:${input.amountMinor.toString()}`)
      .digest("hex")
      .slice(0, 24);
    const providerInvoiceId = `mock-invoice-${digest}`;
    const providerPaymentId = `mock-payment-${digest}`;
    const siteOrigin = new URL(input.successUrl).origin;
    this.payments.set(providerPaymentId, {
      payment_id: providerPaymentId,
      parent_payment_id: null,
      invoice_id: providerInvoiceId,
      payment_status: "waiting",
      price_amount: usdMinorToDecimalString(input.amountMinor),
      price_currency: "usd",
      pay_amount: null,
      actually_paid: "0",
      actually_paid_at_fiat: "0",
      pay_currency: input.payCurrency ?? null,
      pay_address: null,
      payin_extra_id: null,
      order_id: input.orderNumber,
      purchase_id: null,
      outcome_amount: null,
      outcome_currency: null,
    });
    return {
      providerInvoiceId,
      invoiceUrl: `${siteOrigin}/checkout/mock/${providerInvoiceId}`,
      priceAmount: usdMinorToDecimalString(input.amountMinor),
      priceCurrency: "usd",
      payCurrency: input.payCurrency?.toLowerCase() ?? null,
      mode: "mock" as const,
    };
  }

  async getPayment(providerPaymentId: string) {
    const payment = this.payments.get(providerPaymentId);
    if (!payment) {
      throw new NowPaymentsApiError("Mock payment was not found.", 404, false);
    }
    return payment;
  }
}

export function createNowPaymentsClient(
  config: NowPaymentsRuntimeConfig,
  fetchImplementation: typeof fetch = fetch,
): NowPaymentsClient {
  if (config.mode === "disabled") {
    throw new NowPaymentsUnavailableError();
  }
  if (config.mode === "mock") {
    return new MockNowPaymentsClient();
  }
  if (!config.apiBaseUrl || !config.apiKey || !config.ipnSecret) {
    throw new NowPaymentsUnavailableError();
  }
  return new HttpNowPaymentsClient(
    {
      ...config,
      mode: config.mode,
      apiBaseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
      ipnSecret: config.ipnSecret,
    },
    fetchImplementation,
  );
}
