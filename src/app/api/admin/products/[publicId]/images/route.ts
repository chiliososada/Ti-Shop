import type { NextRequest } from "next/server";

import {
  uploadProductImage,
  type UploadFailureReason,
} from "@/server/admin/catalog/product-images/mutations";
import { authorizeApiPermission } from "@/server/auth/rbac";
import { isSameOriginRequest } from "@/server/orders/security";
import { consumeDatabaseRateLimit } from "@/server/security/rate-limit";
import { getStorageConfigState } from "@/server/storage/config";
import { isUuid } from "@/server/storage/keys";

// Multipart framing overhead on top of the configured image byte limit.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const FAILURE_STATUS: Record<UploadFailureReason, number> = {
  unauthorized: 403,
  storage_unconfigured: 503,
  product_not_found: 404,
  too_many_images: 409,
  validation_failed: 422,
  processing_failed: 422,
  storage_error: 502,
  conflict: 409,
};

function json(body: unknown, status: number, extraHeaders?: Record<string, string>) {
  return Response.json(body, { status, headers: extraHeaders });
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/products/[publicId]/images">,
) {
  // Route handlers do not get the Server Action origin check; enforce the
  // same-origin policy explicitly before any work happens.
  if (
    !isSameOriginRequest(
      request.url,
      request.headers.get("origin"),
      process.env.SITE_URL || request.url,
    )
  ) {
    return json(
      { ok: false, code: "cross_origin_request", message: "Cross-origin requests are rejected." },
      403,
    );
  }

  const authorization = await authorizeApiPermission("catalog.manage");
  if (!authorization.ok) {
    return json(
      {
        ok: false,
        code: authorization.status === 401 ? "unauthenticated" : "forbidden",
        message:
          authorization.status === 401
            ? "Sign in with an administrator account."
            : "The catalog.manage permission is required.",
      },
      authorization.status,
    );
  }

  const storageState = getStorageConfigState();
  if (!storageState.configured) {
    return json(
      { ok: false, code: "storage_unconfigured", message: storageState.reason },
      503,
    );
  }

  const { publicId } = await context.params;
  const productPublicId = publicId.toLowerCase();
  if (!isUuid(productPublicId)) {
    return json({ ok: false, code: "invalid_product", message: "Invalid product id." }, 400);
  }

  let rateLimit;
  try {
    rateLimit = await consumeDatabaseRateLimit({
      key: `product-image-upload:user:${authorization.session.user.id}`,
      limit: 120,
      windowMs: 10 * 60_000,
    });
  } catch {
    return json(
      { ok: false, code: "rate_limit_unavailable", message: "Try again shortly." },
      503,
    );
  }
  if (!rateLimit.allowed) {
    return json(
      { ok: false, code: "rate_limited", message: "Too many uploads. Wait and try again." },
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  const maxRequestBytes =
    storageState.env.productImageMaxBytes + MULTIPART_OVERHEAD_BYTES;
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    return json(
      {
        ok: false,
        code: "file_too_large",
        message: `Uploads are limited to ${Math.floor(storageState.env.productImageMaxBytes / (1024 * 1024))} MB per image.`,
      },
      413,
    );
  }

  let file: File | null = null;
  try {
    const formData = await request.formData();
    const entry = formData.get("file");
    file = entry instanceof File ? entry : null;
  } catch {
    return json(
      { ok: false, code: "invalid_body", message: "Send multipart/form-data with one file field." },
      400,
    );
  }
  if (!file) {
    return json(
      { ok: false, code: "missing_file", message: "The file field is required." },
      400,
    );
  }
  if (file.size > storageState.env.productImageMaxBytes) {
    return json(
      {
        ok: false,
        code: "file_too_large",
        message: `Uploads are limited to ${Math.floor(storageState.env.productImageMaxBytes / (1024 * 1024))} MB per image.`,
      },
      413,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadProductImage({
    productPublicId,
    bytes,
    declaredMimeType: file.type || null,
    originalFilename: file.name || null,
  });

  if (!result.ok) {
    return json(
      {
        ok: false,
        code: result.reason,
        message: result.message,
        retryable: result.retryable,
      },
      FAILURE_STATUS[result.reason],
    );
  }

  return json({ ok: true, image: result.image, deduplicated: result.deduplicated }, 201);
}
