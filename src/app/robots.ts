import type { MetadataRoute } from "next";
import { AI_CRAWLER_USER_AGENTS } from "@/lib/ai-crawlers";
import { resolvePublicSiteOrigin } from "@/lib/site-url";

const DISALLOW = [
  "/api/",
  "/admin",
  "/account",
  "/checkout",
  "/login",
  "/register",
];

export default function robots(): MetadataRoute.Robots {
  const siteOrigin = resolvePublicSiteOrigin();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      // A user-agent group replaces the "*" group for that crawler, so it
      // repeats the same rules.
      { userAgent: [...AI_CRAWLER_USER_AGENTS], allow: "/", disallow: DISALLOW },
    ],
    sitemap: `${siteOrigin}/sitemap.xml`,
    host: siteOrigin,
  };
}
