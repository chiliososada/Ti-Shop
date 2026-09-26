import { afterEach, describe, expect, it, vi } from "vitest";

import { AI_CRAWLER_USER_AGENTS } from "@/lib/ai-crawlers";
import robots from "./robots";

describe("robots metadata", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps public pages crawlable and excludes private application routes", () => {
    vi.stubEnv("SITE_URL", "https://shop.example");
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    expect(rules[0]).toMatchObject({
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

  it("gives AI search and assistant crawlers the same access as every crawler", () => {
    const rules = robots().rules;
    const list = Array.isArray(rules) ? rules : [rules];
    const ai = list.find((rule) => Array.isArray(rule.userAgent));
    expect(ai?.userAgent).toEqual([...AI_CRAWLER_USER_AGENTS]);
    expect(ai).toMatchObject({ allow: "/", disallow: list[0].disallow });
    expect(AI_CRAWLER_USER_AGENTS).toEqual(
      expect.arrayContaining(["OAI-SearchBot", "PerplexityBot", "Claude-SearchBot"]),
    );
  });
});
