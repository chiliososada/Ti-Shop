import { z } from "zod";

import { PaymentMethod } from "@/generated/prisma/client";
import { getActiveSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import {
  isJsonRequest,
  isSameOriginRequest,
} from "@/server/orders/security";
import { usdMinorToDecimalString } from "@/server/payments/nowpayments/decimal";
import { processNowPaymentsEvent } from "@/server/payments/nowpayments/process-event";
import { getNowPaymentsRuntimeConfig } from "@/server/payments/nowpayments/runtime-config";

const noStoreHeaders = { "Cache-Control": "no-store" } as const;
const invoiceIdSchema = z
  .string()
  .regex(/^mock-invoice-[a-f0-9]{24}$/u);
const bodySchema = z
  .object({
    status: z.enum([
      "waiting",
      "confirming",
      "partially_paid",
      "finished",
      "failed",
      "expired",
    ]),
  })
  .strict();

function errorResponse(code: string, error: string, status: number) {
  return Response.json(
    { code, error },
    { status, headers: noStoreHeaders },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ providerInvoiceId: string }> },
) {
  let config;
  try {
    config = getNowPaymentsRuntimeConfig();
  } catch {
    return errorResponse("NOT_FOUND", "Not found.", 404);
  }
  if (process.env.NODE_ENV === "production" || config.mode !== "mock") {
    return errorResponse("NOT_FOUND", "Not found.", 404);
  }
  if (
    !isSameOriginRequest(
      request.url,
      request.headers.get("origin"),
      process.env.SITE_URL ?? request.url,
    )
  ) {
    return errorResponse(
      "CROSS_ORIGIN_REQUEST",
      "Mock payment requests must come from this site.",
      403,
    );
  }
  if (!isJsonRequest(request.headers.get("content-type"))) {
    return errorResponse(
      "INVALID_CONTENT_TYPE",
      "Mock payment requests must use application/json.",
      415,
    );
  }

  const session = await getActiveSession(request.headers);
  if (!session) {
    return errorResponse("AUTH_REQUIRED", "Sign in to continue.", 401);
  }

  const { providerInvoiceId: candidateInvoiceId } = await context.params;
  const parsedInvoiceId = invoiceIdSchema.safeParse(candidateInvoiceId);
  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 1_024) {
      return errorResponse("REQUEST_TOO_LARGE", "The request is too large.", 413);
    }
    body = JSON.parse(text);
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "The request body is invalid.",
      400,
    );
  }
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedInvoiceId.success || !parsedBody.success) {
    return errorResponse(
      "INVALID_REQUEST",
      "The mock payment request is invalid.",
      400,
    );
  }

  const payment = await getDb().payment.findFirst({
    where: {
      providerInvoiceId: parsedInvoiceId.data,
      method: PaymentMethod.NOWPAYMENTS,
      order: { is: { userId: session.user.id } },
    },
    select: {
      amountMinor: true,
      currency: true,
      order: { select: { publicId: true, orderNumber: true } },
    },
  });
  if (!payment) {
    return errorResponse("PAYMENT_NOT_FOUND", "Payment not found.", 404);
  }

  const status = parsedBody.data.status;
  const priceAmount = usdMinorToDecimalString(payment.amountMinor);
  const providerPaymentId = parsedInvoiceId.data.replace(
    "mock-invoice-",
    "mock-payment-",
  );
  const actuallyPaid =
    status === "finished"
      ? "1"
      : status === "partially_paid"
        ? "0.5"
        : "0";
  const now = new Date().toISOString();
  const payload = {
    payment_id: providerPaymentId,
    parent_payment_id: null,
    invoice_id: parsedInvoiceId.data,
    payment_status: status,
    price_amount: priceAmount,
    price_currency: payment.currency.toLowerCase(),
    pay_amount: "1",
    actually_paid: actuallyPaid,
    actually_paid_at_fiat:
      status === "finished" ? priceAmount : null,
    pay_currency: "mock",
    pay_address: null,
    payin_extra_id: null,
    order_id: payment.order.orderNumber,
    purchase_id: null,
    outcome_amount: null,
    outcome_currency: null,
    created_at: now,
    updated_at: now,
  };

  try {
    const result = await processNowPaymentsEvent({
      source: "ipn",
      payload,
      rawPayload: payload,
    });
    return Response.json(
      {
        simulated: true,
        providerStatus: status,
        paymentStatus: result.status,
        orderPaymentStatus: result.orderPaymentStatus,
        orderUrl: `/account/orders/${payment.order.publicId}`,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    console.error("Mock NOWPayments processing failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      "MOCK_PAYMENT_FAILED",
      "The local payment simulation could not be applied.",
      500,
    );
  }
}
