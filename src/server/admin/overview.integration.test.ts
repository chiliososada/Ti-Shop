import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: {
      user: {
        id: "c0d91d38-7480-4cb1-aa87-c576f93dcc0d",
        name: "Inventory reader",
        email: "inventory-reader@example.test",
      },
    },
    roles: ["integration-test"],
    permissions: new Set(["inventory.read"]),
  })),
}));

import { loadAdminOverview } from "@/server/admin/overview";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("admin overview inventory metric", () => {
  const suffix = randomUUID().slice(0, 8);
  const productSlug = `overview-stock-${suffix}`;
  const locationCode = `OV-${suffix}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const product = await db.product.create({
      data: {
        slug: productSlug,
        title: `Overview stock ${suffix}`,
        status: "ACTIVE",
        publishedAt: new Date("2026-07-13T00:00:00.000Z"),
        variants: {
          create: [
            {
              title: "No level",
              status: "ACTIVE",
              publishedAt: new Date("2026-07-13T00:00:00.000Z"),
              trackInventory: true,
            },
            {
              title: "At threshold after safety stock",
              status: "ACTIVE",
              publishedAt: new Date("2026-07-13T00:00:00.000Z"),
              trackInventory: true,
            },
            {
              title: "Above threshold",
              status: "ACTIVE",
              publishedAt: new Date("2026-07-13T00:00:00.000Z"),
              trackInventory: true,
            },
            {
              title: "Inactive variant",
              status: "DRAFT",
              trackInventory: true,
            },
          ],
        },
      },
      select: {
        variants: {
          orderBy: { id: "asc" },
          select: { id: true },
        },
      },
    });
    const location = await db.inventoryLocation.create({
      data: {
        code: locationCode,
        name: `Overview location ${suffix}`,
        countryCode: "US",
        isActive: true,
      },
      select: { id: true },
    });
    const thresholdVariant = product.variants[1];
    const stockedVariant = product.variants[2];
    const inactiveVariant = product.variants[3];
    if (!thresholdVariant || !stockedVariant || !inactiveVariant) {
      throw new Error("Inventory metric fixture creation failed.");
    }
    await db.inventoryLevel.createMany({
      data: [
        {
          variantId: thresholdVariant.id,
          locationId: location.id,
          onHandQuantity: 6,
          reservedQuantity: 0,
          safetyStockQuantity: 1,
        },
        {
          variantId: stockedVariant.id,
          locationId: location.id,
          onHandQuantity: 7,
          reservedQuantity: 0,
          safetyStockQuantity: 1,
        },
        {
          variantId: inactiveVariant.id,
          locationId: location.id,
          onHandQuantity: 0,
          reservedQuantity: 0,
          safetyStockQuantity: 0,
        },
      ],
    });
  });

  afterAll(async () => {
    const db = getDb();
    await db.inventoryLevel.deleteMany({
      where: { variant: { product: { slug: productSlug } } },
    });
    await db.productVariant.deleteMany({
      where: { product: { slug: productSlug } },
    });
    await db.product.deleteMany({ where: { slug: productSlug } });
    await db.inventoryLocation.deleteMany({ where: { code: locationCode } });
  });

  it("counts only active tracked variants at or below five sellable units", async () => {
    const db = getDb();
    const product = await db.product.findUniqueOrThrow({
      where: { slug: productSlug },
      select: { id: true },
    });
    await db.product.update({
      where: { id: product.id },
      data: { status: "DRAFT", publishedAt: null },
    });
    const baseline = await loadAdminOverview();
    await db.product.update({
      where: { id: product.id },
      data: {
        status: "ACTIVE",
        publishedAt: new Date("2026-07-13T00:00:00.000Z"),
      },
    });

    const result = await loadAdminOverview();

    expect(result.metrics.lowStockVariantCount).toBe(
      (baseline.metrics.lowStockVariantCount ?? 0) + 2,
    );
    expect(
      Object.entries(result.metrics)
        .filter(([key]) => key !== "lowStockVariantCount")
        .every(([, value]) => value === null),
    ).toBe(true);
  });
});
