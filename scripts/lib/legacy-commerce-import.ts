import type { PrismaClient } from "../../src/generated/prisma/client";
import {
  CatalogStatus,
  ContentFormat,
  ContentStatus,
  DataQualityStatus,
  MediaKind,
  PriceKind,
  PriceMode,
  Prisma,
  ProductMediaRole,
} from "../../src/generated/prisma/client";
import type { BlogPost } from "../../src/data/blog";
import type { Category } from "../../src/data/categories";

import {
  allAssetMap,
  blogBlocksToMarkdown,
  blogCanonicalUrl,
  categoryCanonicalUrl,
  findDuplicateCasGroups,
  LEGACY_IMPORT_VERSION,
  LEGACY_PUBLISHED_AT,
  parseLegacyDate,
  parseReadingMinutes,
  productCanonicalUrl,
  publicUrls,
  sourceHash,
  stableStringify,
  usdToMinor,
  type AssetAudit,
  type AssetMode,
  type AssetRecord,
  type LegacyCommerceSource,
  type LegacyFaq,
  type LegacyProduct,
} from "./legacy-commerce-source";

type TransactionClient = Prisma.TransactionClient;

type MutationCounter = {
  created: number;
  updated: number;
  unchanged: number;
};

export type ImportMutations = {
  categories: MutationCounter;
  products: MutationCounter;
  variants: MutationCounter;
  prices: MutationCounter;
  media: MutationCounter;
  productMedia: MutationCounter;
  productCategories: MutationCounter;
  seo: MutationCounter;
  blogs: MutationCounter;
  faqs: MutationCounter;
  placements: MutationCounter;
  pruned: number;
};

export type LegacyImportReport = {
  reportVersion: number;
  status: "ok";
  assetMode: AssetMode;
  source: {
    categories: number;
    products: number;
    blogs: number;
    faqs: number;
    pricedProducts: number;
    onRequestProducts: number;
    productsWithoutCas: number;
    duplicateCasGroups: ReturnType<typeof findDuplicateCasGroups>;
    placements: {
      featuredProducts: number;
      homeBestsellers: number;
      categorySignatures: number;
    };
  };
  compatibility: {
    publicUrlCount: number;
    uniquePublicUrlCount: number;
    selankLegacyIds: string[];
  };
  assets: {
    primary: {
      referenced: number;
      verified: number;
      missing: AssetAudit["productPrimary"]["missing"];
    };
    categoryHeroes: {
      referenced: number;
      verified: number;
      missing: AssetAudit["categoryHeroes"]["missing"];
    };
    blogCovers: {
      referenced: number;
      verified: number;
      missing: AssetAudit["blogCovers"]["missing"];
    };
    gallery: {
      referenced: number;
      verified: number;
      missing: AssetAudit["gallery"]["missing"];
      imported: number;
      verifiedNotImported: number;
      rejectedMissing: number;
    };
  };
  dataQuality: {
    reviewRequiredProducts: Array<{
      id: string;
      code: "APPEARANCE_DESCRIPTION_CONFLICT";
    }>;
    metaDescriptionsOver160: Array<{ slug: string; length: number }>;
  };
  mutations: ImportMutations;
  database: {
    legacyCategories: number;
    legacyProducts: number;
    legacyBlogs: number;
    legacyFaqs: number;
    defaultVariants: number;
    productLevelPrimaryMedia: number;
    fixedPrices: number;
    onRequestVariants: number;
    merchandisingPlacements: number;
  };
  assertions: string[];
};

function counter(): MutationCounter {
  return { created: 0, updated: 0, unchanged: 0 };
}

