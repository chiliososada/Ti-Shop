import { describe, expect, it } from "vitest";

import {
  checkoutRequestFingerprint,
  metadataHasCheckoutFingerprint,
  scopedCheckoutIdempotencyKey,
} from "@/server/orders/idempotency";
import {
  checkoutInputSchema,
  normalizeCheckoutInput,
} from "@/server/orders/input";

function input(items: Array<{ variantPublicId: string; quantity: number }>) {
  return normalizeCheckoutInput(
    checkoutInputSchema.parse({
      idempotencyKey: "af3f216a-5698-4438-bb8d-3d4fe5523263",
      items,
      shippingAddress: {
        recipientName: "Buyer",
        line1: "1 Main St",
        city: "Austin",
        region: "TX",
        postalCode: "78701",
        countryCode: "US",
      },
      paymentMethod: "ZELLE",
    }),
  );
}

describe("checkout idempotency", () => {
  const firstId = "2c67720e-10a2-4b95-8bd1-03fe719571fc";
  const secondId = "09b15a17-c528-47ea-9e6f-0b1214135772";

  it("gives semantically identical sorted items the same fingerprint", () => {
    const left = checkoutRequestFingerprint(
      input([
        { variantPublicId: firstId, quantity: 1 },
        { variantPublicId: secondId, quantity: 2 },
      ]),
    );
    const right = checkoutRequestFingerprint(
      input([
        { variantPublicId: secondId, quantity: 2 },
        { variantPublicId: firstId, quantity: 1 },
      ]),
    );

    expect(left).toBe(right);
    expect(
      metadataHasCheckoutFingerprint(
        { checkoutSchemaVersion: 1, checkoutRequestHash: left },
        right,
      ),
    ).toBe(true);
  });

  it("scopes client retry keys to the authenticated user", () => {
    const key = "af3f216a-5698-4438-bb8d-3d4fe5523263";
    expect(scopedCheckoutIdempotencyKey("user-a", key)).not.toBe(
      scopedCheckoutIdempotencyKey("user-b", key),
    );
    expect(scopedCheckoutIdempotencyKey("user-a", key).length).toBeLessThan(
      160,
    );
  });

  it("detects a changed checkout under the same retry key", () => {
    const original = checkoutRequestFingerprint(
      input([{ variantPublicId: firstId, quantity: 1 }]),
    );
    const changed = checkoutRequestFingerprint(
      input([{ variantPublicId: firstId, quantity: 2 }]),
    );

    expect(original).not.toBe(changed);
    expect(
      metadataHasCheckoutFingerprint(
        { checkoutSchemaVersion: 1, checkoutRequestHash: original },
        changed,
      ),
    ).toBe(false);
  });
});

