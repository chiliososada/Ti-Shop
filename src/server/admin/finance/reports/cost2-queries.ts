import "server-only";

import { requirePermission } from "@/server/auth/rbac";
import { buildCurrentUsdPriceWhere } from "@/server/catalog/query-contracts";
import { getDb } from "@/server/db/client";
import { splitCost2UsdMinor } from "@/server/finance/math/cost2";

type CurrentCost2Price = {
  amountMinor: bigint;
  cost2UsdMinor: bigint | null;
  countryCode: string | null;
  kind: string;
  startsAt: Date | null;
  createdAt: Date;
};

function currentCost2Price(prices: readonly CurrentCost2Price[]) {
  return [...prices].sort((left, right) => {
    const country =
      Number(right.countryCode === "US") - Number(left.countryCode === "US");
    if (country !== 0) return country;
    const kind = Number(right.kind === "SALE") - Number(left.kind === "SALE");
    if (kind !== 0) return kind;
    const start =
      (right.startsAt?.getTime() ?? Number.MIN_SAFE_INTEGER) -
      (left.startsAt?.getTime() ?? Number.MIN_SAFE_INTEGER);
    if (start !== 0) return start;
    return right.createdAt.getTime() - left.createdAt.getTime();
  })[0];
}

/** Current catalog Cost 1/Cost 2 matrix for every active internal SKU. */
export async function getCost2CatalogReport() {
  await requirePermission("finance.read", "/admin/finance/cost2");
  const now = new Date();
  const variants = await getDb().productVariant.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      product: { status: "ACTIVE", deletedAt: null },
    },
    orderBy: [{ product: { title: "asc" } }, { position: "asc" }, { id: "asc" }],
    select: {
      publicId: true,
      sku: true,
      title: true,
      referenceCostCnyMinor: true,
      referenceCostUsdMinor: true,
      referenceCostFxRateCnyPerUsd: true,
      referenceCostFxDate: true,
      referenceCostSource: true,
      product: { select: { title: true } },
      prices: {
        where: buildCurrentUsdPriceWhere(now),
        select: {
          amountMinor: true,
          cost2UsdMinor: true,
          countryCode: true,
          kind: true,
          startsAt: true,
          createdAt: true,
        },
      },
    },
  });

  const rows = variants.map((variant) => {
    const price = currentCost2Price(variant.prices);
    const cost1 = variant.referenceCostUsdMinor;
    const expected =
      price && cost1 !== null
        ? splitCost2UsdMinor({
            sellingPriceUsdMinor: price.amountMinor,
            cost1UsdMinor: cost1,
          })
        : null;
    const storedCost2 = price?.cost2UsdMinor ?? null;
    const formulaMatches =
      expected !== null && storedCost2 !== null && expected.cost2UsdMinor === storedCost2;

    return {
      variantPublicId: variant.publicId,
      product: `${variant.product.title}${variant.title === "Default" ? "" : ` · ${variant.title}`}`,
      sku: variant.sku ?? "",
      sellUsdMinor: price?.amountMinor.toString() ?? null,
      cost1CnyMinor: variant.referenceCostCnyMinor?.toString() ?? null,
      cost1UsdMinor: cost1?.toString() ?? null,
      cost2UsdMinor: storedCost2?.toString() ?? null,
      partnerShareUsdMinor:
        storedCost2 !== null && cost1 !== null
          ? (storedCost2 - cost1).toString()
          : null,
      ownerShareUsdMinor:
        storedCost2 !== null && price
          ? (price.amountMinor - storedCost2).toString()
          : null,
      fxRateCnyPerUsd: variant.referenceCostFxRateCnyPerUsd?.toString() ?? null,
      fxDate: variant.referenceCostFxDate?.toISOString().slice(0, 10) ?? null,
      source: variant.referenceCostSource,
      state:
        expected === null
          ? ("missing_source" as const)
          : formulaMatches
            ? ("ready" as const)
            : ("mismatch" as const),
    };
  });

  return {
    asOf: now.toISOString(),
    rows,
    summary: {
      total: rows.length,
      ready: rows.filter((row) => row.state === "ready").length,
      missing: rows.filter((row) => row.state === "missing_source").length,
      mismatch: rows.filter((row) => row.state === "mismatch").length,
    },
  };
}
