import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "./route";

describe("legacy checkout endpoint", () => {
  it("rejects a cross-origin request before authentication or database work", async () => {
    const response = await POST(
      new Request("https://shop.example/api/checkout", {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "CROSS_ORIGIN_REQUEST",
      error: "Checkout requests must come from this site.",
    });
  });
});
