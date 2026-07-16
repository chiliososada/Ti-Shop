import { describe, expect, it } from "vitest";

import {
  isJsonRequest,
  isSameOriginRequest,
} from "@/server/orders/security";

describe("order request boundary", () => {
  it("uses the configured public origin behind an internal proxy URL", () => {
    expect(
      isSameOriginRequest(
        "http://0.0.0.0:3000/api/orders",
        "https://shop.example",
        "https://shop.example",
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        "http://0.0.0.0:3000/api/orders",
        "https://attacker.example",
        "https://shop.example",
      ),
    ).toBe(false);
  });

  it("requires an exact origin and JSON media type", () => {
    expect(
      isSameOriginRequest(
        "https://shop.example/api/orders",
        null,
        "https://shop.example",
      ),
    ).toBe(false);
    expect(isJsonRequest("application/json; charset=utf-8")).toBe(true);
    expect(isJsonRequest("text/plain")).toBe(false);
  });
});
