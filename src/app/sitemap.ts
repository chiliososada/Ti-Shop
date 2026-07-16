import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { company } from "@/data/company";
import type { PublicCatalogSitemapEntryDto } from "@/domain/catalog";
import type {
  PublicBlogSitemapEntryDto,
  PublicPageSitemapEntryDto,
} from "@/domain/content";
import type { PublicSitemapEntryDto } from "@/domain/public";
import { normalizeCanonicalUrl } from "@/lib/canonical-url";
import { resolvePublicSiteOrigin } from "@/lib/site-url";
import { getPublicCatalogSitemapEntries } from "@/server/catalog";
import {
  getPublicBlogSitemapEntries,
  getPublishedManagedPageSitemapStates,
  getPublicPageSitemapEntries,
} from "@/server/content";
import type { ManagedPageSitemapState } from "@/server/content/public-managed-pages";

const STATIC_PATHS = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/products", changeFrequency: "weekly", priority: 0.9 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/blog", changeFrequency: "weekly", priority: 0.7 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.5 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.5 },
  { path: "/shipping", changeFrequency: "monthly", priority: 0.5 },
  { path: "/returns", changeFrequency: "monthly", priority: 0.5 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.4 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.4 },
  { path: "/payment-policy", changeFrequency: "monthly", priority: 0.5 },
  { path: "/research-use", changeFrequency: "yearly", priority: 0.5 },
] as const;

function absoluteUrl(path: string, baseUrl: string) {
  return new URL(path, `${baseUrl.replace(/\/+$/u, "")}/`).toString();
}

function resolveSameSiteSitemapUrl(
  entry: PublicSitemapEntryDto,
  siteOrigin: string,
) {
  const defaultPath = normalizeCanonicalUrl(entry.path);
  if (!defaultPath) return null;

  const canonicalUrl = entry.canonicalUrl
    ? normalizeCanonicalUrl(entry.canonicalUrl)
    : null;
  const candidate = canonicalUrl ?? defaultPath;

  try {
    const resolved = new URL(candidate, `${siteOrigin}/`);
    return resolved.origin === siteOrigin ? resolved.toString() : null;
  } catch {
    return null;
  }
}

function laterLastModified(
  left: MetadataRoute.Sitemap[number]["lastModified"],
  right: MetadataRoute.Sitemap[number]["lastModified"],
) {
  if (left === undefined) return right;
  if (right === undefined) return left;

  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (!Number.isFinite(leftTime)) return right;
  if (!Number.isFinite(rightTime)) return left;
  return rightTime > leftTime ? right : left;
}

function deduplicateSitemap(
  entries: MetadataRoute.Sitemap,
): MetadataRoute.Sitemap {
  const byUrl = new Map<string, MetadataRoute.Sitemap[number]>();

  for (const entry of entries) {
    const existing = byUrl.get(entry.url);
    if (!existing) {
      byUrl.set(entry.url, entry);
      continue;
    }

    byUrl.set(entry.url, {
      ...existing,
      lastModified: laterLastModified(
        existing.lastModified,
        entry.lastModified,
      ),
      priority: Math.max(existing.priority ?? 0, entry.priority ?? 0),
    });
  }

  return [...byUrl.values()];
}

export function buildPublicSitemap(
  catalogEntries: readonly PublicCatalogSitemapEntryDto[],
  blogEntries: readonly PublicBlogSitemapEntryDto[],
  baseUrl: string = company.url,
  pageEntries: readonly PublicPageSitemapEntryDto[] = [],
  managedPageStates: readonly ManagedPageSitemapState[] = [],
): MetadataRoute.Sitemap {
  const siteOrigin = new URL(baseUrl).origin;
  const managedByPath = new Map(
    managedPageStates.map((state) => [state.path, state]),
  );
  const staticPages: MetadataRoute.Sitemap = STATIC_PATHS.flatMap((entry) => {
    const managed = managedByPath.get(entry.path);
    return managed?.noIndex
      ? []
      : [{
          url: absoluteUrl(entry.path, siteOrigin),
          ...(managed ? { lastModified: managed.lastModified } : {}),
          changeFrequency: entry.changeFrequency,
          priority: entry.priority,
        }];
  });
  const categoryPages: MetadataRoute.Sitemap = catalogEntries
    .filter((entry) => entry.kind === "category")
    .flatMap((entry) => {
      const url = resolveSameSiteSitemapUrl(entry, siteOrigin);
      return url
        ? [{
            url,
            lastModified: entry.lastModified,
            changeFrequency: "weekly" as const,
            priority: 0.8,
          }]
        : [];
    });
  const productPages: MetadataRoute.Sitemap = catalogEntries
    .filter((entry) => entry.kind === "product")
    .flatMap((entry) => {
      const url = resolveSameSiteSitemapUrl(entry, siteOrigin);
      return url
        ? [{
            url,
            lastModified: entry.lastModified,
            changeFrequency: "monthly" as const,
            priority: 0.7,
          }]
        : [];
    });
  const blogPages: MetadataRoute.Sitemap = blogEntries.flatMap((entry) => {
    const url = resolveSameSiteSitemapUrl(entry, siteOrigin);
    return url
      ? [{
          url,
          lastModified: entry.lastModified,
          changeFrequency: "monthly" as const,
          priority: 0.6,
        }]
      : [];
  });
  const contentPages: MetadataRoute.Sitemap = pageEntries.flatMap((entry) => {
    const url = resolveSameSiteSitemapUrl(entry, siteOrigin);
    return url
      ? [{
          url,
          lastModified: entry.lastModified,
          changeFrequency: "monthly" as const,
          priority: 0.5,
        }]
      : [];
  });
  return deduplicateSitemap([
    ...staticPages,
    ...categoryPages,
    ...productPages,
    ...blogPages,
    ...contentPages,
  ]);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const [
    catalogEntries,
    blogEntries,
    pageEntries,
    managedPageStates,
  ] = await Promise.all([
    getPublicCatalogSitemapEntries(),
    getPublicBlogSitemapEntries(),
    getPublicPageSitemapEntries(),
    getPublishedManagedPageSitemapStates(),
  ]);
  return buildPublicSitemap(
    catalogEntries,
    blogEntries,
    resolvePublicSiteOrigin(),
    pageEntries,
    managedPageStates,
  );
}
