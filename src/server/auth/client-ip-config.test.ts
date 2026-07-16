import { describe, expect, it } from "vitest";

import { parseClientIpConfig } from "@/server/auth/client-ip-config";

describe("trusted client IP configuration", () => {
  it("trusts no request headers by default", () => {
    expect(parseClientIpConfig(undefined, undefined)).toEqual({
      ipAddressHeaders: [],
      trustedProxies: [],
    });
  });

  it("requires an exact trusted proxy boundary for a client IP header", () => {
    expect(() =>
      parseClientIpConfig("x-ti-shop-client-ip", undefined),
    ).toThrow(/AUTH_TRUSTED_PROXY_CIDRS/);
  });

  it("normalizes a valid header with IPv4 and IPv6 proxy ranges", () => {
    expect(
      parseClientIpConfig(
        " X-Ti-Shop-Client-IP ",
        "192.0.2.10, 2001:db8::/64",
      ),
    ).toEqual({
      ipAddressHeaders: ["x-ti-shop-client-ip"],
      trustedProxies: ["192.0.2.10", "2001:db8::/64"],
    });
  });

  it.each(["not-an-ip", "10.0.0.1/33", "2001:db8::/129"])(
    "rejects invalid proxy value %s",
    (value) => {
      expect(() =>
        parseClientIpConfig("x-ti-shop-client-ip", value),
      ).toThrow(/Invalid trusted proxy/);
    },
  );
});
