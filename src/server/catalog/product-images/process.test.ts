import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ImageProcessingError,
  processProductImage,
  PRODUCT_IMAGE_VARIANT_POLICY,
} from "@/server/catalog/product-images/process";

async function testJpeg(width: number, height: number, orientation?: number) {
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 12, g: 140, b: 90 } },
  }).jpeg({ quality: 90 });
  if (orientation) {
    pipeline = pipeline.withMetadata({ orientation });
  }
  return new Uint8Array(await pipeline.toBuffer());
}

describe("processProductImage", () => {
  it("produces the four WebP renditions with policy-capped dimensions", async () => {
    const input = await testJpeg(3200, 1600);
    const processed = await processProductImage(input);

    expect(processed.variants.map((entry) => entry.variant).sort()).toEqual([
      "card",
      "detail",
      "original",
      "thumb",
    ]);
    for (const rendition of processed.variants) {
      const policy = PRODUCT_IMAGE_VARIANT_POLICY[rendition.variant];
      expect(Math.max(rendition.width, rendition.height)).toBeLessThanOrEqual(policy.maxEdge);
      expect(rendition.sizeBytes).toBeGreaterThan(0);
      const meta = await sharp(rendition.bytes).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(rendition.width);
      expect(meta.height).toBe(rendition.height);
    }
    // 3200x1600 → original capped to 2400x1200.
    expect(processed.width).toBe(2400);
    expect(processed.height).toBe(1200);
  });

  it("never enlarges small images", async () => {
    const input = await testJpeg(200, 100);
    const processed = await processProductImage(input);
    for (const rendition of processed.variants) {
      expect(rendition.width).toBe(200);
      expect(rendition.height).toBe(100);
    }
  });

  it("applies EXIF orientation to pixels and strips metadata", async () => {
    // Orientation 6 = 90° clockwise: a 300x100 source must render 100x300.
    const input = await testJpeg(300, 100, 6);
    const processed = await processProductImage(input);
    expect(processed.width).toBe(100);
    expect(processed.height).toBe(300);

    const original = processed.variants.find((entry) => entry.variant === "original");
    const meta = await sharp(original?.bytes ?? new Uint8Array()).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation === undefined || meta.orientation === 1).toBe(true);
  });

  it("rejects undecodable and out-of-range inputs", async () => {
    await expect(
      processProductImage(new TextEncoder().encode("not an image at all")),
    ).rejects.toThrowError(ImageProcessingError);

    await expect(processProductImage(await testJpeg(8, 8))).rejects.toMatchObject({
      code: "dimensions_out_of_range",
    });

    await expect(processProductImage(await testJpeg(12_500, 20))).rejects.toMatchObject({
      code: "dimensions_out_of_range",
    });
  });
});
