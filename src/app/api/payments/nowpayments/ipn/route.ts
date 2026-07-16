import { getNowPaymentsRuntimeConfig } from "@/server/payments/nowpayments/runtime-config";
import {
  NowPaymentsPayloadComplexityError,
  verifyNowPaymentsSignature,
} from "@/server/payments/nowpayments/canonical-json";
import {
  processNowPaymentsEvent,
  NowPaymentsPaymentNotFoundError,
} from "@/server/payments/nowpayments/process-event";
import { nowPaymentsPaymentPayloadSchema } from "@/server/payments/nowpayments/schemas";

const noStoreHeaders = { "Cache-Control": "no-store" } as const;
const maxBodyBytes = 128 * 1_024;

export async function POST(request: Request) {
  const config = getNowPaymentsRuntimeConfig();
  if (config.mode === "disabled" || !config.ipnSecret) {
    return Response.json(
      { code: "NOWPAYMENTS_DISABLED" },
      { status: 503, headers: noStoreHeaders },
    );
  }

  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json(
      { code: "INVALID_CONTENT_TYPE" },
      { status: 415, headers: noStoreHeaders },
    );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    return Response.json(
      { code: "PAYLOAD_TOO_LARGE" },
      { status: 413, headers: noStoreHeaders },
    );
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > maxBodyBytes) {
    return Response.json(
      { code: "PAYLOAD_TOO_LARGE" },
      { status: 413, headers: noStoreHeaders },
    );
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(rawBody);
  } catch {
    return Response.json(
      { code: "INVALID_JSON" },
      { status: 400, headers: noStoreHeaders },
    );
  }
  if (
    rawPayload === null ||
    typeof rawPayload !== "object" ||
    Array.isArray(rawPayload)
  ) {
    return Response.json(
      { code: "INVALID_PAYLOAD" },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const signature = request.headers.get("x-nowpayments-sig") ?? "";
  let signatureIsValid = false;
  try {
    signatureIsValid = verifyNowPaymentsSignature(
      rawPayload,
      signature,
      config.ipnSecret,
    );
  } catch (error) {
    if (error instanceof NowPaymentsPayloadComplexityError) {
      return Response.json(
        { code: "PAYLOAD_TOO_COMPLEX" },
        { status: 400, headers: noStoreHeaders },
      );
    }
    return Response.json(
      { code: "INVALID_PAYLOAD" },
      { status: 400, headers: noStoreHeaders },
    );
  }
  if (!signatureIsValid) {
    return Response.json(
      { code: "INVALID_SIGNATURE" },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const parsed = nowPaymentsPaymentPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return Response.json(
      { code: "INVALID_PAYLOAD" },
      { status: 400, headers: noStoreHeaders },
    );
  }

  try {
    await processNowPaymentsEvent({
      source: "ipn",
      payload: parsed.data,
      rawPayload: rawPayload as Record<string, unknown>,
    });
    return new Response(null, { status: 204, headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof NowPaymentsPaymentNotFoundError) {
      return Response.json(
        { code: "PAYMENT_NOT_READY" },
        { status: 503, headers: noStoreHeaders },
      );
    }
    console.error("NOWPayments IPN processing failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json(
      { code: "IPN_PROCESSING_FAILED" },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
