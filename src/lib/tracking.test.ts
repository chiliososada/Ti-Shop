import { describe, expect, it } from "vitest";

import { buildMerchantTrackingUrl } from "@/lib/tracking";

describe("merchant tracking links", () => {
  it("encodes the tracking number into an HTTPS template", () => {
    expect(
      buildMerchantTrackingUrl(
        "https://carrier.example/track/{trackingNumber}",
        "ABC 123/4",
      ),
    ).toBe("https://carrier.example/track/ABC%20123%2F4");
  });

  it("rejects unsafe, credentialed, and incomplete templates", () => {
    expect(
      buildMerchantTrackingUrl(
        "http://carrier.example/{trackingNumber}",
        "ABC",
      ),
    ).toBeNull();
    expect(
      buildMerchantTrackingUrl(
        "https://user:pass@carrier.example/{trackingNumber}",
        "ABC",
      ),
    ).toBeNull();
    expect(
      buildMerchantTrackingUrl("https://carrier.example/track", "ABC"),
    ).toBeNull();
  });
});
