import "server-only";

import { normalizePageSearchParameter } from "@/lib/pagination";
import { getActiveSession } from "@/server/auth/session";
import { createCustomerOrder } from "@/server/orders/create-order";
import { OrderServiceError } from "@/server/orders/errors";
import {
  checkoutInputSchema,
  normalizeCheckoutInput,
} from "@/server/orders/input";
import {
  getOrderForUser,
  listOrdersForUser,
} from "@/server/orders/queries";
import {
  isJsonRequest,
  isSameOriginRequest,
} from "@/server/orders/security";
import { consumeDatabaseRateLimit } from "@/server/security/rate-limit";

const MAX_CHECKOUT_BODY_BYTES = 32 * 1_024;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function errorResponse(
  code: string,
  error: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  return Response.json(
    { code, error, ...extra },
    { status, headers: NO_STORE_HEADERS },
  );
}

type RequestUserResult =
  | { ok: true; userId: string | null }
  | { ok: false };

async function requestUser(request: Request): Promise<RequestUserResult> {
  try {
    const session = await getActiveSession(request.headers);
    return { ok: true, userId: session?.user.id ?? null };
  } catch (error) {
    console.error("Order request authentication failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return { ok: false };
  }
}

function authenticationUnavailableResponse() {
  return errorResponse(
    "AUTHENTICATION_UNAVAILABLE",
    "Account verification is temporarily unavailable.",
    503,
  );
}

function logUnexpectedOrderError(error: unknown) {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : null;
  console.error("Order operation failed.", {
    name: error instanceof Error ? error.name : "UnknownError",
    code: typeof record?.code === "string" ? record.code : undefined,
  });
}

export async function handleCreateOrderRequest(request: Request) {
  if (
    !isSameOriginRequest(
      request.url,
      request.headers.get("origin"),
      process.env.SITE_URL ?? request.url,
    )
  ) {
    return errorResponse(
      "CROSS_ORIGIN_REQUEST",
      "Checkout requests must come from this site.",
      403,
    );
  }
  if (!isJsonRequest(request.headers.get("content-type"))) {
    return errorResponse(
      "INVALID_CONTENT_TYPE",
      "Checkout requests must use application/json.",
      415,
    );
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_CHECKOUT_BODY_BYTES) {
    return errorResponse(
      "REQUEST_TOO_LARGE",
      "The checkout request is too large.",
      413,
    );
  }

  const authenticated = await requestUser(request);
  if (!authenticated.ok) return authenticationUnavailableResponse();
  if (!authenticated.userId) {
    return errorResponse(
      "AUTH_REQUIRED",
      "Sign in with your email and password before checking out.",
      401,
    );
  }
  const userId = authenticated.userId;

  try {
    const rateLimit = await consumeDatabaseRateLimit({
      key: `checkout:user:${userId}`,
      limit: 10,
      windowMs: 10 * 60_000,
    });
    if (!rateLimit.allowed) {
      return Response.json(
        {
          code: "RATE_LIMITED",
          error: "Too many checkout attempts. Wait before trying again.",
        },
        {
          status: 429,
          headers: {
            ...NO_STORE_HEADERS,
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }
  } catch (error) {
    console.error("Checkout rate-limit check failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      "CHECKOUT_TEMPORARILY_UNAVAILABLE",
      "Checkout is temporarily unavailable. No order was created.",
      503,
    );
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_CHECKOUT_BODY_BYTES) {
      return errorResponse(
        "REQUEST_TOO_LARGE",
        "The checkout request is too large.",
        413,
      );
    }
    body = JSON.parse(text);
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "The checkout request body is not valid JSON.",
      400,
    );
  }

  const parsed = checkoutInputSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "INVALID_REQUEST",
      "Check the cart, US address, and payment method fields.",
      400,
      {
        issues: parsed.error.issues.slice(0, 20).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }

  try {
    const result = await createCustomerOrder(
      userId,
      normalizeCheckoutInput(parsed.data),
    );
    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (error instanceof OrderServiceError) {
      return errorResponse(error.code, error.message, error.status, {
        ...(error.contactWhatsApp
          ? { contactWhatsApp: true }
          : {}),
      });
    }

    logUnexpectedOrderError(error);
    return errorResponse(
      "ORDER_CREATE_FAILED",
      "The order could not be created. No payment has been confirmed. Please retry with the same cart.",
      500,
    );
  }
}

export async function handleListOrdersRequest(request: Request) {
  const authenticated = await requestUser(request);
  if (!authenticated.ok) return authenticationUnavailableResponse();
  if (!authenticated.userId) {
    return errorResponse(
      "AUTH_REQUIRED",
      "Sign in to view your orders.",
      401,
    );
  }
  const userId = authenticated.userId;

  try {
    const url = new URL(request.url);
    const pageValues = url.searchParams.getAll("page");
    const page = normalizePageSearchParameter(
      pageValues.length === 1 ? pageValues[0] : undefined,
    );
    return Response.json(
      await listOrdersForUser(userId, { page }),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    logUnexpectedOrderError(error);
    return errorResponse(
      "ORDERS_UNAVAILABLE",
      "Orders are temporarily unavailable.",
      500,
    );
  }
}

export async function handleGetOrderRequest(
  request: Request,
  publicId: string,
) {
  const authenticated = await requestUser(request);
  if (!authenticated.ok) return authenticationUnavailableResponse();
  if (!authenticated.userId) {
    return errorResponse(
      "AUTH_REQUIRED",
      "Sign in to view this order.",
      401,
    );
  }
  const userId = authenticated.userId;

  try {
    const order = await getOrderForUser(userId, publicId);
    if (!order) {
      return errorResponse(
        "ORDER_NOT_FOUND",
        "The order was not found.",
        404,
      );
    }
    return Response.json({ order }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    logUnexpectedOrderError(error);
    return errorResponse(
      "ORDER_UNAVAILABLE",
      "The order is temporarily unavailable.",
      500,
    );
  }
}
