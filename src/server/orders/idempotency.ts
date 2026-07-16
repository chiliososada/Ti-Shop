import { createHash } from "node:crypto";

import type { NormalizedCheckoutInput } from "@/server/orders/input";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function checkoutRequestFingerprint(input: NormalizedCheckoutInput) {
  return sha256(
    JSON.stringify({
      version: 1,
      items: input.items,
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingAddress ?? null,
      paymentMethod: input.paymentMethod,
    }),
  );
}

export function scopedCheckoutIdempotencyKey(
  userId: string,
  clientKey: string,
) {
  return `checkout:v1:${sha256(`${userId}:${clientKey}`)}`;
}

export function adminManualOrderRequestFingerprint(input: {
  customerUserId: string;
  items: ReadonlyArray<{ variantPublicId: string; quantity: number }>;
  paymentMethod: "WIRE_TRANSFER" | "ZELLE";
  address:
    | { mode: "SAVED"; addressId: string }
    | {
        mode: "CUSTOM";
        value: {
          recipientName: string;
          company?: string;
          line1: string;
          line2?: string;
          city: string;
          region: string;
          postalCode: string;
          countryCode: "US";
          phone?: string;
        };
      };
}) {
  return sha256(JSON.stringify({ version: 1, ...input }));
}

export function scopedAdminManualOrderIdempotencyKey(
  actorUserId: string,
  customerUserId: string,
  clientKey: string,
) {
  return `admin-order:v1:${sha256(
    `${actorUserId}:${customerUserId}:${clientKey}`,
  )}`;
}

export function metadataHasCheckoutFingerprint(
  metadata: unknown,
  expectedFingerprint: string,
) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }

  return (
    (metadata as Record<string, unknown>).checkoutSchemaVersion === 1 &&
    (metadata as Record<string, unknown>).checkoutRequestHash ===
      expectedFingerprint
  );
}
