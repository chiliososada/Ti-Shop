export type PublicJsonPrimitive = string | number | boolean | null;

export type PublicJsonValue =
  | PublicJsonPrimitive
  | PublicJsonValue[]
  | { [key: string]: PublicJsonValue };

export type PublicJsonObject = { [key: string]: PublicJsonValue };

export type PublicImageDto = {
  publicId: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
  /**
   * Size-appropriate rendition URLs for storage-backed images. Null for
   * legacy single-file media; consumers fall back to `url`.
   */
  renditions: {
    thumb: string;
    card: string;
    detail: string;
  } | null;
};

export type PublicDocumentDto = {
  publicId: string;
  url: string;
  label: string;
  mimeType: string | null;
};

export type PublicSeoDto = {
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  noFollow: boolean;
  openGraphImage: PublicImageDto | null;
  structuredData: PublicJsonObject | null;
};

export type PublicSitemapEntryDto = {
  kind: "product" | "category" | "blog" | "page";
  slug: string;
  path: string;
  canonicalUrl: string | null;
  lastModified: string;
};
