import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PrismaClient } from "../src/generated/prisma/client";
import { validatePostgresConnectionUrl } from "../src/lib/postgres-connection-url";
import { cnyMinorToUsdMinor } from "../src/server/finance/math/fx";
import { divideRoundHalfUp } from "../src/server/finance/math/rounding";

type PurchaseCatalogProduct = {
  productId: string;
  name: string;
  presentation: string | null;
  procurementCodes: string[];
  purchaseSourceRows: number[];
  costRmbValues: number[];
};

type PurchaseCatalog = {
  sourceFiles: { procurement: string };
  pricing: { fx: { rate: number; referenceDate: string; source: string } };
  products: PurchaseCatalogProduct[];
};

function expandValues<T>(
  values: readonly T[],
  count: number,
  label: string,
  productId: string,
): T[] {
  if (values.length === count) return [...values];
  if (values.length === 1) return Array.from({ length: count }, () => values[0]);
  throw new Error(`${productId}: ${label} cannot map ${values.length} values to ${count} rows.`);
}

function cnyMajorToMinor(value: number): bigint {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value * 100)) {
    throw new Error(`Invalid CNY reference cost: ${value}`);
  }
  return BigInt(Math.round(value * 100));
}

async function main() {
  const projectRoot = resolve(import.meta.dirname, "..");
  const catalog = JSON.parse(
    await readFile(resolve(projectRoot, "src/data/purchase-catalog.json"), "utf8"),
  ) as PurchaseCatalog;

  const rawConnectionUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!rawConnectionUrl) throw new Error("DIRECT_URL or DATABASE_URL is required.");
  const connectionString = validatePostgresConnectionUrl(rawConnectionUrl, {
    label: process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL",
    requiredSchema: "app",
  });

  const fxRate = catalog.pricing.fx.rate.toFixed(8);
  const fxDate = new Date(`${catalog.pricing.fx.referenceDate}T00:00:00.000Z`);
  const importedAt = new Date();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
  const result = await prisma.$transaction(async (tx) => {
    const variants = await tx.productVariant.findMany({
      where: {
        position: 0,
        status: "ACTIVE",
        deletedAt: null,
        product: {
          status: "ACTIVE",
          deletedAt: null,
          legacySourceId: { in: catalog.products.map((product) => product.productId) },
        },
      },
      select: {
        id: true,
        publicId: true,
        product: { select: { legacySourceId: true, title: true } },
      },
    });
    const variantByProductId = new Map(
      variants.map((variant) => [variant.product.legacySourceId, variant]),
    );
    const missing = catalog.products
      .map((product) => product.productId)
      .filter((productId) => !variantByProductId.has(productId));
    if (missing.length > 0 || variants.length !== catalog.products.length) {
      throw new Error(
        `Reference-cost import requires one active default variant per product; missing: ${missing.join(", ") || "none"}.`,
      );
    }

    let observationCount = 0;
    const imported: Array<{
      productId: string;
      variantId: bigint;
      averageCnyMinor: bigint;
      averageUsdMinor: bigint;
    }> = [];

    for (const product of catalog.products) {
      const variant = variantByProductId.get(product.productId);
      if (!variant) throw new Error(`Variant disappeared for ${product.productId}.`);
      const rowCount = product.purchaseSourceRows.length;
      const costs = expandValues(product.costRmbValues, rowCount, "costs", product.productId);
      const codes = expandValues(product.procurementCodes, rowCount, "codes", product.productId);
      const observations = product.purchaseSourceRows.map((sourceRow, index) => ({
        sourceRow,
        supplierCode: codes[index],
        costCnyMinor: cnyMajorToMinor(costs[index]).toString(),
      }));
      observationCount += observations.length;
      const averageCnyMinor = divideRoundHalfUp(
        observations.reduce((sum, row) => sum + BigInt(row.costCnyMinor), BigInt(0)),
        BigInt(observations.length),
      );
      const averageUsdMinor = cnyMinorToUsdMinor(averageCnyMinor, fxRate);

      await tx.productVariant.update({
        where: { id: variant.id },
        data: {
          referenceCostCnyMinor: averageCnyMinor,
          referenceCostUsdMinor: averageUsdMinor,
          referenceCostFxRateCnyPerUsd: fxRate,
          referenceCostFxDate: fxDate,
          referenceCostSource: catalog.sourceFiles.procurement,
          referenceCostMetadata: {
            productName: product.name,
            presentation: product.presentation,
            observations,
            selectionMethod: "arithmetic_mean_of_mapped_excel_rows",
            fxSource: catalog.pricing.fx.source,
          },
          referenceCostUpdatedAt: importedAt,
        },
        select: { id: true },
      });
      imported.push({
        productId: product.productId,
        variantId: variant.id,
        averageCnyMinor,
        averageUsdMinor,
      });
    }

    const costByVariantId = new Map(imported.map((row) => [row.variantId, row]));
    const unsettledItems = await tx.orderItem.findMany({
      where: {
        variantId: { in: imported.map((row) => row.variantId) },
        totalCogsUsdMinor: null,
        compensationEventId: null,
        order: {
          status: { in: ["CONFIRMED", "PROCESSING", "COMPLETED"] },
          profitSettledSettlementId: null,
        },
      },
      select: {
        id: true,
        variantId: true,
        quantity: true,
        order: { select: { confirmedAt: true, createdAt: true } },
      },
    });

    for (const item of unsettledItems) {
      if (!item.variantId) continue;
      const cost = costByVariantId.get(item.variantId);
      if (!cost) continue;
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          unitCostUsdMinor: cost.averageUsdMinor,
          totalCogsUsdMinor: cost.averageUsdMinor * BigInt(item.quantity),
          costMethod: "MANUAL",
          costIsEstimated: true,
          costSnapshotAt: item.order.confirmedAt ?? item.order.createdAt,
        },
        select: { id: true },
      });
    }

    await tx.outboxEvent.create({
      data: {
        aggregateType: "finance",
        aggregateId: `reference-cost-import:${catalog.pricing.fx.referenceDate}`,
        eventType: "finance.reference_costs.imported",
        payload: {
          source: catalog.sourceFiles.procurement,
          productCount: imported.length,
          observationCount,
          backfilledOrderItemCount: unsettledItems.length,
          fxRateCnyPerUsd: fxRate,
          fxDate: fxDate.toISOString(),
        },
      },
      select: { id: true },
    });

    return {
      productCount: imported.length,
      observationCount,
      backfilledOrderItemCount: unsettledItems.length,
      fxRateCnyPerUsd: fxRate,
      fxDate: fxDate.toISOString(),
      source: catalog.sourceFiles.procurement,
    };
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });

    process.stdout.write(`${JSON.stringify({ status: "ok", ...result }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown reference-cost import error.";
  process.stderr.write(`${JSON.stringify({ status: "failed", message })}\n`);
  process.exitCode = 1;
});
