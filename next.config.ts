import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // The importer enforces a 2 MiB file limit. Leave bounded room for the
    // multipart boundary and Server Action metadata described by Next 16.
    serverActions: { bodySizeLimit: "2150kb" },
  },
  async headers() {
    // Catalog imagery and brand media live in public/ and are safe to cache at
    // the edge and in browsers for a day; a regenerated file is picked up
    // within that window through stale-while-revalidate.
    const staticMediaCache = {
      key: "Cache-Control",
      value: "public, max-age=86400, stale-while-revalidate=604800",
    };
    const mediaSources = [
      "/products/:file(.*\\.webp|.*\\.jpg|.*\\.jpeg|.*\\.png|.*\\.avif)",
      "/categories/:file(.*\\.webp|.*\\.jpg|.*\\.jpeg|.*\\.png|.*\\.avif)",
      "/brand/:path*",
      "/video/:path*",
    ];
    return [
      ...mediaSources.map((source) => ({
        source,
        headers: [staticMediaCache],
      })),
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
