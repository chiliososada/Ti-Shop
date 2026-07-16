import "server-only";

import { cache } from "react";

import type { ManagedPageRoute } from "@/generated/prisma/client";
import type { PublicSeoDto } from "@/domain/public";
import {
  inspectManagedPageBody,
  parseManagedPageContent,
} from "@/lib/managed-page-content";
import {
  getManagedPageDefinition,
  type ManagedPageRouteKey,
} from "@/lib/managed-page-routes";
import { publicSeoSelect } from "@/server/catalog/query-contracts";
import { mapPublicSeo, toIsoString } from "@/server/catalog/shared-mappers";
import { getDb } from "@/server/db/client";

export type PublicManagedPage = {
  publicId: string;
  routeKey: ManagedPageRouteKey;
  title: string;
  body: string;
  publishedAt: string;
  updatedAt: string;
  seo: ReturnType<typeof mapPublicSeo>;
};

export type ManagedPageSitemapState = {
  path: string;
  lastModified: string;
  noIndex: boolean;
};

function isUsableManagedPage(row: {
  managedRoute: ManagedPageRoute | null;
  title: string;
  body: string;
  publishedAt: Date | null;
  updatedAt: Date;
}) {
  const definition = row.managedRoute
    ? getManagedPageDefinition(row.managedRoute)
    : null;
  const title = row.title.trim();
  const publishedAt = toIsoString(row.publishedAt);
  const updatedAt = toIsoString(row.updatedAt);
  const content = parseManagedPageContent(row.body);

  return definition &&
    title.length > 0 &&
    title.length <= 255 &&
    inspectManagedPageBody(title) === null &&
    publishedAt &&
    updatedAt &&
    content
    ? { definition, title, publishedAt, updatedAt }
    : null;
}

function sanitizeManagedPageSeo(seo: PublicSeoDto | null): PublicSeoDto | null {
  if (!seo) return null;
  return {
    ...seo,
    title:
      seo.title && inspectManagedPageBody(seo.title) === null
        ? seo.title
        : null,
    description:
      seo.description && inspectManagedPageBody(seo.description) === null
        ? seo.description
        : null,
  };
}

export const getPublicManagedPage = cache(
  async (routeKey: ManagedPageRouteKey): Promise<PublicManagedPage | null> => {
    const row = await getDb().page.findFirst({
      where: {
        managedRoute: routeKey as ManagedPageRoute,
        status: "PUBLISHED",
        deletedAt: null,
        publishedAt: { not: null, lte: new Date() },
      },
      select: {
        publicId: true,
        managedRoute: true,
        title: true,
        body: true,
        publishedAt: true,
        updatedAt: true,
        seo: { select: publicSeoSelect },
      },
    });
    if (!row) return null;

    const usable = isUsableManagedPage(row);
    if (!usable) return null;

    return {
      publicId: row.publicId,
      routeKey: usable.definition.routeKey,
      title: usable.title,
      body: row.body,
      publishedAt: usable.publishedAt,
      updatedAt: usable.updatedAt,
      seo: sanitizeManagedPageSeo(mapPublicSeo(row.seo)),
    };
  },
);

export async function getPublishedManagedPageSitemapStates(): Promise<
  ManagedPageSitemapState[]
> {
  const rows = await getDb().page.findMany({
    where: {
      managedRoute: { not: null },
      status: "PUBLISHED",
      deletedAt: null,
      publishedAt: { not: null, lte: new Date() },
    },
    orderBy: { managedRoute: "asc" },
    take: 7,
    select: {
      managedRoute: true,
      title: true,
      body: true,
      publishedAt: true,
      updatedAt: true,
      seo: { select: { noIndex: true } },
    },
  });

  return rows.flatMap((row): ManagedPageSitemapState[] => {
    const usable = isUsableManagedPage(row);
    return usable
      ? [
          {
            path: usable.definition.path,
            lastModified: usable.updatedAt,
            noIndex: row.seo?.noIndex ?? false,
          },
        ]
      : [];
  });
}
