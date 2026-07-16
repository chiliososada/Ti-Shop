import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { buildPagination, type SearchParameter } from "@/lib/pagination";
import { publicIdSchema } from "@/server/admin/audit/validation";
import {
  ADMIN_CATALOG_PAGE_SIZE,
  parseAdminCatalogFilters,
} from "@/server/admin/catalog/filters";
import { MAX_IMAGES_PER_PRODUCT } from "@/server/admin/catalog/product-images/mutations";
import { normalizeCatalogMediaSource } from "@/server/admin/catalog/validators";
import { requirePermission } from "@/server/auth/rbac";
import { productImageRenditionUrls } from "@/server/catalog/product-images/urls";
import { getDb } from "@/server/db/client";
import { getStorageConfigState } from "@/server/storage/config";

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

function minorToUsdInput(amountMinor: bigint) {
  const whole = amountMinor / BigInt(100);
  const cents = (amountMinor % BigInt(100)).toString().padStart(2, "0");
  return `${whole.toString()}.${cents}`;
}

function currentUsdPrice<
  T extends {
    amountMinor: bigint;
    countryCode: string | null;
    kind: string;
    startsAt: Date | null;
    endsAt: Date | null;
    createdAt: Date;
  },
>(prices: readonly T[], now: Date) {
  return [...prices]
    .filter(
      (price) =>
        (price.countryCode === "US" || price.countryCode === null) &&
        (price.startsAt === null || price.startsAt <= now) &&
        (price.endsAt === null || price.endsAt > now),
    )
    .sort((left, right) => {
      const country =
        Number(right.countryCode === "US") - Number(left.countryCode === "US");
      if (country !== 0) return country;
      const kind = Number(right.kind === "SALE") - Number(left.kind === "SALE");
      if (kind !== 0) return kind;
      return right.createdAt.getTime() - left.createdAt.getTime();
    })[0];
}

function editableOptionValues(value: Prisma.JsonValue) {
  let minimumOrderQuantity = 1;
  const options: Record<string, string | number | boolean | null> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "minimumOrderQuantity") {
        if (
          typeof item === "number" &&
          Number.isSafeInteger(item) &&
          item >= 1 &&
          item <= 99
        ) {
          minimumOrderQuantity = item;
        }
        continue;
      }
      if (
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean" ||
        item === null
      ) {
        options[key] = item;
      }
    }
  }
  return {
    minimumOrderQuantity,
    optionValues: JSON.stringify(options, null, 2),
  };
}

