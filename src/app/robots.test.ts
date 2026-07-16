import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "./robots";

describe("robots metadata", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps public pages crawlable and excludes private application routes", () => {
    vi.stubEnv("SITE_URL", "https://shop.example");
    const result = robots();
    expect(result.rules).toMatchObject({
      userAgent: "*",
      allow: "/",
      disallow: expect.arrayContaining([
        "/api/",
        "/admin",
        "/account",
        "/checkout",
      ]),
    });
    expect(result.sitemap).toBe("https://shop.example/sitemap.xml");
    expect(result.host).toBe("https://shop.example");
  });
});