function mutationSummary(): ImportMutations {
  return {
    categories: counter(),
    products: counter(),
    variants: counter(),
    prices: counter(),
    media: counter(),
    productMedia: counter(),
    productCategories: counter(),
    seo: counter(),
    blogs: counter(),
    faqs: counter(),
    placements: counter(),
    pruned: 0,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function reviewReason(product: LegacyProduct): boolean {
  return (
    product.appearance === "Clear sterile solution" &&
    product.description.toLowerCase().includes("lyophilized powder")
  );
}

function mediaAltText(source: LegacyCommerceSource, path: string): string {
  const category = source.categories.find((candidate) => candidate.hero === path);
  if (category) {
    return category.name;
  }

  const product = source.products.find((candidate) => candidate.image === path);
  if (product) {
    return product.name;
  }

  const blog = source.blogs.find((candidate) => candidate.cover === path);
  return blog?.title ?? "Flintmarrow research catalog image";
}

async function syncMedia(
  tx: TransactionClient,
  source: LegacyCommerceSource,
  asset: AssetRecord,
  mutations: ImportMutations,
): Promise<{ id: bigint }> {
  const desired = {
    kind: MediaKind.IMAGE,
    storageProvider: "local-public",
    publicUrl: asset.path,
    altText: mediaAltText(source, asset.path),
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    sizeBytes: asset.sizeBytes,
    checksum: asset.checksum,
    isPrivate: false,
    deletedAt: null,
  };
  const existing = await tx.media.findUnique({
    where: { storageKey: asset.storageKey },
  });

  if (!existing) {
    mutations.media.created += 1;
    return tx.media.create({
      data: { storageKey: asset.storageKey, ...desired },
      select: { id: true },
    });
  }

  const unchanged =
    existing.kind === desired.kind &&
    existing.storageProvider === desired.storageProvider &&
    existing.publicUrl === desired.publicUrl &&
    existing.altText === desired.altText &&
    existing.mimeType === desired.mimeType &&
    existing.width === desired.width &&
    existing.height === desired.height &&
    existing.sizeBytes === desired.sizeBytes &&
    existing.checksum === desired.checksum &&
    existing.isPrivate === desired.isPrivate &&
    existing.deletedAt === null;

  if (unchanged) {
    mutations.media.unchanged += 1;
    return { id: existing.id };
  }

  mutations.media.updated += 1;
  return tx.media.update({
    where: { id: existing.id },
    data: desired,
    select: { id: true },
  });
}

async function syncSeo(
  tx: TransactionClient,
  owner:
    | { type: "category"; id: bigint }
    | { type: "product"; id: bigint }
    | { type: "blog"; id: bigint },
  desired: {
    openGraphMediaId: bigint | null;
    title: string;
    description: string;
    canonicalUrl: string;
    structuredData: Prisma.InputJsonValue;
  },
  mutations: ImportMutations,
): Promise<void> {
  const relationWhere =
    owner.type === "category"
      ? { categoryId: owner.id }
      : owner.type === "product"
        ? { productId: owner.id }
        : { blogPostId: owner.id };

  const existing = await tx.seoMetadata.findFirst({ where: relationWhere });
  const data = {
    ...desired,
    noIndex: false,
    noFollow: false,
  };

  if (!existing) {
    mutations.seo.created += 1;
    await tx.seoMetadata.create({
      data: {
        ...data,
        ...(owner.type === "category"
          ? { categoryId: owner.id }
          : owner.type === "product"
            ? { productId: owner.id }
            : { blogPostId: owner.id }),
      },
    });
    return;
  }

  const unchanged =
    existing.openGraphMediaId === data.openGraphMediaId &&
    existing.title === data.title &&
    existing.description === data.description &&
    existing.canonicalUrl === data.canonicalUrl &&
    existing.noIndex === data.noIndex &&
    existing.noFollow === data.noFollow &&
    sameJson(existing.structuredData, data.structuredData);

  if (unchanged) {
    mutations.seo.unchanged += 1;
    return;
  }

  mutations.seo.updated += 1;
  await tx.seoMetadata.update({ where: { id: existing.id }, data });
}

async function resolveCategory(
  tx: TransactionClient,
  category: Category,
  hash: string,
  metadata: Prisma.InputJsonValue,
  position: number,
  mutations: ImportMutations,
): Promise<{ id: bigint }> {
  const matches = await tx.category.findMany({
    where: {
      OR: [{ legacySourceId: category.slug }, { slug: category.slug }],
    },
    take: 2,
  });

  if (matches.length > 1) {
    throw new Error(
      `Category identity conflict for ${category.slug}: slug and legacySourceId resolve to different rows.`,
    );
  }

  const data = {
    legacySourceId: category.slug,
    sourceHash: hash,
    slug: category.slug,
    name: category.name,
    description: category.description,
    status: CatalogStatus.ACTIVE,
    position,
    publishedAt: LEGACY_PUBLISHED_AT,
    deletedAt: null,
    legacyMetadata: metadata,
  };
  const existing = matches[0];

  if (!existing) {
    mutations.categories.created += 1;
    return tx.category.create({ data, select: { id: true } });
  }

  if (
    existing.sourceHash === hash &&
    existing.status === data.status &&
    existing.position === data.position &&
    existing.deletedAt === null
  ) {
    mutations.categories.unchanged += 1;
    return { id: existing.id };
  }

  mutations.categories.updated += 1;
  return tx.category.update({
    where: { id: existing.id },
    data,
    select: { id: true },
  });
}

async function resolveProduct(
  tx: TransactionClient,
  product: LegacyProduct,
  hash: string,
  metadata: Prisma.InputJsonValue,
  position: number,
  mutations: ImportMutations,
): Promise<{ id: bigint }> {
  const matches = await tx.product.findMany({
    where: { OR: [{ legacySourceId: product.id }, { slug: product.id }] },
    take: 2,
  });

  if (matches.length > 1) {
    throw new Error(
      `Product identity conflict for ${product.id}: slug and legacySourceId resolve to different rows.`,
    );
  }

  const data = {
    legacySourceId: product.id,
    sourceHash: hash,
    slug: product.id,
    title: product.name,
    subtitle: product.presentation ?? null,
    shortDescription: product.shortDescription,
    description: product.description,
    brand: "Flintmarrow",
    purity: product.purity,
    casNumber: product.cas ?? null,
    appearance: product.appearance,
    storageInstructions: product.storage,
    legacyMetadata: metadata,
    dataQualityStatus: reviewReason(product)
      ? DataQualityStatus.REVIEW_REQUIRED
      : DataQualityStatus.VERIFIED,
    status: CatalogStatus.ACTIVE,
    isFeatured: product.featured === true,
    position,
    publishedAt: LEGACY_PUBLISHED_AT,
    deletedAt: null,
  };
  const existing = matches[0];

  if (!existing) {
    mutations.products.created += 1;
    return tx.product.create({ data, select: { id: true } });
  }

  if (
    existing.sourceHash === hash &&
    existing.status === data.status &&
    existing.isFeatured === data.isFeatured &&
    existing.position === data.position &&
    existing.deletedAt === null
  ) {
    mutations.products.unchanged += 1;
    return { id: existing.id };
  }

  mutations.products.updated += 1;
  return tx.product.update({
    where: { id: existing.id },
    data,
    select: { id: true },
  });
}

async function syncDefaultVariant(
  tx: TransactionClient,
  productId: bigint,
  product: LegacyProduct,
  mutations: ImportMutations,
): Promise<{ id: bigint }> {
  const matches = await tx.productVariant.findMany({
    where: { productId, position: 0, deletedAt: null },
    orderBy: { id: "asc" },
    take: 2,
  });

  if (matches.length > 1) {
    throw new Error(`Product ${product.id} has multiple active default variants.`);
  }

  const data = {
    productId,
    sku: null,
    barcode: null,
    title: "Default",
    priceMode: product.price === null ? PriceMode.ON_REQUEST : PriceMode.FIXED,
    status: CatalogStatus.ACTIVE,
    optionValues: {
      default: true,
      source: "legacy-catalog",
      ...(product.presentation ? { presentation: product.presentation } : {}),
      ...(product.catalogNumber ? { catalogNumber: product.catalogNumber } : {}),
    },
    requiresShipping: true,
    trackInventory: false,
    position: 0,
    publishedAt: LEGACY_PUBLISHED_AT,
    deletedAt: null,
  } satisfies Prisma.ProductVariantUncheckedCreateInput;
  const existing = matches[0];

  if (!existing) {
    mutations.variants.created += 1;
    return tx.productVariant.create({
      data,
      select: { id: true },
    });
  }

  const unchanged =
    existing.sku === null &&
    existing.barcode === null &&
    existing.title === data.title &&
    existing.priceMode === data.priceMode &&
    existing.status === data.status &&
    sameJson(existing.optionValues, data.optionValues) &&
    existing.requiresShipping === data.requiresShipping &&
    existing.trackInventory === data.trackInventory &&
    existing.position === data.position &&
    existing.publishedAt?.getTime() === data.publishedAt.getTime() &&
    existing.deletedAt === null;

  if (unchanged) {
    mutations.variants.unchanged += 1;
    return { id: existing.id };
  }

  mutations.variants.updated += 1;
  return tx.productVariant.update({
    where: { id: existing.id },
    data,
    select: { id: true },
  });
}

async function syncPrice(
  tx: TransactionClient,
  variantId: bigint,
  amount: number | null,
  mutations: ImportMutations,
): Promise<void> {
  const amountMinor = usdToMinor(amount);
  const existing = await tx.price.findMany({
    where: {
      variantId,
      currency: "USD",
      countryCode: "US",
      kind: PriceKind.REGULAR,
      deletedAt: null,
    },
    orderBy: [{ isActive: "desc" }, { id: "asc" }],
  });

  if (amountMinor === null) {
    const active = existing.filter((price) => price.isActive);
    if (active.length === 0) {
      mutations.prices.unchanged += 1;
      return;
    }

    for (const price of active) {
      await tx.price.update({
        where: { id: price.id },
        data: { isActive: false, deletedAt: LEGACY_PUBLISHED_AT },
      });
      mutations.prices.updated += 1;
    }
    return;
  }

  const price = existing[0];
  const data = {
    currency: "USD",
    kind: PriceKind.REGULAR,
    amountMinor,
    countryCode: "US",
    taxInclusive: false,
    isActive: true,
    startsAt: null,
    endsAt: null,
    deletedAt: null,
  };

  if (!price) {
    mutations.prices.created += 1;
    await tx.price.create({ data: { variantId, ...data } });
    return;
  }

  const unchanged =
    price.amountMinor === data.amountMinor &&
    price.taxInclusive === data.taxInclusive &&
    price.isActive === data.isActive &&
    price.startsAt === null &&
    price.endsAt === null &&
    price.deletedAt === null;

  if (unchanged) {
    mutations.prices.unchanged += 1;
    return;
  }

  mutations.prices.updated += 1;
  await tx.price.update({ where: { id: price.id }, data });
}

async function syncProductCategory(
  tx: TransactionClient,
  productId: bigint,
  categoryId: bigint,
  position: number,
  mutations: ImportMutations,
): Promise<void> {
  const existingLinks = await tx.productCategory.findMany({
    where: { productId },
  });
  const existing = existingLinks.find((link) => link.categoryId === categoryId);
  const staleLinks = existingLinks.filter((link) => link.categoryId !== categoryId);

  if (staleLinks.length > 0) {
    await tx.productCategory.deleteMany({
      where: { productId, categoryId: { not: categoryId } },
    });
    mutations.productCategories.updated += staleLinks.length;
  }

  if (!existing) {
    mutations.productCategories.created += 1;
    await tx.productCategory.create({ data: { productId, categoryId, position } });
    return;
  }

  if (existing.position === position) {
    mutations.productCategories.unchanged += 1;
    return;
  }

  mutations.productCategories.updated += 1;
  await tx.productCategory.update({
    where: { productId_categoryId: { productId, categoryId } },
    data: { position },
  });
}

async function syncProductMedia(
  tx: TransactionClient,
  productId: bigint,
  variantId: bigint | null,
  mediaId: bigint,
  role: typeof ProductMediaRole.PRIMARY | typeof ProductMediaRole.GALLERY,
  position: number,
  mutations: ImportMutations,
): Promise<void> {
  const relationScope =
    role === ProductMediaRole.PRIMARY
      ? { productId, variantId, role }
      : { productId, variantId, mediaId, role };
  const matches = await tx.productMedia.findMany({
    where: relationScope,
    orderBy: { id: "asc" },
    take: 2,
  });

  if (matches.length > 1) {
    throw new Error(
      `Duplicate ${role.toLowerCase()} media relation for product ${productId.toString()}.`,
    );
  }

  const existing = matches[0];
  if (!existing) {
    mutations.productMedia.created += 1;
    await tx.productMedia.create({
      data: { productId, variantId, mediaId, role, position },
    });
    return;
  }

  if (
    existing.variantId === variantId &&
    existing.mediaId === mediaId &&
    existing.position === position
  ) {
    mutations.productMedia.unchanged += 1;
    return;
  }

  mutations.productMedia.updated += 1;
  await tx.productMedia.update({
    where: { id: existing.id },
    data: { variantId, mediaId, position },
  });
}

async function resolveBlog(
  tx: TransactionClient,
  post: BlogPost,
  hash: string,
  heroMediaId: bigint,
  position: number,
  mutations: ImportMutations,
): Promise<{ id: bigint }> {
  const matches = await tx.blogPost.findMany({
    where: { OR: [{ legacySourceId: post.slug }, { slug: post.slug }] },
    take: 2,
  });

  if (matches.length > 1) {
    throw new Error(
      `Blog identity conflict for ${post.slug}: slug and legacySourceId resolve to different rows.`,
    );
  }

  const data = {
    legacySourceId: post.slug,
    sourceHash: hash,
    slug: post.slug,
    title: post.title,
    category: post.category,
    authorDisplayName: post.author,
    readingMinutes: parseReadingMinutes(post.readingTime),
    excerpt: post.excerpt,
    body: blogBlocksToMarkdown(post.body),
    contentData: {
      schemaVersion: 1,
      body: post.body,
      takeaways: post.takeaways,
      faqs: post.faqs,
      related: post.related ?? [],
      keyword: post.keyword,
      cover: post.cover,
      legacyPosition: position,
    },
    format: ContentFormat.MARKDOWN,
    status: ContentStatus.PUBLISHED,
    heroMediaId,
    publishedAt: parseLegacyDate(post.date),
    deletedAt: null,
  } satisfies Prisma.BlogPostUncheckedCreateInput;
  const existing = matches[0];

  if (!existing) {
    mutations.blogs.created += 1;
    return tx.blogPost.create({ data, select: { id: true } });
  }

  if (existing.sourceHash === hash) {
    mutations.blogs.unchanged += 1;
    return { id: existing.id };
  }

  mutations.blogs.updated += 1;
  return tx.blogPost.update({
    where: { id: existing.id },
    data,
    select: { id: true },
  });
}

async function resolveFaq(
  tx: TransactionClient,
  faq: LegacyFaq,
  position: number,
  mutations: ImportMutations,
): Promise<{ id: bigint }> {
  const data = {
    slug: faq.slug,
    question: faq.question,
    answer: faq.answer,
    category: null,
    status: ContentStatus.PUBLISHED,
    position,
    authorUserId: null,
    publishedAt: LEGACY_PUBLISHED_AT,
    deletedAt: null,
  } satisfies Prisma.FaqUncheckedCreateInput;
  const existing = await tx.faq.findUnique({ where: { slug: faq.slug } });

  if (!existing) {
    mutations.faqs.created += 1;
    return tx.faq.create({ data, select: { id: true } });
  }

  const unchanged =
    existing.question === data.question &&
    existing.answer === data.answer &&
    existing.category === null &&
    existing.status === data.status &&
    existing.position === data.position &&
    existing.authorUserId === null &&
    existing.publishedAt?.getTime() === data.publishedAt.getTime() &&
    existing.deletedAt === null;
  if (unchanged) {
    mutations.faqs.unchanged += 1;
    return { id: existing.id };
  }

  mutations.faqs.updated += 1;
  return tx.faq.update({
    where: { id: existing.id },
    data,
    select: { id: true },
  });
}

async function syncPlacement(
  tx: TransactionClient,
  key: string,
  productId: bigint,
  position: number,
  metadata: Prisma.InputJsonValue,
  mutations: ImportMutations,
): Promise<void> {
  const existing = await tx.merchandisingPlacement.findUnique({
    where: { key_productId: { key, productId } },
  });

  if (!existing) {
    const occupyingPosition = await tx.merchandisingPlacement.findUnique({
      where: { key_position: { key, position } },
    });
    if (occupyingPosition) {
      mutations.placements.updated += 1;
      await tx.merchandisingPlacement.update({
        where: { id: occupyingPosition.id },
        data: { productId, metadata, isActive: true },
      });
      return;
    }

    mutations.placements.created += 1;
    await tx.merchandisingPlacement.create({
      data: { key, productId, position, metadata },
    });
    return;
  }

  if (
    existing.position === position &&
    existing.isActive &&
    sameJson(existing.metadata, metadata)
  ) {
    mutations.placements.unchanged += 1;
    return;
  }

  mutations.placements.updated += 1;
  await tx.merchandisingPlacement.update({
    where: { id: existing.id },
    data: { position, metadata, isActive: true },
  });
}

const MANAGED_PLACEMENT_KEYS = [
  "legacy-featured-products",
  "legacy-home-bestsellers",
  "legacy-category-signatures",
] as const;

async function stageManagedPlacements(tx: TransactionClient): Promise<void> {
  // Move managed rows out of the public position range first so swaps and
  // compaction cannot violate the unique (key, position) constraint.
  // Inactive managed rows are fully reproducible and would otherwise retain
  // old staged positions that can collide on a later import.
  await tx.merchandisingPlacement.deleteMany({
    where: { key: { in: [...MANAGED_PLACEMENT_KEYS] }, isActive: false },
  });
  await tx.merchandisingPlacement.updateMany({
    where: { key: { in: [...MANAGED_PLACEMENT_KEYS] } },
    data: { position: { increment: 10_000 } },
  });
}

async function deactivatePlacementsMissingFromSource(
  tx: TransactionClient,
  desiredProductIdsByKey: ReadonlyMap<string, readonly bigint[]>,
  mutations: ImportMutations,
): Promise<void> {
  for (const key of MANAGED_PLACEMENT_KEYS) {
    const desiredProductIds = desiredProductIdsByKey.get(key) ?? [];
    const result = await tx.merchandisingPlacement.updateMany({
      where: {
        key,
        isActive: true,
        productId: { notIn: [...desiredProductIds] },
      },
      data: { isActive: false },
    });
    mutations.placements.updated += result.count;
  }
}

async function archiveProductsMissingFromSource(
  tx: TransactionClient,
  sourceProductIds: readonly string[],
  mutations: ImportMutations,
): Promise<void> {
  const staleProducts = await tx.product.findMany({
    where: {
      legacySourceId: { not: null, notIn: [...sourceProductIds] },
      status: { not: CatalogStatus.ARCHIVED },
    },
    select: { id: true },
  });
  if (staleProducts.length === 0) return;

  const staleProductIds = staleProducts.map((product) => product.id);
  await tx.merchandisingPlacement.updateMany({
    where: { productId: { in: staleProductIds }, isActive: true },
    data: { isActive: false },
  });
  await tx.productVariant.updateMany({
    where: {
      productId: { in: staleProductIds },
      status: { not: CatalogStatus.ARCHIVED },
    },
    data: { status: CatalogStatus.ARCHIVED },
  });
  await tx.product.updateMany({
    where: { id: { in: staleProductIds } },
    data: { status: CatalogStatus.ARCHIVED, isFeatured: false },
  });
  mutations.pruned += staleProducts.length;
}

function reportAssets(audit: AssetAudit, mode: AssetMode) {
  const importedGallery = mode === "strict-assets" ? audit.gallery.verified.length : 0;
  return {
    primary: {
      referenced: audit.productPrimary.referenced,
      verified: audit.productPrimary.verified.length,
      missing: audit.productPrimary.missing,
    },
    categoryHeroes: {
      referenced: audit.categoryHeroes.referenced,
      verified: audit.categoryHeroes.verified.length,
      missing: audit.categoryHeroes.missing,
    },
    blogCovers: {
      referenced: audit.blogCovers.referenced,
      verified: audit.blogCovers.verified.length,
      missing: audit.blogCovers.missing,
    },
    gallery: {
      referenced: audit.gallery.referenced,
      verified: audit.gallery.verified.length,
      missing: audit.gallery.missing,
      imported: importedGallery,
      verifiedNotImported:
        mode === "primary-only" ? audit.gallery.verified.length : 0,
      rejectedMissing: audit.gallery.missing.length,
    },
  };
}

async function verifyImportedData(
  tx: TransactionClient,
  source: LegacyCommerceSource,
): Promise<LegacyImportReport["database"]> {
  const categoryIds = source.categories.map((category) => category.slug);
  const productIds = source.products.map((product) => product.id);
  const blogIds = source.blogs.map((post) => post.slug);
  const faqSlugs = source.faqs.map((faq) => faq.slug);
  const placementKeys = [
    "legacy-featured-products",
    "legacy-home-bestsellers",
    "legacy-category-signatures",
  ];

  const [
    importedCategories,
    importedProducts,
    importedBlogs,
    importedFaqs,
    defaultVariants,
    placementCount,
  ] = await Promise.all([
    tx.category.findMany({
      where: { legacySourceId: { in: categoryIds } },
      select: { legacySourceId: true, slug: true },
    }),
    tx.product.findMany({
      where: { legacySourceId: { in: productIds } },
      select: {
        id: true,
        legacySourceId: true,
        slug: true,
        status: true,
        deletedAt: true,
        categories: { select: { category: { select: { legacySourceId: true } } } },
        media: {
          where: { role: ProductMediaRole.PRIMARY },
          select: { id: true, variantId: true },
        },
      },
    }),
    tx.blogPost.findMany({
      where: { legacySourceId: { in: blogIds } },
      select: { legacySourceId: true, slug: true, contentData: true },
    }),
    tx.faq.findMany({
      where: { slug: { in: faqSlugs } },
      select: {
        slug: true,
        question: true,
        answer: true,
        status: true,
        position: true,
        publishedAt: true,
        deletedAt: true,
      },
    }),
    tx.productVariant.findMany({
      where: {
        product: { legacySourceId: { in: productIds } },
        position: 0,
        status: CatalogStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        id: true,
        sku: true,
        status: true,
        priceMode: true,
        product: { select: { legacySourceId: true } },
        prices: {
          where: {
            currency: "USD",
            countryCode: "US",
            kind: PriceKind.REGULAR,
            isActive: true,
            deletedAt: null,
          },
          select: { amountMinor: true },
        },
      },
    }),
    tx.merchandisingPlacement.count({
      where: { key: { in: placementKeys }, isActive: true },
    }),
  ]);

  if (
    importedCategories.length !== source.categories.length ||
    importedProducts.length !== source.products.length ||
    importedBlogs.length !== source.blogs.length ||
    importedFaqs.length !== source.faqs.length
  ) {
    throw new Error("Imported legacy entity counts do not match the source contract.");
  }

  const activeProductsMissingFromSource = await tx.product.count({
    where: {
      legacySourceId: { not: null, notIn: productIds },
      status: CatalogStatus.ACTIVE,
    },
  });
  if (activeProductsMissingFromSource !== 0) {
    throw new Error("A legacy product missing from the purchase catalog is still active.");
  }

  if (
    importedCategories.some((row) => row.legacySourceId !== row.slug) ||
    importedProducts.some((row) => row.legacySourceId !== row.slug) ||
    importedBlogs.some((row) => row.legacySourceId !== row.slug)
  ) {
    throw new Error("A legacy slug or legacySourceId changed during import.");
  }

  const sourceProductById = new Map(
    source.products.map((product) => [product.id, product]),
  );
  if (
    importedProducts.some((row) => {
      const sourceProduct = row.legacySourceId
        ? sourceProductById.get(row.legacySourceId)
        : undefined;
      return (
        !sourceProduct ||
        row.status !== CatalogStatus.ACTIVE ||
        row.deletedAt !== null ||
        row.categories.length !== 1 ||
        row.categories[0]?.category.legacySourceId !== sourceProduct.category ||
        !row.media.some((media) => media.variantId === null)
      );
    })
  ) {
    throw new Error(
      "Every imported product must retain exactly its source category and primary media.",
    );
  }

  if (defaultVariants.length !== source.products.length) {
    throw new Error("Every imported product must have exactly one active default variant.");
  }

  const byProductId = sourceProductById;
  for (const variant of defaultVariants) {
    const legacyId = variant.product.legacySourceId;
    const sourceProduct = legacyId ? byProductId.get(legacyId) : undefined;
    if (!sourceProduct || variant.sku !== null) {
      throw new Error("Imported default variants must have null SKU and a known source product.");
    }

    const expected = usdToMinor(sourceProduct.price);
    if (expected === null) {
      if (variant.priceMode !== PriceMode.ON_REQUEST || variant.prices.length !== 0) {
        throw new Error(`ON_REQUEST product ${sourceProduct.id} has an active USD price.`);
      }
    } else if (
      variant.priceMode !== PriceMode.FIXED ||
      variant.prices.length !== 1 ||
      variant.prices[0]?.amountMinor !== expected
    ) {
      throw new Error(`Fixed-price product ${sourceProduct.id} has no matching USD price.`);
    }
  }

  const selankVariants = defaultVariants.filter((variant) =>
    ["selank", "selank-1"].includes(variant.product.legacySourceId ?? ""),
  );
  const selankAmounts = selankVariants
    .flatMap((variant) => variant.prices.map((price) => price.amountMinor))
    .sort((left, right) => Number(left - right));
  if (
    selankVariants.length !== 2 ||
    selankAmounts.length !== 2 ||
    selankAmounts[0] !== BigInt(4_000) ||
    selankAmounts[1] !== BigInt(6_900)
  ) {
    throw new Error("The Selank 5mg and 10mg prices were not preserved.");
  }

  for (const post of importedBlogs) {
    const data = post.contentData as Record<string, unknown> | null;
    if (
      !data ||
      data.schemaVersion !== 1 ||
      !Array.isArray(data.body) ||
      !Array.isArray(data.takeaways) ||
      !Array.isArray(data.faqs) ||
      !Array.isArray(data.related)
    ) {
      throw new Error(`Blog ${post.slug} lost FAQ or related-post content.`);
    }
  }

  const faqBySlug = new Map(source.faqs.map((faq) => [faq.slug, faq]));
  for (const faq of importedFaqs) {
    const expected = faqBySlug.get(faq.slug);
    if (
      !expected ||
      faq.question !== expected.question ||
      faq.answer !== expected.answer ||
      faq.status !== ContentStatus.PUBLISHED ||
      faq.position !== source.faqs.findIndex((item) => item.slug === faq.slug) ||
      faq.publishedAt?.getTime() !== LEGACY_PUBLISHED_AT.getTime() ||
      faq.deletedAt !== null
    ) {
      throw new Error(`FAQ ${faq.slug} does not match the legacy source.`);
    }
  }

  const expectedPlacementCount =
    source.placements.featuredProducts.length +
    source.placements.homeBestsellers.length +
    source.placements.categorySignatures.length;
  if (placementCount !== expectedPlacementCount) {
    throw new Error("The active merchandising placements do not exactly match the source.");
  }

  return {
    legacyCategories: importedCategories.length,
    legacyProducts: importedProducts.length,
    legacyBlogs: importedBlogs.length,
    legacyFaqs: importedFaqs.length,
    defaultVariants: defaultVariants.length,
    productLevelPrimaryMedia: importedProducts.filter((row) =>
      row.media.some((media) => media.variantId === null),
    ).length,
    fixedPrices: defaultVariants.filter((variant) => variant.priceMode === PriceMode.FIXED)
      .length,
    onRequestVariants: defaultVariants.filter(
      (variant) => variant.priceMode === PriceMode.ON_REQUEST,
    ).length,
    merchandisingPlacements: placementCount,
  };
}

export async function importLegacyCommerce(
  prisma: PrismaClient,
  source: LegacyCommerceSource,
  audit: AssetAudit,
  mode: AssetMode,
): Promise<LegacyImportReport> {
  const mutations = mutationSummary();
  const assetsByPath = allAssetMap(audit);
  const categoryDbIds = new Map<string, bigint>();
  const productDbIds = new Map<string, bigint>();
  const mediaCache = new Map<string, bigint>();

  const database = await prisma.$transaction(
    async (tx) => {
      async function mediaIdFor(path: string): Promise<bigint> {
        const cached = mediaCache.get(path);
        if (cached !== undefined) {
          return cached;
        }
        const asset = assetsByPath.get(path);
        if (!asset) {
          throw new Error(`Validated asset is unavailable during import: ${path}`);
        }
        const media = await syncMedia(tx, source, asset, mutations);
        mediaCache.set(path, media.id);
        return media.id;
      }

      for (const [position, category] of source.categories.entries()) {
        const signature = source.placements.categorySignatures.find(
          (placement) => placement.categorySlug === category.slug,
        );
        const productCount = source.products.filter(
          (product) => product.category === category.slug,
        ).length;
        const heroAsset = assetsByPath.get(category.hero);
        if (!heroAsset) {
          throw new Error(`Category ${category.slug} has no validated hero asset.`);
        }
        const metadata = {
          source: "src/data/categories.ts",
          short: category.short,
          hero: category.hero,
          accent: category.accent,
          iconPath: category.iconPath,
          seoIntro: source.categoryIntros[category.slug],
          productCount,
          signaturePlacement: signature ?? null,
        };
        const hash = sourceHash({
          importVersion: LEGACY_IMPORT_VERSION,
          category,
          metadata,
          heroAsset,
        });
        const categoryRecord = await resolveCategory(
          tx,
          category,
          hash,
          metadata,
          position,
          mutations,
        );
        categoryDbIds.set(category.slug, categoryRecord.id);

        const heroMediaId = await mediaIdFor(category.hero);
        const description = source.categoryIntros[category.slug] ?? category.description;
        await syncSeo(
          tx,
          { type: "category", id: categoryRecord.id },
          {
            openGraphMediaId: heroMediaId,
            title: `${category.name} | Research Peptides`,
            description,
            canonicalUrl: categoryCanonicalUrl(category.slug),
            structuredData: {
              "@context": "https://schema.org",
              "@type": "CollectionPage",
              name: category.name,
              description,
              url: categoryCanonicalUrl(category.slug),
            },
          },
          mutations,
        );
      }

      const categoryPositions = new Map<string, number>();
      for (const [position, product] of source.products.entries()) {
        const primaryAsset = assetsByPath.get(product.image);
        if (!primaryAsset) {
          throw new Error(`Product ${product.id} has no validated primary asset.`);
        }
        const galleryVerified = audit.gallery.verified.filter(
          (asset) => asset.productId === product.id,
        );
        const galleryMissing = audit.gallery.missing.filter(
          (asset) => asset.ownerId === product.id,
        );
        const placements = {
          featuredProduct: source.placements.featuredProducts.includes(product.id),
          homeBestseller: source.placements.homeBestsellers.includes(product.id),
          categorySignature:
            source.placements.categorySignatures.find(
              (placement) => placement.productId === product.id,
            ) ?? null,
        };
        const metadata = {
          source: "src/data/products.json",
          image: product.image,
          galleryFieldPresent: Object.prototype.hasOwnProperty.call(product, "gallery"),
          galleryReferences: product.gallery ?? [],
          missingGalleryAssets: galleryMissing.map((asset) => asset.path),
          verifiedGalleryAssets: galleryVerified.map((asset) => asset.path),
          placements,
          dataQualityIssues: reviewReason(product)
            ? ["APPEARANCE_DESCRIPTION_CONFLICT"]
            : [],
        };
        const hash = sourceHash({
          importVersion: LEGACY_IMPORT_VERSION,
          product,
          metadata,
          primaryAsset,
          galleryVerified,
          galleryMissing,
        });
        const productRecord = await resolveProduct(
          tx,
          product,
          hash,
          metadata,
          position,
          mutations,
        );
        productDbIds.set(product.id, productRecord.id);

        const variant = await syncDefaultVariant(
          tx,
          productRecord.id,
          product,
          mutations,
        );
        await syncPrice(tx, variant.id, product.price, mutations);

        const categoryId = categoryDbIds.get(product.category);
        if (categoryId === undefined) {
          throw new Error(`Category ${product.category} was not imported before ${product.id}.`);
        }
        const categoryPosition = categoryPositions.get(product.category) ?? 0;
        categoryPositions.set(product.category, categoryPosition + 1);
        await syncProductCategory(
          tx,
          productRecord.id,
          categoryId,
          categoryPosition,
          mutations,
        );

        const primaryMediaId = await mediaIdFor(product.image);
        await syncProductMedia(
          tx,
          productRecord.id,
          null,
          primaryMediaId,
          ProductMediaRole.PRIMARY,
          0,
          mutations,
        );

        if (mode === "strict-assets") {
          for (const [galleryPosition, galleryPath] of (product.gallery ?? []).entries()) {
            const galleryMediaId = await mediaIdFor(galleryPath);
            await syncProductMedia(
              tx,
              productRecord.id,
              null,
              galleryMediaId,
              ProductMediaRole.GALLERY,
              galleryPosition,
              mutations,
            );
          }
        }

        const additionalProperty = [
          { "@type": "PropertyValue", name: "Purity", value: product.purity },
          ...(product.cas
            ? [{ "@type": "PropertyValue", name: "CAS Number", value: product.cas }]
            : []),
          { "@type": "PropertyValue", name: "Appearance", value: product.appearance },
          { "@type": "PropertyValue", name: "Storage", value: product.storage },
          ...(product.presentation
            ? [{ "@type": "PropertyValue", name: "Supplier presentation", value: product.presentation }]
            : []),
        ];
        await syncSeo(
          tx,
          { type: "product", id: productRecord.id },
          {
            openGraphMediaId: primaryMediaId,
            title: `${product.name} | Flintmarrow`,
            description: product.shortDescription,
            canonicalUrl: productCanonicalUrl(product.id),
            structuredData: {
              "@context": "https://schema.org",
              "@type": "Product",
              name: product.name,
              description: product.shortDescription,
              image: product.image,
              brand: { "@type": "Brand", name: "Flintmarrow" },
              additionalProperty,
            },
          },
          mutations,
        );
      }

      for (const [position, post] of source.blogs.entries()) {
        const coverAsset = assetsByPath.get(post.cover);
        if (!coverAsset) {
          throw new Error(`Blog ${post.slug} has no validated cover asset.`);
        }
        const contentData = {
          schemaVersion: 1,
          body: post.body,
          takeaways: post.takeaways,
          faqs: post.faqs,
          related: post.related ?? [],
          keyword: post.keyword,
          cover: post.cover,
          legacyPosition: position,
        };
        const hash = sourceHash({
          importVersion: LEGACY_IMPORT_VERSION,
          post,
          contentData,
          coverAsset,
        });
        const heroMediaId = await mediaIdFor(post.cover);
        const blogRecord = await resolveBlog(
          tx,
          post,
          hash,
          heroMediaId,
          position,
          mutations,
        );
        await syncSeo(
          tx,
          { type: "blog", id: blogRecord.id },
          {
            openGraphMediaId: heroMediaId,
            title: post.metaTitle,
            description: post.metaDescription,
            canonicalUrl: blogCanonicalUrl(post.slug),
            structuredData: {
              "@context": "https://schema.org",
              "@type": "Article",
              headline: post.title,
              description: post.metaDescription,
              image: post.cover,
              datePublished: parseLegacyDate(post.date).toISOString(),
              author: { "@type": "Organization", name: post.author },
              mainEntityOfPage: blogCanonicalUrl(post.slug),
            },
          },
          mutations,
        );
      }

      for (const [position, faq] of source.faqs.entries()) {
        await resolveFaq(tx, faq, position, mutations);
      }

      await stageManagedPlacements(tx);

      for (const [position, productId] of source.placements.featuredProducts.entries()) {
        const dbProductId = productDbIds.get(productId);
        if (dbProductId === undefined) {
          throw new Error(`Featured placement product ${productId} was not imported.`);
        }
        await syncPlacement(
          tx,
          "legacy-featured-products",
          dbProductId,
          position,
          { source: "src/data/products.json#featured" },
          mutations,
        );
      }

      for (const [position, productId] of source.placements.homeBestsellers.entries()) {
        const dbProductId = productDbIds.get(productId);
        if (dbProductId === undefined) {
          throw new Error(`Bestseller placement product ${productId} was not imported.`);
        }
        await syncPlacement(
          tx,
          "legacy-home-bestsellers",
          dbProductId,
          position,
          { source: "src/data/products.ts#bestsellers" },
          mutations,
        );
      }

      for (const [position, placement] of source.placements.categorySignatures.entries()) {
        const dbProductId = productDbIds.get(placement.productId);
        if (dbProductId === undefined) {
          throw new Error(`Category signature product ${placement.productId} was not imported.`);
        }
        await syncPlacement(
          tx,
          "legacy-category-signatures",
          dbProductId,
          position,
          {
            source: "src/data/featured.ts",
            categorySlug: placement.categorySlug,
            index: placement.index,
            image: placement.image,
            productName: placement.productName,
            benefit: placement.benefit,
          },
          mutations,
        );
      }

      await deactivatePlacementsMissingFromSource(
        tx,
        new Map([
          [
            "legacy-featured-products",
            source.placements.featuredProducts.map((productId) => {
              const dbProductId = productDbIds.get(productId);
              if (dbProductId === undefined) {
                throw new Error(`Featured placement product ${productId} was not imported.`);
              }
              return dbProductId;
            }),
          ],
          [
            "legacy-home-bestsellers",
            source.placements.homeBestsellers.map((productId) => {
              const dbProductId = productDbIds.get(productId);
              if (dbProductId === undefined) {
                throw new Error(`Bestseller placement product ${productId} was not imported.`);
              }
              return dbProductId;
            }),
          ],
          [
            "legacy-category-signatures",
            source.placements.categorySignatures.map((placement) => {
              const dbProductId = productDbIds.get(placement.productId);
              if (dbProductId === undefined) {
                throw new Error(
                  `Category signature product ${placement.productId} was not imported.`,
                );
              }
              return dbProductId;
            }),
          ],
        ]),
        mutations,
      );

      await archiveProductsMissingFromSource(
        tx,
        source.products.map((product) => product.id),
        mutations,
      );

      return verifyImportedData(tx, source);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      // The importer issues thousands of sequential statements inside one
      // transaction; against a remote database the per-statement network
      // round-trip dominates, so the budget must cover WAN latency.
      timeout: 1_800_000,
    },
  );

  const urls = publicUrls(source);
  return {
    reportVersion: LEGACY_IMPORT_VERSION,
    status: "ok",
    assetMode: mode,
    source: {
      categories: source.categories.length,
      products: source.products.length,
      blogs: source.blogs.length,
      faqs: source.faqs.length,
      pricedProducts: source.products.filter((product) => product.price !== null).length,
      onRequestProducts: source.products.filter((product) => product.price === null).length,
      productsWithoutCas: source.products.filter((product) => !product.cas).length,
      duplicateCasGroups: findDuplicateCasGroups(source.products),
      placements: {
        featuredProducts: source.placements.featuredProducts.length,
        homeBestsellers: source.placements.homeBestsellers.length,
        categorySignatures: source.placements.categorySignatures.length,
      },
    },
    compatibility: {
      publicUrlCount: urls.length,
      uniquePublicUrlCount: new Set(urls).size,
      selankLegacyIds: source.products
        .filter((product) => ["selank", "selank-1"].includes(product.id))
        .map((product) => product.id),
    },
    assets: reportAssets(audit, mode),
    dataQuality: {
      reviewRequiredProducts: source.products
        .filter(reviewReason)
        .map((product) => ({
          id: product.id,
          code: "APPEARANCE_DESCRIPTION_CONFLICT" as const,
        })),
      metaDescriptionsOver160: source.blogs
        .filter((post) => post.metaDescription.length > 160)
        .map((post) => ({ slug: post.slug, length: post.metaDescription.length })),
    },
    mutations,
    database,
    assertions: [
      "6 legacy categories preserved by slug and legacySourceId",
      `${source.products.length} catalog products preserved by slug and legacySourceId`,
      "4 legacy blogs preserve body blocks, FAQ, related links, SEO, and UTC dates",
      "8 storefront FAQ entries preserve the reviewed source questions and answers",
      `${publicUrls(source).length} public URLs remain unique`,
      "Selank 5mg and 10mg remain at USD 40.00 and USD 69.00",
      `default variants have null SKU; ${source.products.filter((product) => product.price === null).length} products use ON_REQUEST without USD 0 prices`,
      `all ${source.products.length} products expose product-level primary media to the public DAL`,
      "three legacy merchandising placement sets remain distinct",
      `${mutations.pruned} legacy products missing from the purchase catalog were archived`,
    ],
  };
}
