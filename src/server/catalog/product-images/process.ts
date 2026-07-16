import "server-only";

import sharp, { type Metadata, type OutputInfo } from "sharp";

import type { ProductImageVariant } from "@/server/storage/keys";

// Decompression-bomb ceiling: sharp aborts decode past this pixel count.
const MAX_INPUT_PIXELS = 50_000_000;
const MAX_INPUT_DIMENSION = 12_000;
const MIN_INPUT_DIMENSION = 16;

// Uniform rendition policy. Longest-edge caps; images are never enlarged.
export const PRODUCT_IMAGE_VARIANT_POLICY: Record<
  ProductImageVariant,
  { maxEdge: number; quality: number }
> = {
  original: { maxEdge: 2400, quality: 82 },
  detail: { maxEdge: 1600, quality: 80 },
  card: { maxEdge: 640, quality: 75 },
  thumb: { maxEdge: 320, quality: 70 },
};

export type ProcessedImageVariant = {
  variant: ProductImageVariant;
  bytes: Uint8Array;
  width: number;
  height: number;
  sizeBytes: number;
};

export type ProcessedProductImage = {
  variants: ProcessedImageVariant[];
  /** Dimensions of the normalized original rendition. */
  width: number;
  height: number;
};

export class ImageProcessingError extends Error {
  readonly code: "undecodable" | "dimensions_out_of_range";

  constructor(code: "undecodable" | "dimensions_out_of_range", message: string) {
    super(message);
    this.name = "ImageProcessingError";
    this.code = code;
  }
}

/**
 * Decodes and fully re-encodes an uploaded image into the fixed WebP
 * rendition set. Re-encoding is itself a security measure: EXIF/GPS metadata,
 * ICC quirks, and any appended payload bytes never reach the stored objects.
 * EXIF orientation is applied to pixels before it is discarded.
 */
export async function processProductImage(
  input: Uint8Array,
): Promise<ProcessedProductImage> {
  let metadata: Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch (error) {
    throw new ImageProcessingError(
      "undecodable",
      error instanceof Error && /pixel limit/iu.test(error.message)
        ? "The image exceeds the maximum supported pixel count."
        : "The image could not be decoded.",
    );
  }

  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (
    sourceWidth < MIN_INPUT_DIMENSION ||
    sourceHeight < MIN_INPUT_DIMENSION ||
    sourceWidth > MAX_INPUT_DIMENSION ||
    sourceHeight > MAX_INPUT_DIMENSION
  ) {
    throw new ImageProcessingError(
      "dimensions_out_of_range",
      `Image dimensions must be between ${MIN_INPUT_DIMENSION}×${MIN_INPUT_DIMENSION} and ${MAX_INPUT_DIMENSION}×${MAX_INPUT_DIMENSION} pixels.`,
    );
  }

  const variants: ProcessedImageVariant[] = [];
  for (const [variant, policy] of Object.entries(PRODUCT_IMAGE_VARIANT_POLICY) as [
    ProductImageVariant,
    { maxEdge: number; quality: number },
  ][]) {
    let rendition: { data: Buffer; info: OutputInfo };
    try {
      rendition = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate() // Apply EXIF orientation to pixels.
        .resize({
          width: policy.maxEdge,
          height: policy.maxEdge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: policy.quality })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new ImageProcessingError(
        "undecodable",
        "The image could not be re-encoded.",
      );
    }
    variants.push({
      variant,
      bytes: new Uint8Array(rendition.data),
      width: rendition.info.width,
      height: rendition.info.height,
      sizeBytes: rendition.data.byteLength,
    });
  }

  const original = variants.find((entry) => entry.variant === "original");
  if (!original) {
    throw new ImageProcessingError("undecodable", "Rendition generation failed.");
  }

  return { variants, width: original.width, height: original.height };
}
