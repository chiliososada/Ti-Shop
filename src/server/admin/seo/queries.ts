import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { buildPagination, type SearchParameter } from "@/lib/pagination";
import { sanitizePublicAssetUrl } from "@/lib/public-asset-url";
import { managedPagePublicPath } from "@/lib/managed-page-routes";
import {
  ADMIN_SEO_PAGE_SIZE,
  parseAdminSeoFilters,
} from "@/server/admin/seo/filters";
import {
  seoRouteSchema,
  type SeoEntityType,
} from "@/server/admin/seo/validators";
import { publicIdSchema } from "@/server/admin/audit/validation";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

const seoSelect = {
  publicId: true,
  title: true,
  description: true,
  canonicalUrl: true,
  noIndex: true,
  updatedAt: true,
  openGraphMedia: { select: { publicId: true } },
} as const;

function seoSummary(
  seo: {
    title: string | null;
    description: string | null;
    canonicalUrl: string | null;
    noIndex: boolean;
    openGraphMedia: { publicId: string } | null;
  } | null,
) {
  return {
    isConfigured: Boolean(
      seo &&
        (seo.title !== null ||
          seo.description !== null ||
          seo.canonicalUrl !== null ||
          seo.openGraphMedia !== null ||
          seo.noIndex),
    ),
    noIndex: seo?.noIndex ?? false,
  };
}

export async function getAdminSeoIndex(
  searchParams: Record<string, SearchParameter> = {},
) {
  await requirePermission("seo.read", "/admin/seo");
  const { filters, validationError } = parseAdminSeoFilters(searchParams);
  const db = getDb();
  const paginationResult = (total: number) =>
    buildPagination(total, filters.page, ADMIN_SEO_PAGE_SIZE);
  const commonResult = (
    pagination: ReturnType<typeof buildPagination>,
  ) => ({
    filters: { ...filters, page: pagination.page },
    validationError,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      pageCount: pagination.pageCount,
      total: pagination.total,
    },
  });
  const seoSearch = filters.query
    ? {
        is: {
          OR: [
            {
              title: {
                contains: filters.query,
                mode: "insensitive" as const,
              },
            },
            {
              description: {
                contains: filters.query,
                mode: "insensitive" as const,
              },
            },
            {
              canonicalUrl: {
                contains: filters.query,
                mode: "insensitive" as const,
              },
            },
          ],
        },
      }
    : undefined;

  if (filters.entityType === "product") {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(filters.query
        ? {
            OR: [
              {
                title: {
                  contains: filters.query,
                  mode: "insensitive" as const,
                },
              },
              {
                slug: {
                  contains: filters.query,
                  mode: "insensitive" as const,
                },
              },
              { seo: seoSearch },
            ],
          }
        : {}),
    };
    const pagination = paginationResult(await db.product.count({ where }));
    const items = await db.product.findMany({
      where,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      skip: pagination.skip,
      take: pagination.pageSize,
      select: {
        publicId: true,
        slug: true,
        title: true,
        status: true,
        seo: { select: seoSelect },
      },
    });
    return {
      ...commonResult(pagination),
      records: items.map((item) => ({
        kind: "target" as const,
        entityType: "product" as const,
        publicId: item.publicId,
        slug: item.slug,
        label: item.title,
        status: item.status,
        publicPath: `/products/${item.slug}`,
        ...seoSummary(item.seo),
      })),
    };
  }

  if (filters.entityType === "category") {
    const where: Prisma.CategoryWhereInput = {
      deletedAt: null,
      ...(filters.query
        ? {
            OR: [
              {
                name: {
                  contains: filters.query,
                  mode: "insensitive" as const,
                },
              },
              {
                slug: {
                  contains: filters.query,
                  mode: "insensitive" as const,
                },
              },
              { seo: seoSearch },
            ],
          }
        : {}),
    };
    const pagination = paginationResult(await db.category.count({ where }));
    const items = await db.category.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: pagination.skip,
      take: pagination.pageSize,
      select: {
        publicId: true,
        slug: true,
        name: true,
        status: true,
        seo: { select: seoSelect },
      },
    });
    return {
      ...commonResult(pagination),
      records: items.map((item) => ({
        kind: "target" as const,
        entityType: "category" as const,
        publicId: item.publicId,
        slug: item.slug,
        label: item.name,
        status: item.status,
        publicPath: `/categories/${item.slug}`,
        ...seoSummary(item.seo),
      })),
    };
  }

  if (filters.entityType === "blog") {
    const where: Prisma.BlogPostWhereInput = {
      deletedAt: null,
      ...(filters.query
        ? {
            OR: [
              {
                title: {
                  contains: filters.query,
                  mode: "insensitive" as const,
                },
              },
              {
                slug: {
                  contains: filters.query,
                  mode: "insensitive" as const,
                },
              },
              { seo: seoSearch },
            ],
          }
        : {}),
    };
    const pagination = paginationResult(await db.blogPost.count({ where }));
    const items = await db.blogPost.findMany({
      where,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      skip: pagination.skip,
      take: pagination.pageSize,
      select: {
        publicId: true,
        slug: true,
        title: true,
        status: true,
        seo: { select: seoSelect },
      },
    });
    return {
      ...commonResult(pagination),
      records: items.map((item) => ({
        kind: "target" as const,
        entityType: "blog" as const,
        publicId: item.publicId,
        slug: item.slug,
        label: item.title,
        status: item.status,
        publicPath: `/blog/${item.slug}`,
        ...seoSummary(item.seo),
      })),
    };
  }

  if (filters.entityType === "page") {
    const where: Prisma.PageWhereInput = {
      deletedAt: null,
      ...(filters.query
        ? {
            OR: [
              {
                title: {
                  contains: filters.query,
                  mode: "insensitive" as const,
                },
              },
              {
                slug: {
                  contains: filters.query,
                  mode: "insensitive" as const,
                },
              },
              { seo: seoSearch },
            ],
          }
        : {}),
    };
    const pagination = paginationResult(await db.page.count({ where }));
    const items = await db.page.findMany({
      where,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      skip: pagination.skip,
      take: pagination.pageSize,
      select: {
        publicId: true,
        slug: true,
        managedRoute: true,
        title: true,
        status: true,
        seo: { select: seoSelect },
      },
    });
    return {
      ...commonResult(pagination),
      records: items.map((item) => ({
        kind: "target" as const,
        entityType: "page" as const,
        publicId: item.publicId,
        slug: item.slug,
        label: item.title,
        status: item.status,
        publicPath: managedPagePublicPath(item.managedRoute, item.slug),
        ...seoSummary(item.seo),
      })),
    };
  }

  const where: Prisma.RedirectWhereInput = filters.query
    ? {
        OR: [
          {
            sourcePath: {
              contains: filters.query,
              mode: "insensitive" as const,
            },
          },
          {
            destinationPath: {
              contains: filters.query,
              mode: "insensitive" as const,
            },
          },
        ],
      }
    : {};
  const pagination = paginationResult(await db.redirect.count({ where }));
  const redirects = await db.redirect.findMany({
    where,
    orderBy: [{ sourcePath: "asc" }, { id: "asc" }],
    skip: pagination.skip,
    take: pagination.pageSize,
    select: {
      publicId: true,
      sourcePath: true,
      destinationPath: true,
      statusCode: true,
      preserveQuery: true,
      isActive: true,
      startsAt: true,
      endsAt: true,
      hitCount: true,
      lastHitAt: true,
      updatedAt: true,
    },
  });
  return {
    ...commonResult(pagination),
    records: redirects.map((redirect) => ({
      kind: "redirect" as const,
      publicId: redirect.publicId,
      sourcePath: redirect.sourcePath,
      destinationPath: redirect.destinationPath,
      statusCode: redirect.statusCode,
      preserveQuery: redirect.preserveQuery,
      isActive: redirect.isActive,
      startsAt: redirect.startsAt?.toISOString() ?? null,
      endsAt: redirect.endsAt?.toISOString() ?? null,
      hitCount: redirect.hitCount.toString(),
      lastHitAt: redirect.lastHitAt?.toISOString() ?? null,
      updatedAt: redirect.updatedAt.toISOString(),
    })),
  };
}

