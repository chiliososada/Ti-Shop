import type {
  PublicDocumentDto,
  PublicImageDto,
  PublicSeoDto,
  PublicSitemapEntryDto,
} from "@/domain/public";

export type PublicPriceMode = "fixed" | "on-request";

export type PublicProductSort =
  | "recommended"
  | "name-asc"
  | "name-desc"
  | "newest";

export type PublicMoneyDto = {
  amountMinor: string;
  currency: "USD";
  display: string;
  kind: "regular" | "sale";
  taxInclusive: boolean;
};

export type PublicCategorySummaryDto = {
  publicId: string;
  slug: string;
  name: string;
};

export type PublicProductSummaryDto = {
  publicId: string;
  slug: string;
  title: string;
  subtitle: string | null;
  shortDescription: string | null;
  brand: string | null;
  purity: string | null;
  isFeatured: boolean;
  primaryImage: PublicImageDto | null;
  primaryCategory: PublicCategorySummaryDto | null;
  defaultVariantPublicId: string | null;
  minimumOrderQuantity: number | null;
  priceMode: PublicPriceMode | null;
  price: PublicMoneyDto | null;
};

export type PublicProductVariantDto = {
  publicId: string;
  sku: string | null;
  title: string;
  optionValues: Record<string, string | number | boolean | null> | null;
  minimumOrderQuantity: number;
  requiresShipping: boolean;
  priceMode: "fixed";
  price: PublicMoneyDto;
  directPurchaseAvailable: boolean;
};

export type PublicTagDto = {
  slug: string;
  name: string;
};

export type PublicProductDetailDto = PublicProductSummaryDto & {
  description: string | null;
  casNumber: string | null;
  appearance: string | null;
  storageInstructions: string | null;
  publishedAt: string;
  updatedAt: string;
  categories: PublicCategorySummaryDto[];
  tags: PublicTagDto[];
  gallery: PublicImageDto[];
  documents: PublicDocumentDto[];
  variants: PublicProductVariantDto[];
  seo: PublicSeoDto | null;
};

export type PublicCategoryListItemDto = PublicCategorySummaryDto & {
  description: string | null;
  productCount: number;
};

export type PublicCategoryDetailDto = PublicCategoryListItemDto & {
  publishedAt: string;
  updatedAt: string;
  products: PublicProductSummaryDto[];
  seo: PublicSeoDto | null;
};

export type PublicHomePlacementPresentationDto = {
  categorySlug: string;
  index: string;
  imageUrl: string;
  productName: string;
  benefit: string;
};

export type PublicHomePlacementItemDto = {
  position: number;
  product: PublicProductSummaryDto;
  presentation: PublicHomePlacementPresentationDto | null;
};

export type PublicHomePlacementsDto = Record<
  string,
  PublicHomePlacementItemDto[]
>;

export type PublicCatalogSitemapEntryDto = PublicSitemapEntryDto & {
  kind: "product" | "category";
};
