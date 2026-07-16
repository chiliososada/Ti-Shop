import { describe, expect, it } from "vitest";

import {
  canonicalizeNowPaymentsPayload,
  NowPaymentsPayloadComplexityError,
  signNowPaymentsPayload,
  verifyNowPaymentsSignature,
} from "@/server/payments/nowpayments/canonical-json";

describe("NOWPayments IPN signature", () => {
  const secret = "local-test-secret-with-enough-entropy";
  const payload = {
    payment_status: "finished",
    payment_id: 123,
    fee: { serviceFee: 0, currency: "btc" },
    entries: [{ z: 1, a: 2 }],
  };

  it("recursively sorts object keys while preserving array order", () => {
    expect(canonicalizeNowPaymentsPayload(payload)).toBe(
      '{"entries":[{"a":2,"z":1}],"fee":{"currency":"btc","serviceFee":0},"payment_id":123,"payment_status":"finished"}',
    );
  });

  it("uses HMAC-SHA512 and rejects malformed or tampered signatures", () => {
    const signature = signNowPaymentsPayload(payload, secret);
    expect(signature).toMatch(/^[a-f0-9]{128}$/u);
    expect(verifyNowPaymentsSignature(payload, signature, secret)).toBe(true);
    expect(
      verifyNowPaymentsSignature(
        { ...payload, payment_status: "waiting" },
        signature,
        secret,
      ),
    ).toBe(false);
    expect(verifyNowPaymentsSignature(payload, "bad", secret)).toBe(false);
  });

  it("rejects excessive nesting before recursive canonicalization", () => {
    let deeplyNested: unknown = { value: true };
    for (let depth = 0; depth < 64; depth += 1) {
      deeplyNested = { child: deeplyNested };
    }

    expect(() => canonicalizeNowPaymentsPayload(deeplyNested)).toThrow(
      NowPaymentsPayloadComplexityError,
    );
  });
});
