import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "../src/generated/prisma/client";
import { validatePostgresConnectionUrl } from "../src/lib/postgres-connection-url";
import { importLegacyCommerce } from "./lib/legacy-commerce-import";
import {
  assertAssetsForMode,
  auditLegacyAssets,
  findDuplicateCasGroups,
  LegacySourceError,
  loadLegacyCommerceSource,
  publicUrls,
  validateLegacySource,
  type AssetAudit,
  type AssetMode,
  type LegacyCommerceSource,
} from "./lib/legacy-commerce-source";

type FailureReport = {
  reportVersion: 1;
  status: "failed";
  assetMode: AssetMode;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  source?: {
    categories: number;
    products: number;
    blogs: number;
    faqs: number;
    publicUrlCount: number;
    uniquePublicUrlCount: number;
    duplicateCasGroups: ReturnType<typeof findDuplicateCasGroups>;
  };
  assets?: {
    primary: { referenced: number; verified: number; missing: AssetAudit["productPrimary"]["missing"] };
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
      imported: 0;
    };
  };
};

function parseAssetMode(args: readonly string[]): AssetMode {
  if (args.length === 0) {
    return "primary-only";
  }

  if (
    args.length === 1 &&
    (args[0] === "--strict-assets" || args[0] === "--asset-mode=strict-assets")
  ) {
    return "strict-assets";
  }

  if (args.length === 1 && args[0] === "--asset-mode=primary-only") {
    return "primary-only";
  }

  throw new LegacySourceError(
    "INVALID_ARGUMENT",
    "Usage: npm run db:import:legacy [-- --strict-assets|--asset-mode=primary-only]",
    args,
  );
}

function redact(message: string, secret: string | undefined): string {
  return secret ? message.split(secret).join("[REDACTED]") : message;
}

function failureReport(
  mode: AssetMode,
  error: unknown,
  source?: LegacyCommerceSource,
  audit?: AssetAudit,
): FailureReport {
  const directUrl = process.env.DIRECT_URL;
  const sourceError = error instanceof LegacySourceError ? error : undefined;
  const message = error instanceof Error ? error.message : "Unknown legacy import failure.";
  const urls = source ? publicUrls(source) : [];

  return {
    reportVersion: 1,
    status: "failed",
    assetMode: mode,
    error: {
      code: sourceError?.code ?? "IMPORT_FAILED",
      message: redact(message, directUrl),
      ...(sourceError?.details === undefined ? {} : { details: sourceError.details }),
    },
    ...(source
      ? {
          source: {
            categories: source.categories.length,
            products: source.products.length,
            blogs: source.blogs.length,
            faqs: source.faqs.length,
            publicUrlCount: urls.length,
            uniquePublicUrlCount: new Set(urls).size,
            duplicateCasGroups: findDuplicateCasGroups(source.products),
          },
        }
      : {}),
    ...(audit
      ? {
          assets: {
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
              imported: 0 as const,
            },
          },
        }
      : {}),
  };
}

function printJson(value: unknown): void {
  process.stdout.write(
    `${JSON.stringify(
      value,
      (_key, nested) => (typeof nested === "bigint" ? nested.toString() : nested),
      2,
    )}\n`,
  );
}

async function main(): Promise<void> {
  let mode: AssetMode = "primary-only";
  let source: LegacyCommerceSource | undefined;
  let audit: AssetAudit | undefined;
  let prisma: PrismaClient | undefined;

  try {
    mode = parseAssetMode(process.argv.slice(2));
    source = loadLegacyCommerceSource();
    validateLegacySource(source);

    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    audit = auditLegacyAssets(source, resolve(projectRoot, "public"));
    assertAssetsForMode(audit, mode);

    const rawDirectUrl = process.env.DIRECT_URL;
    if (!rawDirectUrl) {
      throw new LegacySourceError(
        "DIRECT_URL_REQUIRED",
        "DIRECT_URL is required to import legacy commerce data.",
      );
    }
    const directUrl = validatePostgresConnectionUrl(rawDirectUrl, {
      label: "DIRECT_URL",
      requiredSchema: "app",
    });

    const adapter = new PrismaPg({ connectionString: directUrl });
    prisma = new PrismaClient({ adapter });
    const report = await importLegacyCommerce(prisma, source, audit, mode);
    printJson(report);
  } catch (error) {
    printJson(failureReport(mode, error, source, audit));
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
  }
}

main().catch((error: unknown) => {
  printJson(failureReport("primary-only", error));
  process.exitCode = 1;
});
