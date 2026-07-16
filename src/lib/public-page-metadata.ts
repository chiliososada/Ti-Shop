import type { Metadata } from "next";

import { company } from "@/data/company";
import type { PublicImageDto } from "@/domain/public";

export const DEFAULT_OPEN_GRAPH_IMAGE = {
  url: "/video/hero-poster.jpg",
  width: 1920,
  height: 1080,
  alt: "sheng.an research material catalog",
} as const;

export function publicPageTitle(title: string) {
  const suffix = ` | ${company.name}`;
  return title.startsWith(`${company.name} |`) || title.endsWith(suffix)
    ? title
    : `${title}${suffix}`;
}

type PublicPageMetadataInput = {
  title: string;
  description: string;
  canonical: string;
  robots?: Metadata["robots"];
  openGraphImage?: PublicImageDto | null;
};

/**
 * Builds a complete, route-owned metadata set. Next.js shallowly merges nested
 * metadata, so every indexable page must own its Open Graph title, description
 * and URL instead of inheriting the home page's values.
 */
export function createPublicPageMetadata({
  title,
  description,
  canonical,
  robots,
  openGraphImage,
}: PublicPageMetadataInput): Metadata {
  const resolvedTitle = publicPageTitle(title);
  const image = openGraphImage
    ? {
        url: openGraphImage.url,
        alt: openGraphImage.alt,
        ...(openGraphImage.width ? { width: openGraphImage.width } : {}),
        ...(openGraphImage.height ? { height: openGraphImage.height } : {}),
      }
    : DEFAULT_OPEN_GRAPH_IMAGE;

  return {
    title: { absolute: resolvedTitle },
    description,
    alternates: { canonical },
    ...(robots ? { robots } : {}),
    openGraph: {
      type: "website",
      siteName: company.name,
      title: resolvedTitle,
      description,
      url: canonical,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: resolvedTitle,
      description,
      images: [image.url],
    },
  };
}
