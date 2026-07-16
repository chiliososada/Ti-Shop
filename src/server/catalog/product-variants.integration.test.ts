import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getPublicProductBySlug } from "@/server/catalog";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("public direct-sale product variants", () => {
  const suffix = randomUUID().slice(0, 12);
  const slug = `variant-purchase-it-${suffix}`;
  const locationCode = `VP-${suffix}`.toUpperCase();

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const publishedAt = new Date(Date.now() - 60_000);
    const location = await db.inventoryLocation.create({
      data: {
        code: locationCode,
        name: `Variant purchase ${suffix}`,
        countryCode: "US",
        isActive: true,
      },
      select: { id: true },
    });

    await db.product.create({
      data: {
        slug,
        title: `Variant purchase ${suffix}`,
        status: "ACTIVE",
        dataQualityStatus: "VERIFIED",
        publishedAt,
        variants: {
          create: [
            {
              sku: `VP-${suffix}-AVAILABLE`,
              title: "Available 5mg vial",
              status: "ACTIVE",
              priceMode: "FIXED",
              trackInventory: true,
              position: 0,
              publishedAt,
              optionValues: { minimumOrderQuantity: 2 },
              prices: {
                create: {
                  currency: "USD",
                  countryCode: "US",
                  amountMinor: BigInt(5000),
                  isActive: true,
                },
              },
              inventoryLevels: {
                create: {
                  locationId: location.id,
                  onHandQuantity: 10,
                  reservedQuantity: 0,
                  safetyStockQuantity: 2,
                },
              },
            },
            {
              sku: `VP-${suffix}-UNAVAILABLE`,
              title: "Unavailable 10mg vial",
              status: "ACTIVE",
              priceMode: "FIXED",
              trackInventory: true,
              position: 1,
              publishedAt,
              optionValues: { minimumOrderQuantity: 2 },
              prices: {
                create: {
                  currency: "USD",
                  countryCode: "US",
                  amountMinor: BigInt(9000),
                  isActive: true,
                },
              },
              inventoryLevels: {
                create: {
                  locationId: location.id,
                  onHandQuantity: 2,
                  reservedQuantity: 0,
                  safetyStockQuantity: 1,
                },
              },
            },
            {
              sku: `VP-${suffix}-DRAFT`,
              title: "Draft vial",
              status: "DRAFT",
              priceMode: "FIXED",
              trackInventory: false,
              position: 2,
              optionValues: { minimumOrderQuantity: 1 },
              prices: {
                create: {
                  currency: "USD",
                  countryCode: "US",
                  amountMinor: BigInt(1000),
                  isActive: true,
                },
              },
            },
            {
              sku: `VP-${suffix}-QUOTE`,
              title: "Quote-only vial",
              status: "ACTIVE",
              priceMode: "ON_REQUEST",
              trackInventory: false,
              position: 3,
              publishedAt,
              optionValues: { minimumOrderQuantity: 1 },
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    const db = getDb();
    const product = await db.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (product) {
      await db.inventoryLevel.deleteMany({
        where: { variant: { productId: product.id } },
      });
      await db.productVariant.deleteMany({ where: { productId: product.id } });
      await db.product.delete({ where: { id: product.id } });
    }
    await db.inventoryLocation.deleteMany({
      where: { code: locationCode },
    });
  });

  it("returns only published direct-sale variants with conservative availability", async () => {
    const product = await getPublicProductBySlug(slug);

    expect(product?.variants.map((variant) => variant.title)).toEqual([
      "Available 5mg vial",
      "Unavailable 10mg vial",
    ]);
    expect(product?.variants.map((variant) => ({
      sku: variant.sku,
      minimumOrderQuantity: variant.minimumOrderQuantity,
      price: variant.price.amountMinor,
      available: variant.directPurchaseAvailable,
    }))).toEqual([
      {
        sku: `VP-${suffix}-AVAILABLE`,
        minimumOrderQuantity: 2,
        price: "5000",
        available: true,
      },
      {
        sku: `VP-${suffix}-UNAVAILABLE`,
        minimumOrderQuantity: 2,
        price: "9000",
        available: false,
      },
    ]);
    expect(JSON.stringify(product)).not.toMatch(
      /onHandQuantity|reservedQuantity|safetyStockQuantity/u,
    );
  });
});
