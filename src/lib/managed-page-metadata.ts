import type { Metadata } from "next";

import type { PublicSearchParams } from "@/app/_lib/public-seo";
import { publicRobots } from "@/app/_lib/public-seo";
import type { ManagedPageDefinition } from "@/lib/managed-page-routes";
import { createPublicPageMetadata } from "@/lib/public-page-metadata";
import type { PublicManagedPage } from "@/server/content/public-managed-pages";

export function createManagedPageMetadata(
  definition: ManagedPageDefinition,
  page: PublicManagedPage | null,
  searchParams: PublicSearchParams = {},
): Metadata {
  return createPublicPageMetadata({
    title:
      page?.seo?.title ?? page?.title ?? definition.fallbackSeoTitle,
    description:
      page?.seo?.description ?? definition.fallbackDescription,
    // A managed policy page always owns its fixed, existing storefront URL.
    // A legacy/direct database canonical can never move it elsewhere.
    canonical: definition.path,
    robots: publicRobots(searchParams, {
      noIndex: page?.seo?.noIndex,
      noFollow: page?.seo?.noFollow,
    }),
    openGraphImage: page?.seo?.openGraphImage,
  });
}
