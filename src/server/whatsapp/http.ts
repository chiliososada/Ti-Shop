import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { isTrustedWhatsAppUrl } from "@/lib/whatsapp";
import { getActiveSession } from "@/server/auth/session";
import { parseClientIpConfig } from "@/server/auth/client-ip-config";
import {
  isJsonRequest,
  isSameOriginRequest,
} from "@/server/orders/security";
import { consumeDatabaseRateLimit } from "@/server/security/rate-limit";
import {
  createWhatsAppContactIntent,
  WhatsAppIntentError,
} from "@/server/whatsapp/intents";
import { whatsappIntentInputSchema } from "@/server/whatsapp/input";

const MAX_BODY_BYTES = 24 * 1_024;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function errorResponse(code: string, error: string, status: number) {
  return Response.json(
    { code, error },
    { status, headers: NO_STORE_HEADERS },
  );
}

function anonymousRateLimitKey(request: Request) {
  const clientIpConfig = parseClientIpConfig(
    process.env.AUTH_CLIENT_IP_HEADER,
    process.env.AUTH_TRUSTED_PROXY_CIDRS,
  );
  const trustedHeader = clientIpConfig.ipAddressHeaders[0];
  const candidateIp = trustedHeader
    ? request.headers.get(trustedHeader)?.trim()
    : null;
  if (candidateIp && isIP(candidateIp)) {
    const addressHash = createHash("sha256")
      .update(candidateIp)
      .digest("hex")
      .slice(0, 32);
    return `whatsapp-intent:anonymous-ip:${addressHash}`;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "A trusted proxy-provided client IP is required for anonymous WhatsApp rate limiting.",
    );
  }

  // Development-only fallback. Production Docker traffic is required to pass
  // through nginx, which overwrites the trusted client-IP header and also
  // enforces an independent per-IP request limit at the edge.
  const fingerprint = createHash("sha256")
    .update(request.headers.get("user-agent") ?? "unknown-agent")
    .update("\n")
    .update(request.headers.get("accept-language") ?? "unknown-language")
    .digest("hex")
    .slice(0, 32);
  return `whatsapp-intent:anonymous:${fingerprint}`;
}

export async function handleWhatsAppIntentRequest(request: Request) {
  const trustedSiteUrl = process.env.SITE_URL ?? request.url;
  if (
    !isSameOriginRequest(
      request.url,
      request.headers.get("origin"),
      trustedSiteUrl,
    )
  ) {
    return errorResponse(
      "CROSS_ORIGIN_REQUEST",
      "WhatsApp contact requests must come from this site.",
      403,
    );
  }
  if (!isJsonRequest(request.headers.get("content-type"))) {
    return errorResponse(
      "INVALID_CONTENT_TYPE",
      "WhatsApp contact requests must use application/json.",
      415,
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return errorResponse("REQUEST_TOO_LARGE", "The request is too large.", 413);
  }

  let userId: string | null;
  try {
    const session = await getActiveSession(request.headers);
    userId = session?.user.id ?? null;
  } catch (error) {
    console.error("WhatsApp contact authentication check failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      "CONTACT_TEMPORARILY_UNAVAILABLE",
      "WhatsApp contact is temporarily unavailable.",
      503,
    );
  }

  try {
    const rateLimit = await consumeDatabaseRateLimit({
      key: userId
        ? `whatsapp-intent:user:${userId}`
        : anonymousRateLimitKey(request),
      limit: userId ? 30 : 12,
      windowMs: 10 * 60_000,
    });
    if (!rateLimit.allowed) {
      return Response.json(
        {
          code: "RATE_LIMITED",
          error: "Too many WhatsApp contact attempts. Wait before retrying.",
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
    console.error("WhatsApp contact rate-limit check failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      "CONTACT_TEMPORARILY_UNAVAILABLE",
      "WhatsApp contact is temporarily unavailable.",
      503,
    );
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return errorResponse("REQUEST_TOO_LARGE", "The request is too large.", 413);
    }
    body = JSON.parse(text);
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "The request body is not valid JSON.",
      400,
    );
  }

  const parsed = whatsappIntentInputSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "INVALID_REQUEST",
      "The WhatsApp contact request is invalid.",
      400,
    );
  }

  try {
    const result = await createWhatsAppContactIntent({
      input: parsed.data,
      userId,
      siteOrigin: trustedSiteUrl,
    });
    if (!isTrustedWhatsAppUrl(result.destinationUrl)) {
      throw new Error("Untrusted WhatsApp destination returned by service.");
    }
    return Response.json(
      {
        intentPublicId: result.intentPublicId,
        url: result.destinationUrl,
      },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof WhatsAppIntentError) {
      return errorResponse(error.code, error.message, error.status);
    }
    console.error("WhatsApp contact intent creation failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      "CONTACT_TEMPORARILY_UNAVAILABLE",
      "WhatsApp contact is temporarily unavailable. No contact link was opened.",
      503,
    );
  }
}
