import { z } from "zod";

import { getActiveSession } from "@/server/auth/session";
import {
  initializeNowPaymentsInvoice,
  NowPaymentsInitializationError,
} from "@/server/payments/nowpayments/initialize";
import {
  isJsonRequest,
  isSameOriginRequest,
} from "@/server/orders/security";
import { consumeDatabaseRateLimit } from "@/server/security/rate-limit";

const noStoreHeaders = { "Cache-Control": "no-store" } as const;
const publicIdSchema = z.string().uuid();
const bodySchema = z
  .object({ idempotencyKey: z.string().uuid() })
  .strict();

function errorResponse(code: string, error: string, status: number) {
  return Response.json(
    { code, error },
    { status, headers: noStoreHeaders },
  );
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ publicId: string; paymentPublicId: string }>;
  },
) {
  if (
    !isSameOriginRequest(
      request.url,
      request.headers.get("origin"),
      process.env.SITE_URL ?? request.url,
    )
  ) {
    return errorResponse(
      "CROSS_ORIGIN_REQUEST",
      "Payment requests must come from this site.",
      403,
    );
  }
  if (!isJsonRequest(request.headers.get("content-type"))) {
    return errorResponse(
      "INVALID_CONTENT_TYPE",
      "Payment requests must use application/json.",
      415,
    );
  }

  let userId: string | null = null;
  let authenticationUnavailable = false;
  try {
    const session = await getActiveSession(request.headers);
    userId = session?.user.id ?? null;
  } catch (error) {
    authenticationUnavailable = true;
    console.error("NOWPayments request authentication failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
  }
  if (authenticationUnavailable) {
    return errorResponse(
      "AUTHENTICATION_UNAVAILABLE",
      "Account verification is temporarily unavailable.",
      503,
    );
  }
  if (!userId) {
    return errorResponse(
      "AUTH_REQUIRED",
      "Sign in before starting a payment.",
      401,
    );
  }

  try {
    const rateLimit = await consumeDatabaseRateLimit({
      key: `nowpayments-initialize:user:${userId}`,
      limit: 10,
      windowMs: 5 * 60_000,
    });
    if (!rateLimit.allowed) {
      return Response.json(
        {
          code: "RATE_LIMITED",
          error: "Too many payment initialization attempts. Wait before retrying.",
        },
        {
          status: 429,
          headers: {
            ...noStoreHeaders,
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }
  } catch (error) {
    console.error("Payment initialization rate-limit check failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      "PAYMENT_TEMPORARILY_UNAVAILABLE",
      "Payment initialization is temporarily unavailable.",
      503,
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return errorResponse("REQUEST_TOO_LARGE", "The request is too large.", 413);
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 4_096) {
      return errorResponse(
        "REQUEST_TOO_LARGE",
        "The request is too large.",
        413,
      );
    }
    body = JSON.parse(text);
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "The request body is not valid JSON.",
      400,
    );
  }

  const params = await context.params;
  const parsedOrderPublicId = publicIdSchema.safeParse(params.publicId);
  const parsedPaymentPublicId = publicIdSchema.safeParse(
    params.paymentPublicId,
  );
  const parsedBody = bodySchema.safeParse(body);
  if (
    !parsedOrderPublicId.success ||
    !parsedPaymentPublicId.success ||
    !parsedBody.success
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "The payment request is invalid.",
      400,
    );
  }

  try {
    const result = await initializeNowPaymentsInvoice({
      userId,
      orderPublicId: parsedOrderPublicId.data,
      paymentPublicId: parsedPaymentPublicId.data,
      initializationKey: parsedBody.data.idempotencyKey,
    });
    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: noStoreHeaders,
    });
  } catch (error) {
    if (error instanceof NowPaymentsInitializationError) {
      return errorResponse(error.code, error.message, error.status);
    }
    console.error("NOWPayments initialization failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      "PAYMENT_INITIALIZATION_FAILED",
      "The payment could not be initialized. No payment was confirmed.",
      500,
    );
  }
}
