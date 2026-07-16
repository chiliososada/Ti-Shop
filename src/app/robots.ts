import type { MetadataRoute } from "next";
import { resolvePublicSiteOrigin } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const siteOrigin = resolvePublicSiteOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/account",
        "/checkout",
        "/login",
        "/register",
      ],
    },
    sitemap: `${siteOrigin}/sitemap.xml`,
    host: siteOrigin,
  };
}
