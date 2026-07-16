import { describe, expect, it } from "vitest";

import { resolvePublicSiteOrigin } from "@/lib/site-url";

describe("public site origin", () => {
  it("uses the configured deployment origin", () => {
    expect(
      resolvePublicSiteOrigin(
        "https://shop.example/",
        "https://fallback.example",
      ),
    ).toBe("https://shop.example");
  });

  it("rejects path-bearing or credentialed candidates and falls back", () => {
    expect(
      resolvePublicSiteOrigin(
        "https://shop.example/store",
        "https://fallback.example",
      ),
    ).toBe("https://fallback.example");
    expect(
      resolvePublicSiteOrigin(
        "https://user:pass@shop.example",
        "https://fallback.example",
      ),
    ).toBe("https://fallback.example");
  });
});