function toTarget(
  entityType: SeoEntityType,
  item: {
    publicId: string;
    slug: string;
    label: string;
    managedRoute?: string | null;
    seo: {
      publicId: string;
      title: string | null;
      description: string | null;
      canonicalUrl: string | null;
      noIndex: boolean;
      updatedAt: Date;
      openGraphMedia: { publicId: string } | null;
    } | null;
  },
) {
  const prefix =
    entityType === "product"
      ? "/products"
      : entityType === "category"
        ? "/categories"
        : entityType === "blog"
          ? "/blog"
          : "/pages";

  const publicPath =
    entityType === "page"
      ? managedPagePublicPath(item.managedRoute, item.slug)
      : `${prefix}/${item.slug}`;

  return {
    entityType,
    targetPublicId: item.publicId,
    slug: item.slug,
    label: item.label,
    publicPath,
    isManagedPage: entityType === "page" && Boolean(item.managedRoute),
    fixedCanonicalPath:
      entityType === "page" && item.managedRoute ? publicPath : null,
    title: item.seo?.title ?? null,
    description: item.seo?.description ?? null,
    canonicalUrl: item.seo?.canonicalUrl ?? null,
    openGraphMediaPublicId: item.seo?.openGraphMedia?.publicId ?? null,
    noIndex: item.seo?.noIndex ?? false,
    updatedAt: item.seo?.updatedAt.toISOString() ?? null,
  };
}

const SEO_MEDIA_CANDIDATE_LIMIT = 50;
const SEO_MEDIA_SCAN_LIMIT = 200;
const eligibleMediaWhere = {
  kind: "IMAGE",
  isPrivate: false,
  deletedAt: null,
  publicUrl: { not: null },
} satisfies Prisma.MediaWhereInput;
const mediaCandidateSelect = {
  publicId: true,
  publicUrl: true,
  altText: true,
  width: true,
  height: true,
  updatedAt: true,
} as const;