export async function getAdminCatalogIndex(
  searchParams: Record<string, SearchParameter> = {},
) {
  await requirePermission("catalog.read", "/admin/catalog");
  const { filters, validationError } = parseAdminCatalogFilters(searchParams);
  const db = getDb();
  const productWhere: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(filters.productQuery
      ? {
          OR: [
            {
              title: {
                contains: filters.productQuery,
                mode: "insensitive" as const,
              },
            },
            {
              slug: {
                contains: filters.productQuery,
                mode: "insensitive" as const,
              },
            },
            {
              subtitle: {
                contains: filters.productQuery,
                mode: "insensitive" as const,
              },
            },
            {
              brand: {
                contains: filters.productQuery,
                mode: "insensitive" as const,
              },
            },
            {
              casNumber: {
                contains: filters.productQuery,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };
  const categoryWhere: Prisma.CategoryWhereInput = {
    deletedAt: null,
    ...(filters.categoryQuery
      ? {
          OR: [
            {
              name: {
                contains: filters.categoryQuery,
                mode: "insensitive" as const,
              },
            },
            {
              slug: {
                contains: filters.categoryQuery,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };
  const [productTotal, categoryTotal] = await Promise.all([
    db.product.count({ where: productWhere }),
    db.category.count({ where: categoryWhere }),
  ]);
  const productPagination = buildPagination(
    productTotal,
    filters.productPage,
    ADMIN_CATALOG_PAGE_SIZE,
  );
  const categoryPagination = buildPagination(
    categoryTotal,
    filters.categoryPage,
    ADMIN_CATALOG_PAGE_SIZE,
  );
  const [products, categories] = await Promise.all([
    db.product.findMany({
      where: productWhere,
      orderBy: [{ position: "asc" }, { title: "asc" }, { id: "asc" }],
      skip: productPagination.skip,
      take: productPagination.pageSize,
      select: {
        publicId: true,
        slug: true,
        title: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        _count: { select: { variants: { where: { deletedAt: null } } } },
      },
    }),
    db.category.findMany({
      where: categoryWhere,
      orderBy: [{ position: "asc" }, { name: "asc" }, { id: "asc" }],
      skip: categoryPagination.skip,
      take: categoryPagination.pageSize,
      select: {
        publicId: true,
        slug: true,
        name: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        _count: { select: { products: true } },
      },
    }),
  ]);

  return {
    filters: {
      ...filters,
      productPage: productPagination.page,
      categoryPage: categoryPagination.page,
    },
    validationError,
    productPagination: {
      page: productPagination.page,
      pageSize: productPagination.pageSize,
      pageCount: productPagination.pageCount,
      total: productPagination.total,
    },
    categoryPagination: {
      page: categoryPagination.page,
      pageSize: categoryPagination.pageSize,
      pageCount: categoryPagination.pageCount,
      total: categoryPagination.total,
    },
    products: products.map((product) => ({
      publicId: product.publicId,
      slug: product.slug,
      title: product.title,
      status: product.status,
      publishedAt: iso(product.publishedAt),
      updatedAt: product.updatedAt.toISOString(),
      variantCount: product._count.variants,
    })),
    categories: categories.map((category) => ({
      publicId: category.publicId,
      slug: category.slug,
      name: category.name,
      status: category.status,
      publishedAt: iso(category.publishedAt),
      updatedAt: category.updatedAt.toISOString(),
      productCount: category._count.products,
    })),
  };
}

export async function getAdminProduct(publicId: string) {
  await requirePermission(
    "catalog.read",
    `/admin/catalog/products/${encodeURIComponent(publicId)}`,
  );
  const parsedId = publicIdSchema.safeParse(publicId);
  if (!parsedId.success) return null;

  const db = getDb();
  const [product, availableCategories, availableTags, mediaLibrary] = await Promise.all([
    db.product.findFirst({
      where: { publicId: parsedId.data, deletedAt: null },
      select: {
        publicId: true,
        slug: true,
        title: true,
        subtitle: true,
        shortDescription: true,
        description: true,
        brand: true,
        purity: true,
        casNumber: true,
        appearance: true,
        storageInstructions: true,
        status: true,
        isFeatured: true,
        position: true,
        publishedAt: true,
        updatedAt: true,
        categories: {
          orderBy: [{ position: "asc" }, { categoryId: "asc" }],
          select: {
            position: true,
            category: {
              select: { publicId: true, slug: true, name: true, status: true },
            },
          },
        },
        tags: {
          orderBy: [{ tagId: "asc" }],
          select: {
            tag: {
              select: {
                publicId: true,
                slug: true,
                name: true,
                status: true,
              },
            },
          },
        },
        variants: {
          where: { deletedAt: null },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: {
            publicId: true,
            sku: true,
            title: true,
            priceMode: true,
            status: true,
            optionValues: true,
            trackInventory: true,
            position: true,
            publishedAt: true,
            prices: {
              where: { currency: "USD", isActive: true, deletedAt: null },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: {
                amountMinor: true,
                countryCode: true,
                kind: true,
                startsAt: true,
                endsAt: true,
                createdAt: true,
              },
            },
          },
        },
        media: {
          orderBy: [{ role: "asc" }, { position: "asc" }, { id: "asc" }],
          select: {
            role: true,
            position: true,
            variant: { select: { publicId: true, title: true } },
            media: {
              select: {
                publicId: true,
                kind: true,
                publicUrl: true,
                altText: true,
                title: true,
                originalFilename: true,
                width: true,
                height: true,
                uploadStatus: true,
                variants: true,
                bucket: true,
                isPrivate: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    }),
    db.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: "asc" }, { name: "asc" }, { id: "asc" }],
      take: 200,
      select: { publicId: true, slug: true, name: true, status: true },
    }),
    db.tag.findMany({
      where: { deletedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 201,
      select: { publicId: true, slug: true, name: true, status: true },
    }),
    db.media.findMany({
      where: {
        deletedAt: null,
        isPrivate: false,
        publicUrl: { not: null },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 500,
      select: {
        publicId: true,
        kind: true,
        publicUrl: true,
        altText: true,
      },
    }),
  ]);
  if (!product) return null;

  const now = new Date();
  const assignedCategories = product.categories.map((relation, index) => ({
    ...relation.category,
    position: relation.position,
    primary: index === 0,
  }));
  const assignedTags = product.tags.map(({ tag }) => tag);
  const mergedTags = new Map(
    [...assignedTags, ...availableTags.slice(0, 200)].map((tag) => [
      tag.publicId,
      tag,
    ]),
  );
  return {
    publicId: product.publicId,
    slug: product.slug,
    title: product.title,
    subtitle: product.subtitle,
    shortDescription: product.shortDescription,
    description: product.description,
    brand: product.brand,
    purity: product.purity,
    casNumber: product.casNumber,
    appearance: product.appearance,
    storageInstructions: product.storageInstructions,
    status: product.status,
    isFeatured: product.isFeatured,
    position: product.position,
    publishedAt: iso(product.publishedAt),
    updatedAt: product.updatedAt.toISOString(),
    assignedCategories,
    primaryCategoryPublicId: assignedCategories[0]?.publicId ?? null,
    availableCategories,
    assignedTags,
    availableTags: [...mergedTags.values()].sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.publicId.localeCompare(right.publicId),
    ),
    availableTagsTruncated: availableTags.length > 200,
    variants: product.variants.map((variant) => {
      const price = currentUsdPrice(variant.prices, now);
      return {
        publicId: variant.publicId,
        sku: variant.sku,
        title: variant.title,
        priceMode: variant.priceMode,
        status: variant.status,
        position: variant.position,
        trackInventory: variant.trackInventory,
        publishedAt: iso(variant.publishedAt),
        usdPrice: price ? minorToUsdInput(price.amountMinor) : "",
        ...editableOptionValues(variant.optionValues),
      };
    }),
    media: product.media
      .filter(
        (relation) =>
          relation.media.deletedAt === null &&
          !relation.media.isPrivate &&
          relation.media.bucket === null &&
          relation.media.publicUrl !== null &&
          normalizeCatalogMediaSource(relation.media.publicUrl) !== null &&
          // Product-level primary/gallery images are managed by the image
          // manager; this list keeps variant-scoped, swatch, video, and
          // document references.
          !(
            relation.variant === null &&
            relation.media.kind === "IMAGE" &&
            (relation.role === "PRIMARY" || relation.role === "GALLERY")
          ),
      )
      .map((relation) => ({
        mediaPublicId: relation.media.publicId,
        kind: relation.media.kind,
        sourceUrl: relation.media.publicUrl!,
        altText: relation.media.altText,
        role: relation.role,
        position: relation.position,
        variantPublicId: relation.variant?.publicId ?? null,
        variantTitle: relation.variant?.title ?? null,
      })),
    // Every product-level image link (uploaded and legacy) is managed by the
    // interactive image manager so ordering and the primary flag stay
    // consistent with the storefront gallery. Non-image media (videos,
    // documents) stay in `media` above.
    images: product.media
      .filter(
        (relation) =>
          relation.variant === null &&
          relation.media.deletedAt === null &&
          !relation.media.isPrivate &&
          relation.media.kind === "IMAGE" &&
          (relation.role === "PRIMARY" || relation.role === "GALLERY"),
      )
      .sort((left, right) => left.position - right.position)
      .map((relation) => ({
        mediaPublicId: relation.media.publicId,
        role: relation.role === "PRIMARY" ? ("PRIMARY" as const) : ("GALLERY" as const),
        position: relation.position,
        altText: relation.media.altText,
        title: relation.media.title,
        originalFilename: relation.media.originalFilename,
        width: relation.media.width,
        height: relation.media.height,
        uploadStatus: relation.media.uploadStatus,
        urls: productImageRenditionUrls({
          publicUrl: relation.media.publicUrl,
          variants: relation.media.variants,
        }),
      })),
    storage: (() => {
      const state = getStorageConfigState();
      return state.configured
        ? {
            configured: true as const,
            maxBytes: state.env.productImageMaxBytes,
            allowedTypes: [...state.env.productImageAllowedTypes],
            maxImagesPerProduct: MAX_IMAGES_PER_PRODUCT,
          }
        : { configured: false as const, reason: state.reason };
    })(),
    mediaLibrary: mediaLibrary.flatMap((media) => {
      const sourceUrl = media.publicUrl
        ? normalizeCatalogMediaSource(media.publicUrl)
        : null;
      return sourceUrl
        ? [{ ...media, publicUrl: sourceUrl }]
        : [];
    }),
  };
}

export async function getAdminCategory(publicId: string) {
  await requirePermission(
    "catalog.read",
    `/admin/catalog/categories/${encodeURIComponent(publicId)}`,
  );
  const parsedId = publicIdSchema.safeParse(publicId);
  if (!parsedId.success) return null;

  const category = await getDb().category.findFirst({
    where: { publicId: parsedId.data, deletedAt: null },
    select: {
      publicId: true,
      slug: true,
      name: true,
      description: true,
      status: true,
      position: true,
      publishedAt: true,
      updatedAt: true,
      _count: { select: { products: true } },
      products: {
        orderBy: [{ position: "asc" }, { productId: "asc" }],
        take: 500,
        select: {
          product: { select: { publicId: true, slug: true, title: true, status: true } },
        },
      },
    },
  });
  if (!category) return null;

  return {
    publicId: category.publicId,
    slug: category.slug,
    name: category.name,
    description: category.description,
    status: category.status,
    position: category.position,
    publishedAt: iso(category.publishedAt),
    updatedAt: category.updatedAt.toISOString(),
    productCount: category._count.products,
    products: category.products.map(({ product }) => product),
  };
}

export async function getAdminCatalogExportRows() {
  await requirePermission("catalog.read", "/admin/catalog");
  const products = await getDb().product.findMany({
    where: { deletedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: 10_000,
    select: {
      publicId: true,
      slug: true,
      title: true,
      status: true,
      publishedAt: true,
      categories: {
        orderBy: [{ position: "asc" }, { categoryId: "asc" }],
        select: { category: { select: { slug: true } } },
      },
      variants: {
        where: { deletedAt: null },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          publicId: true,
          title: true,
          sku: true,
          status: true,
          priceMode: true,
          trackInventory: true,
          position: true,
          publishedAt: true,
          optionValues: true,
          prices: {
            where: { currency: "USD", isActive: true, deletedAt: null },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
              amountMinor: true,
              countryCode: true,
              kind: true,
              startsAt: true,
              endsAt: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });
  const now = new Date();
  return products.flatMap((product) =>
    product.variants.length
      ? product.variants.map((variant) => {
          const price = currentUsdPrice(variant.prices, now);
          const options = editableOptionValues(variant.optionValues);
          return {
            productPublicId: product.publicId,
            productSlug: product.slug,
            productTitle: product.title,
            productStatus: product.status,
            productPublishedAt: iso(product.publishedAt) ?? "",
            primaryCategorySlug: product.categories[0]?.category.slug ?? "",
            categorySlugs: product.categories.map(({ category }) => category.slug).join("|"),
            variantPublicId: variant.publicId,
            variantTitle: variant.title,
            sku: variant.sku ?? "",
            variantStatus: variant.status,
            variantPublishedAt: iso(variant.publishedAt) ?? "",
            priceMode: variant.priceMode,
            usdPrice: price ? minorToUsdInput(price.amountMinor) : "",
            minimumOrderQuantity: String(options.minimumOrderQuantity),
            trackInventory: variant.trackInventory ? "true" : "false",
            position: String(variant.position),
            optionValues: options.optionValues.replaceAll("\n", ""),
          };
        })
      : [
          {
            productPublicId: product.publicId,
            productSlug: product.slug,
            productTitle: product.title,
            productStatus: product.status,
            productPublishedAt: iso(product.publishedAt) ?? "",
            primaryCategorySlug: product.categories[0]?.category.slug ?? "",
            categorySlugs: product.categories.map(({ category }) => category.slug).join("|"),
            variantPublicId: "",
            variantTitle: "",
            sku: "",
            variantStatus: "",
            variantPublishedAt: "",
            priceMode: "",
            usdPrice: "",
            minimumOrderQuantity: "",
            trackInventory: "",
            position: "",
            optionValues: "",
          },
        ],
  );
}
