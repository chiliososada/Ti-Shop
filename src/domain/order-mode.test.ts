import { describe, expect, it } from "vitest";

import { DEFAULT_ORDER_MODE, parseOrderMode } from "@/domain/order-mode";

describe("parseOrderMode", () => {
  it("accepts the two known modes", () => {
    expect(parseOrderMode("whatsapp")).toBe("whatsapp");
    expect(parseOrderMode("checkout")).toBe("checkout");
  });

  it("falls back to the default for missing or malformed values", () => {
    expect(parseOrderMode(undefined)).toBe(DEFAULT_ORDER_MODE);
    expect(parseOrderMode(null)).toBe(DEFAULT_ORDER_MODE);
    expect(parseOrderMode("CHECKOUT")).toBe(DEFAULT_ORDER_MODE);
    expect(parseOrderMode({ mode: "checkout" })).toBe(DEFAULT_ORDER_MODE);
  });
});