function toOpenGraphMediaCandidate(media: {
  publicId: string;
  publicUrl: string | null;
  altText: string | null;
  width: number | null;
  height: number | null;
  updatedAt: Date;
}) {
  const url = sanitizePublicAssetUrl(media.publicUrl);
  if (!url) return null;

  return {
    publicId: media.publicId,
    url,
    label: media.altText?.trim() || `Image ${media.publicId.slice(0, 8)}`,
    width: media.width,
    height: media.height,
    updatedAt: media.updatedAt.toISOString(),
  };
}

async function withOpenGraphMediaCandidates(target: ReturnType<typeof toTarget>) {
  const db = getDb();
  const currentMedia = target.openGraphMediaPublicId
    ? db.media.findFirst({
        where: {
          ...eligibleMediaWhere,
          publicId: target.openGraphMediaPublicId,
        },
        select: mediaCandidateSelect,
      })
    : Promise.resolve(null);
  const recentMedia = db.media.findMany({
    where: eligibleMediaWhere,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: SEO_MEDIA_SCAN_LIMIT,
    select: mediaCandidateSelect,
  });
  const [current, recent] = await Promise.all([currentMedia, recentMedia]);
  const candidates = new Map<
    string,
    NonNullable<ReturnType<typeof toOpenGraphMediaCandidate>>
  >();

  for (const media of current ? [current, ...recent] : recent) {
    const candidate = toOpenGraphMediaCandidate(media);
    if (candidate && !candidates.has(candidate.publicId)) {
      candidates.set(candidate.publicId, candidate);
    }
    if (candidates.size === SEO_MEDIA_CANDIDATE_LIMIT) break;
  }

  return {
    ...target,
    openGraphMediaCandidates: [...candidates.values()],
  };
}

export async function getAdminSeoTarget(
  entityType: string,
  publicId: string,
) {
  await requirePermission(
    "seo.read",
    `/admin/seo/${encodeURIComponent(entityType)}/${encodeURIComponent(publicId)}`,
  );
  const route = seoRouteSchema.safeParse({ entityType, publicId });
  if (!route.success) return null;

  const db = getDb();
  if (route.data.entityType === "product") {
    const item = await db.product.findFirst({
      where: { publicId: route.data.publicId, deletedAt: null },
      select: {
        publicId: true,
        slug: true,
        title: true,
        seo: { select: seoSelect },
      },
    });
    return item
      ? withOpenGraphMediaCandidates(
          toTarget("product", { ...item, label: item.title }),
        )
      : null;
  }

  if (route.data.entityType === "category") {
    const item = await db.category.findFirst({
      where: { publicId: route.data.publicId, deletedAt: null },
      select: {
        publicId: true,
        slug: true,
        name: true,
        seo: { select: seoSelect },
      },
    });
    return item
      ? withOpenGraphMediaCandidates(
          toTarget("category", { ...item, label: item.name }),
        )
      : null;
  }

  if (route.data.entityType === "blog") {
    const item = await db.blogPost.findFirst({
      where: { publicId: route.data.publicId, deletedAt: null },
      select: {
        publicId: true,
        slug: true,
        title: true,
        seo: { select: seoSelect },
      },
    });
    return item
      ? withOpenGraphMediaCandidates(
          toTarget("blog", { ...item, label: item.title }),
        )
      : null;
  }

  const item = await db.page.findFirst({
    where: { publicId: route.data.publicId, deletedAt: null },
    select: {
      publicId: true,
      slug: true,
      managedRoute: true,
      title: true,
      seo: { select: seoSelect },
    },
  });
  return item
    ? withOpenGraphMediaCandidates(
        toTarget("page", { ...item, label: item.title }),
      )
    : null;
}

export async function getAdminRedirect(publicId: string) {
  await requirePermission(
    "seo.read",
    `/admin/seo/redirects/${encodeURIComponent(publicId)}`,
  );
  const parsed = publicIdSchema.safeParse(publicId);
  if (!parsed.success) return null;

  const redirect = await getDb().redirect.findUnique({
    where: { publicId: parsed.data },
    select: {
      publicId: true,
      sourcePath: true,
      destinationPath: true,
      statusCode: true,
      preserveQuery: true,
      isActive: true,
      startsAt: true,
      endsAt: true,
      hitCount: true,
      lastHitAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!redirect) return null;

  return {
    ...redirect,
    hitCount: redirect.hitCount.toString(),
    startsAt: redirect.startsAt?.toISOString() ?? null,
    endsAt: redirect.endsAt?.toISOString() ?? null,
    lastHitAt: redirect.lastHitAt?.toISOString() ?? null,
    createdAt: redirect.createdAt.toISOString(),
    updatedAt: redirect.updatedAt.toISOString(),
  };
}
