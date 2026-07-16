import type {
  PublicDocumentDto,
  PublicImageDto,
  PublicJsonObject,
  PublicJsonValue,
  PublicSeoDto,
} from "@/domain/public";
import { normalizeCanonicalUrl } from "@/lib/canonical-url";
import { sanitizePublicAssetUrl } from "@/lib/public-asset-url";
import { productImageRenditionUrls } from "@/server/catalog/product-images/urls";

export type PublicImageRow = {
  publicId: string;
  kind: string;
  publicUrl: string | null;
  altText: string | null;
  width: number | null;
  height: number | null;
  variants?: unknown;
  uploadStatus?: string;
  isPrivate: boolean;
  deletedAt: Date | null;
};

export type PublicDocumentRow = PublicImageRow & {
  mimeType: string | null;
};

export type PublicSeoRow = {
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  noFollow: boolean;
  structuredData: unknown;
  openGraphMedia: PublicImageRow | null;
};

const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_JSON_DEPTH = 20;
const MAX_JSON_VALUES = 2_000;
const SAFE_PUBLIC_DOCUMENT_MIME_TYPES = new Set([
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/plain",
]);
const SAFE_PUBLIC_DOCUMENT_EXTENSIONS = new Set([
  ".csv",
  ".doc",
  ".docx",
  ".pdf",
  ".txt",
  ".xls",
  ".xlsx",
]);

function clonePublicJsonValue(
  value: unknown,
  depth: number,
  state: { values: number },
): PublicJsonValue | undefined {
  state.values += 1;
  if (depth > MAX_JSON_DEPTH || state.values > MAX_JSON_VALUES) {
    return undefined;
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (Array.isArray(value)) {
    if (value.length > 500) {
      return undefined;
    }

    const cloned: PublicJsonValue[] = [];
    for (const item of value) {
      const child = clonePublicJsonValue(item, depth + 1, state);
      if (child === undefined) {
        return undefined;
      }
      cloned.push(child);
    }
    return cloned;
  }

  if (typeof value !== "object") {
    return undefined;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const cloned: PublicJsonObject = {};

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (
      FORBIDDEN_JSON_KEYS.has(key) ||
      !("value" in descriptor) ||
      descriptor.value === undefined
    ) {
      return undefined;
    }

    const child = clonePublicJsonValue(descriptor.value, depth + 1, state);
    if (child === undefined) {
      return undefined;
    }
    cloned[key] = child;
  }

  return cloned;
}

export function clonePublicJsonObject(value: unknown): PublicJsonObject | null {
  const cloned = clonePublicJsonValue(value, 0, { values: 0 });
  if (!cloned || Array.isArray(cloned) || typeof cloned !== "object") {
    return null;
  }
  return cloned;
}

export function sanitizePublicUrl(value: string | null): string | null {
  return value ? normalizeCanonicalUrl(value) : null;
}

export function sanitizePublicImageUrl(value: string | null): string | null {
  return sanitizePublicAssetUrl(value);
}

function positiveDimension(value: number | null): number | null {
  return Number.isInteger(value) && value !== null && value > 0 ? value : null;
}

export function mapPublicImage(
  row: PublicImageRow | null,
  fallbackAlt: string,
): PublicImageDto | null {
  if (
    !row ||
    row.kind !== "IMAGE" ||
    row.isPrivate ||
    row.deletedAt !== null ||
    // Storage-backed rows are visible only once every rendition exists.
    (row.uploadStatus !== undefined && row.uploadStatus !== "READY")
  ) {
    return null;
  }

  const renditionUrls = productImageRenditionUrls({
    publicUrl: row.publicUrl,
    variants: row.variants ?? null,
  });

  const url = sanitizePublicImageUrl(renditionUrls?.original ?? row.publicUrl);
  if (!url) {
    return null;
  }

  const thumb = renditionUrls ? sanitizePublicImageUrl(renditionUrls.thumb) : null;
  const card = renditionUrls ? sanitizePublicImageUrl(renditionUrls.card) : null;
  const detail = renditionUrls ? sanitizePublicImageUrl(renditionUrls.detail) : null;

  const alt = row.altText?.trim() || fallbackAlt.trim();
  return {
    publicId: row.publicId,
    url,
    alt,
    width: positiveDimension(row.width),
    height: positiveDimension(row.height),
    renditions:
      thumb && card && detail && (thumb !== url || card !== url || detail !== url)
        ? { thumb, card, detail }
        : null,
  };
}

function publicDocumentFileName(url: string) {
  try {
    const pathname = url.startsWith("/")
      ? new URL(url, "https://catalog.invalid").pathname
      : new URL(url).pathname;
    const encodedName = pathname.split("/").filter(Boolean).at(-1);
    if (!encodedName) return null;
    const decoded = decodeURIComponent(encodedName).trim();
    return decoded && decoded.length <= 255 ? decoded : null;
  } catch {
    return null;
  }
}

function hasSafePublicDocumentExtension(url: string) {
  const fileName = publicDocumentFileName(url)?.toLowerCase();
  if (!fileName) return false;
  return [...SAFE_PUBLIC_DOCUMENT_EXTENSIONS].some((extension) =>
    fileName.endsWith(extension),
  );
}

function hasUnsafeExplicitDocumentExtension(url: string) {
  const fileName = publicDocumentFileName(url)?.toLowerCase();
  return Boolean(
    fileName?.includes(".") && !hasSafePublicDocumentExtension(url),
  );
}

export function mapPublicDocument(
  row: PublicDocumentRow | null,
  fallbackLabel: string,
): PublicDocumentDto | null {
  if (
    !row ||
    row.kind !== "DOCUMENT" ||
    row.isPrivate ||
    row.deletedAt !== null
  ) {
    return null;
  }

  const url = sanitizePublicAssetUrl(row.publicUrl);
  if (!url) return null;
  const mimeType = row.mimeType?.trim().toLowerCase() || null;
  if (
    (mimeType !== null && !SAFE_PUBLIC_DOCUMENT_MIME_TYPES.has(mimeType)) ||
    hasUnsafeExplicitDocumentExtension(url) ||
    (mimeType === null && !hasSafePublicDocumentExtension(url))
  ) {
    return null;
  }

  return {
    publicId: row.publicId,
    url,
    label:
      row.altText?.trim() ||
      publicDocumentFileName(url) ||
      fallbackLabel.trim(),
    mimeType,
  };
}

export function mapPublicSeo(row: PublicSeoRow | null): PublicSeoDto | null {
  if (!row) {
    return null;
  }

  return {
    title: row.title?.trim() || null,
    description: row.description?.trim() || null,
    canonicalUrl: sanitizePublicUrl(row.canonicalUrl),
    noIndex: row.noIndex,
    noFollow: row.noFollow,
    openGraphImage: mapPublicImage(row.openGraphMedia, "Open Graph image"),
    structuredData: clonePublicJsonObject(row.structuredData),
  };
}

export function toIsoString(value: Date | null): string | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return null;
  }
  return value.toISOString();
}

export function mapPrimitiveRecord(
  value: unknown,
): Record<string, string | number | boolean | null> | null {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return null;
  }

  const entries = Object.entries(value);
  if (entries.length > 50) {
    return null;
  }

  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (
      FORBIDDEN_JSON_KEYS.has(key) ||
      (item !== null &&
        typeof item !== "string" &&
        typeof item !== "number" &&
        typeof item !== "boolean") ||
      (typeof item === "number" && !Number.isFinite(item))
    ) {
      return null;
    }
    result[key] = item as string | number | boolean | null;
  }

  return result;
}
