import "server-only";

import type { ManagedPageRoute } from "@/generated/prisma/client";
import {
  getManagedPageDefinitionByAdminSlug,
  MANAGED_PAGE_DEFINITIONS,
} from "@/lib/managed-page-routes";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

export async function getAdminManagedPageIndex() {
  await requirePermission("content.read", "/admin/content/managed-pages");
  const rows = await getDb().page.findMany({
    where: { managedRoute: { not: null } },
    orderBy: { managedRoute: "asc" },
    take: 7,
    select: {
      publicId: true,
      managedRoute: true,
      title: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
      seo: {
        select: {
          title: true,
          description: true,
          canonicalUrl: true,
          noIndex: true,
          openGraphMediaId: true,
        },
      },
    },
  });
  const byRoute = new Map(
    rows.flatMap((row) =>
      row.managedRoute ? [[row.managedRoute, row] as const] : [],
    ),
  );

  return MANAGED_PAGE_DEFINITIONS.map((definition) => {
    const row = byRoute.get(definition.routeKey as ManagedPageRoute);
    return {
      ...definition,
      configured: Boolean(row),
      publicId: row?.publicId ?? null,
      title: row?.title ?? definition.fallbackTitle,
      status: row?.status ?? "FALLBACK",
      publishedAt: iso(row?.publishedAt ?? null),
      updatedAt: iso(row?.updatedAt ?? null),
      seoConfigured: Boolean(
        row?.seo &&
          (row.seo.title !== null ||
            row.seo.description !== null ||
            row.seo.canonicalUrl !== null ||
            row.seo.noIndex ||
            row.seo.openGraphMediaId !== null),
      ),
    };
  });
}

export async function getAdminManagedPage(adminSlug: string) {
  const definition = getManagedPageDefinitionByAdminSlug(adminSlug);
  if (!definition) return null;
  await requirePermission(
    "content.read",
    `/admin/content/managed-pages/${encodeURIComponent(adminSlug)}`,
  );

  const page = await getDb().page.findUnique({
    where: {
      managedRoute: definition.routeKey as ManagedPageRoute,
    },
    select: {
      publicId: true,
      title: true,
      body: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
    },
  });

  return {
    definition,
    page: page
      ? {
          ...page,
          publishedAt: iso(page.publishedAt),
          updatedAt: page.updatedAt.toISOString(),
        }
      : null,
  };
}
