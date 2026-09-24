/**
 * Synchronise the storefront catalog with src/data/supplier-catalog.json.
 *
 * The whole change is expressed as one transactional SQL script so the same
 * bytes can be reviewed, applied to a local copy and then applied to production
 * through psql. Modes:
 *
 *   tsx scripts/sync-supplier-catalog.ts                 # write output/supplier-catalog-sync.sql (dry run)
 *   tsx scripts/sync-supplier-catalog.ts --apply         # run the script against DATABASE_URL, then verify
 *   tsx scripts/sync-supplier-catalog.ts --verify        # compare DATABASE_URL with the catalog
 *   tsx scripts/sync-supplier-catalog.ts --verify-json f # compare a psql JSON export (see --verify-sql)
 *   tsx scripts/sync-supplier-catalog.ts --verify-sql    # print the verification query for psql -At
 *
 * Prices come from the catalog's `priceUsd` (spreadsheet column H, USD per box)
 * and are written as USD cents to the variant's active regular price. Product
 * images must already exist under public/ (run `npm run assets:products` first).
 */
import "dotenv/config";

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import pg from "pg";
import sharp from "sharp";

import { validatePostgresConnectionUrl } from "../src/lib/postgres-connection-url";

type CatalogEntry = {
  slug: string;
  previousSlug: string | null;
  title: string;
  family: string;
  strength: string;
  packCount: number;
  presentation: string;
  category: string;
  codes: string[];
  sourceRows: number[];
  priceUsd: number;
  available: boolean;
  image: string;
};

type Catalog = {
  source: string;
  sheet: string;
  priceColumn: string;
  priceTier: string;
  products: CatalogEntry[];
};

type VerificationRow = {
  slug: string;
  title: string;
  subtitle: string | null;
  position: number;
  variants: number;
  priceMode: string | null;
  trackInventory: boolean | null;
  amountMinor: string | number | null;
  image: string | null;
  category: string | null;
  canonical: string | null;
};

const root = resolve(import.meta.dirname, "..");
const SITE_ORIGIN = "https://flintmarrow.com";
const BRAND = "Flintmarrow";

function lit(value: string | number | boolean | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

function jsonLit(value: unknown): string {
  return `${lit(JSON.stringify(value))}::jsonb`;
}

function usdToCents(priceUsd: number): number {
  if (!Number.isInteger(priceUsd) || priceUsd <= 0) {
    throw new Error(`Invalid USD price ${priceUsd}`);
  }
  return priceUsd * 100;
}

async function loadCatalog(): Promise<Catalog> {
  const catalog = JSON.parse(
    await readFile(resolve(root, "src/data/supplier-catalog.json"), "utf8"),
  ) as Catalog;
  if (!catalog.products.length) throw new Error("Catalog is empty");
  if (new Set(catalog.products.map((p) => p.slug)).size !== catalog.products.length) {
    throw new Error("Catalog slugs are not unique");
  }
  return catalog;
}

async function imageFacts(image: string) {
  const path = resolve(root, "public", image.replace(/^\//u, ""));
  const bytes = await readFile(path).catch(() => {
    throw new Error(`Missing catalog image ${image}; run npm run assets:products first`);
  });
  const meta = await sharp(bytes).metadata();
  return {
    storageKey: image.replace(/^\//u, ""),
    publicUrl: image,
    mimeType: meta.format === "webp" ? "image/webp" : meta.format === "png" ? "image/png" : "image/jpeg",
    width: meta.width ?? null,
    height: meta.height ?? null,
    sizeBytes: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function buildSql(catalog: Catalog): Promise<string> {
  const syncedAt = new Date().toISOString();
  const statements: string[] = [
    "BEGIN;",
    "SET LOCAL statement_timeout = '120s';",
  ];

  // 1. Slug renames must happen before upserts so the freed slug can be taken by
  //    a new listing whose title matches that URL. No redirect is written: the
  //    old URL keeps serving a product with the title it always had. The rename
  //    is skipped once the target slug exists, which keeps re-runs idempotent.
  for (const entry of catalog.products) {
    if (!entry.previousSlug) continue;
    statements.push(
      `UPDATE app.products SET slug = ${lit(entry.slug)}, updated_at = now()
 WHERE slug = ${lit(entry.previousSlug)}
   AND NOT EXISTS (SELECT 1 FROM app.products WHERE slug = ${lit(entry.slug)});`,
      `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.products WHERE slug = ${lit(entry.slug)}) THEN
    RAISE EXCEPTION 'Rename ${entry.previousSlug} -> ${entry.slug} did not apply';
  END IF;
END $$;`,
    );
  }

  // 2. One block per listing.
  for (const [position, entry] of catalog.products.entries()) {
    const slug = lit(entry.slug);
    const image = await imageFacts(entry.image);
    const codeList = entry.codes.join(" / ");
    const cents = usdToCents(entry.priceUsd);
    const supplierMeta = {
      supplierPriceList: {
        source: catalog.source,
        sheet: catalog.sheet,
        rows: entry.sourceRows,
        codes: entry.codes,
        priceColumn: catalog.priceColumn,
        priceTier: catalog.priceTier,
        priceUsdPerBox: entry.priceUsd,
        syncedAt,
      },
    };
    // Public mappers only expose flat primitive option values, so codes are
    // stored as a single string rather than an array.
    const optionValues = {
      source: "supplier-price-list",
      default: true,
      presentation: entry.presentation,
      catalogNumber: entry.codes[0],
      supplierCodes: entry.codes.join(" / "),
      packCount: entry.packCount,
      quantityUnit: "box",
    };
    const shortDescription = `${entry.title} catalog listing. Supplier presentation: ${entry.presentation}. Product code: ${codeList}.`;
    const description =
      `${entry.title} catalog listing for laboratory procurement. Supplier presentation: ${entry.presentation}; the listed price is per box of ${entry.packCount} vials. ` +
      `Reference product code ${codeList} when ordering on WhatsApp.` +
      (entry.available ? "" : " Marked temporarily out of stock on the current supplier list.") +
      " Confirm current composition, documentation and handling instructions before ordering.";
    const seoDescription = `${entry.title}: ${entry.presentation}, USD ${entry.priceUsd} per box. Product code ${codeList}. Research-use catalog listing from ${BRAND}.`;

    statements.push(
      `-- ${entry.title} (${codeList}) USD ${entry.priceUsd}/box`,
      `INSERT INTO app.products (public_id, slug, title, subtitle, short_description, description, brand, status, position, published_at, data_quality_status, legacy_metadata, updated_at)
 VALUES (gen_random_uuid(), ${slug}, ${lit(entry.title)}, ${lit(entry.presentation)}, ${lit(shortDescription)}, ${lit(description)}, ${lit(BRAND)}, 'active', ${position}, now(), 'verified', ${jsonLit(supplierMeta)}, now())
 ON CONFLICT (slug) DO UPDATE SET
   title = EXCLUDED.title,
   subtitle = EXCLUDED.subtitle,
   short_description = EXCLUDED.short_description,
   description = EXCLUDED.description,
   brand = EXCLUDED.brand,
   status = 'active',
   position = EXCLUDED.position,
   published_at = COALESCE(app.products.published_at, now()),
   data_quality_status = 'verified',
   legacy_metadata = COALESCE(app.products.legacy_metadata, '{}'::jsonb) || EXCLUDED.legacy_metadata,
   deleted_at = NULL,
   updated_at = now();`,
      `INSERT INTO app.product_categories (product_id, category_id, position)
 SELECT p.id, c.id, 0 FROM app.products p JOIN app.categories c ON c.slug = ${lit(entry.category)}
 WHERE p.slug = ${slug}
   AND NOT EXISTS (SELECT 1 FROM app.product_categories pc WHERE pc.product_id = p.id);`,
      `UPDATE app.product_variants v SET
   price_mode = 'fixed',
   status = 'active',
   track_inventory = ${lit(!entry.available)},
   option_values = COALESCE(v.option_values, '{}'::jsonb) || ${jsonLit(optionValues)},
   published_at = COALESCE(v.published_at, now()),
   updated_at = now()
 FROM app.products p
 WHERE v.product_id = p.id AND p.slug = ${slug} AND v.deleted_at IS NULL;`,
      `INSERT INTO app.product_variants (public_id, product_id, title, price_mode, status, option_values, track_inventory, position, published_at, updated_at)
 SELECT gen_random_uuid(), p.id, 'Default', 'fixed', 'active', ${jsonLit(optionValues)}, ${lit(!entry.available)}, 0, now(), now()
 FROM app.products p
 WHERE p.slug = ${slug}
   AND NOT EXISTS (SELECT 1 FROM app.product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL);`,
      // The storefront accepts USD prices scoped to US or unscoped and prefers
      // the US-scoped row (see selectCurrentUsdPrice); admin writes use 'US'.
      `UPDATE app.prices SET amount_minor = ${cents}, updated_at = now()
 WHERE id = (
   SELECT pr.id FROM app.prices pr
   JOIN app.product_variants v ON v.id = pr.variant_id
   JOIN app.products p ON p.id = v.product_id
   WHERE p.slug = ${slug} AND v.deleted_at IS NULL
     AND pr.currency = 'USD' AND pr.kind = 'regular'
     AND (pr.country_code = 'US' OR pr.country_code IS NULL)
     AND pr.is_active AND pr.deleted_at IS NULL
   ORDER BY v.position, v.id, (pr.country_code = 'US') DESC NULLS LAST, pr.created_at DESC, pr.id DESC
   LIMIT 1)
   AND amount_minor <> ${cents};`,
      `INSERT INTO app.prices (public_id, variant_id, currency, kind, country_code, amount_minor, is_active, updated_at)
 SELECT gen_random_uuid(), v.id, 'USD', 'regular', 'US', ${cents}, true, now()
 FROM app.product_variants v JOIN app.products p ON p.id = v.product_id
 WHERE p.slug = ${slug} AND v.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM app.prices pr WHERE pr.variant_id = v.id AND pr.currency = 'USD' AND pr.kind = 'regular'
       AND (pr.country_code = 'US' OR pr.country_code IS NULL)
       AND pr.is_active AND pr.deleted_at IS NULL)
 ORDER BY v.position, v.id LIMIT 1;`,
      `INSERT INTO app.media (public_id, kind, storage_provider, storage_key, public_url, alt_text, mime_type, width, height, size_bytes, checksum, upload_status, updated_at)
 VALUES (gen_random_uuid(), 'image', 'local-public', ${lit(image.storageKey)}, ${lit(image.publicUrl)}, ${lit(entry.title)}, ${lit(image.mimeType)}, ${lit(image.width)}, ${lit(image.height)}, ${image.sizeBytes}, ${lit(image.checksum)}, 'ready', now())
 ON CONFLICT (storage_key) DO UPDATE SET
   alt_text = EXCLUDED.alt_text,
   mime_type = EXCLUDED.mime_type,
   width = EXCLUDED.width,
   height = EXCLUDED.height,
   size_bytes = EXCLUDED.size_bytes,
   checksum = EXCLUDED.checksum,
   upload_status = 'ready',
   deleted_at = NULL,
   updated_at = now();`,
      `DELETE FROM app.product_media pm USING app.products p
 WHERE pm.product_id = p.id AND p.slug = ${slug} AND pm.role = 'primary' AND pm.variant_id IS NULL
   AND pm.media_id <> (SELECT id FROM app.media WHERE storage_key = ${lit(image.storageKey)});`,
      `INSERT INTO app.product_media (product_id, media_id, role, position)
 SELECT p.id, m.id, 'primary', 0 FROM app.products p JOIN app.media m ON m.storage_key = ${lit(image.storageKey)}
 WHERE p.slug = ${slug}
   AND NOT EXISTS (SELECT 1 FROM app.product_media pm WHERE pm.product_id = p.id AND pm.media_id = m.id AND pm.variant_id IS NULL);`,
      `INSERT INTO app.seo_metadata (public_id, product_id, title, description, canonical_url, open_graph_media_id, no_index, no_follow, structured_data, updated_at)
 SELECT gen_random_uuid(), p.id, ${lit(`${entry.title} | ${BRAND}`)}, ${lit(seoDescription)}, ${lit(`${SITE_ORIGIN}/products/${entry.slug}`)}, m.id, false, false, NULL, now()
 FROM app.products p LEFT JOIN app.media m ON m.storage_key = ${lit(image.storageKey)}
 WHERE p.slug = ${slug}
 ON CONFLICT (product_id) DO UPDATE SET
   title = EXCLUDED.title,
   description = EXCLUDED.description,
   canonical_url = EXCLUDED.canonical_url,
   open_graph_media_id = EXCLUDED.open_graph_media_id,
   no_index = false,
   structured_data = NULL,
   updated_at = now();`,
    );
  }

  // 3. Retire everything the sheet no longer lists.
  const slugArray = `ARRAY[${catalog.products.map((p) => lit(p.slug)).join(", ")}]::text[]`;
  statements.push(
    `UPDATE app.products SET status = 'archived', updated_at = now()
 WHERE status = 'active' AND deleted_at IS NULL AND NOT (slug = ANY(${slugArray}));`,
    `UPDATE app.merchandising_placements SET is_active = false, updated_at = now()
 WHERE is_active AND product_id IN (SELECT id FROM app.products WHERE status <> 'active' OR deleted_at IS NOT NULL);`,
    `UPDATE app.seo_metadata SET structured_data = NULL, updated_at = now()
 WHERE structured_data::text ILIKE '%sheng.an%';`,
  );

  // 4. Invariants the storefront depends on.
  statements.push(
    `DO $$
DECLARE
  active_count integer;
  broken integer;
BEGIN
  SELECT count(*) INTO active_count FROM app.products WHERE status = 'active' AND deleted_at IS NULL;
  IF active_count <> ${catalog.products.length} THEN
    RAISE EXCEPTION 'Expected ${catalog.products.length} active products, found %', active_count;
  END IF;
  SELECT count(*) INTO broken FROM app.products p
  WHERE p.status = 'active' AND p.deleted_at IS NULL AND (
    (SELECT count(*) FROM app.product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM app.product_variants v JOIN app.prices pr ON pr.variant_id = v.id
      WHERE v.product_id = p.id AND v.deleted_at IS NULL AND v.price_mode = 'fixed' AND v.status = 'active'
        AND pr.currency = 'USD' AND pr.kind = 'regular' AND (pr.country_code = 'US' OR pr.country_code IS NULL)
        AND pr.is_active AND pr.deleted_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM app.product_media pm WHERE pm.product_id = p.id AND pm.role = 'primary' AND pm.variant_id IS NULL)
    OR NOT EXISTS (SELECT 1 FROM app.product_categories pc WHERE pc.product_id = p.id));
  IF broken <> 0 THEN
    RAISE EXCEPTION '% active products lack a single priced variant, primary image or category', broken;
  END IF;
END $$;`,
    "COMMIT;",
  );

  return `${statements.join("\n\n")}\n`;
}

export const VERIFY_SQL = `SELECT COALESCE(json_agg(json_build_object(
  'slug', p.slug,
  'title', p.title,
  'subtitle', p.subtitle,
  'position', p.position,
  'variants', (SELECT count(*) FROM app.product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL),
  'priceMode', (SELECT v.price_mode::text FROM app.product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL ORDER BY v.position, v.id LIMIT 1),
  'trackInventory', (SELECT v.track_inventory FROM app.product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL ORDER BY v.position, v.id LIMIT 1),
  'amountMinor', (SELECT pr.amount_minor FROM app.prices pr JOIN app.product_variants v ON v.id = pr.variant_id
                  WHERE v.product_id = p.id AND v.deleted_at IS NULL AND pr.currency = 'USD' AND pr.kind = 'regular'
                    AND (pr.country_code = 'US' OR pr.country_code IS NULL) AND pr.is_active AND pr.deleted_at IS NULL
                  ORDER BY v.position, v.id, (pr.country_code = 'US') DESC NULLS LAST, pr.created_at DESC, pr.id DESC LIMIT 1),
  'image', (SELECT m.public_url FROM app.product_media pm JOIN app.media m ON m.id = pm.media_id
            WHERE pm.product_id = p.id AND pm.role = 'primary' AND pm.variant_id IS NULL LIMIT 1),
  'category', (SELECT c.slug FROM app.product_categories pc JOIN app.categories c ON c.id = pc.category_id
               WHERE pc.product_id = p.id ORDER BY pc.position LIMIT 1),
  'canonical', s.canonical_url
) ORDER BY p.position, p.id), '[]'::json)
FROM app.products p LEFT JOIN app.seo_metadata s ON s.product_id = p.id
WHERE p.status = 'active' AND p.deleted_at IS NULL;`;

function verify(catalog: Catalog, rows: VerificationRow[]) {
  const problems: string[] = [];
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const expected = new Set(catalog.products.map((p) => p.slug));
  for (const row of rows) {
    if (!expected.has(row.slug)) problems.push(`${row.slug}: active but not on the price list`);
  }
  for (const [position, entry] of catalog.products.entries()) {
    const row = bySlug.get(entry.slug);
    if (!row) {
      problems.push(`${entry.slug}: missing or not active`);
      continue;
    }
    const cents = usdToCents(entry.priceUsd);
    if (row.title !== entry.title) problems.push(`${entry.slug}: title "${row.title}" ≠ "${entry.title}"`);
    if (row.subtitle !== entry.presentation) problems.push(`${entry.slug}: subtitle "${row.subtitle}" ≠ "${entry.presentation}"`);
    if (Number(row.amountMinor) !== cents) problems.push(`${entry.slug}: price ${row.amountMinor} ≠ ${cents} (USD ${entry.priceUsd})`);
    if (row.priceMode !== "fixed") problems.push(`${entry.slug}: price mode ${row.priceMode}`);
    if (Number(row.variants) !== 1) problems.push(`${entry.slug}: ${row.variants} live variants`);
    if (row.trackInventory !== !entry.available) problems.push(`${entry.slug}: track_inventory ${row.trackInventory}`);
    if (row.image !== entry.image) problems.push(`${entry.slug}: image ${row.image} ≠ ${entry.image}`);
    if (!row.category) problems.push(`${entry.slug}: no category`);
    if (row.canonical !== `${SITE_ORIGIN}/products/${entry.slug}`) problems.push(`${entry.slug}: canonical ${row.canonical}`);
    if (row.position !== position) problems.push(`${entry.slug}: position ${row.position} ≠ ${position}`);
  }
  return problems;
}

function connectionString() {
  const raw = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("DIRECT_URL or DATABASE_URL is required.");
  const url = validatePostgresConnectionUrl(raw, {
    label: process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL",
    requiredSchema: "app",
  });
  const host = new URL(url.replace(/^postgres(ql)?:/u, "http:")).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host) && !process.argv.includes("--allow-remote")) {
    throw new Error(`Refusing to touch non-local database host ${host} without --allow-remote; use the emitted SQL with psql instead.`);
  }
  return url;
}

async function withClient<T>(fn: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const catalog = await loadCatalog();

  if (args.includes("--verify-sql")) {
    process.stdout.write(`${VERIFY_SQL}\n`);
    return;
  }

  const verifyJsonIndex = args.indexOf("--verify-json");
  if (verifyJsonIndex !== -1) {
    const file = args[verifyJsonIndex + 1];
    if (!file) throw new Error("--verify-json needs a file path");
    const rows = JSON.parse(await readFile(resolve(file), "utf8")) as VerificationRow[];
    return report(catalog, rows);
  }

  if (args.includes("--verify")) {
    const rows = await withClient(async (client) => (await client.query(VERIFY_SQL)).rows[0].coalesce as VerificationRow[]);
    return report(catalog, rows);
  }

  const sql = await buildSql(catalog);
  const sqlIndex = args.indexOf("--sql");
  const sqlPath = resolve(sqlIndex !== -1 && args[sqlIndex + 1] ? args[sqlIndex + 1] : "output/supplier-catalog-sync.sql");
  await mkdir(resolve(sqlPath, ".."), { recursive: true });
  await writeFile(sqlPath, sql);
  console.log(`SQL written to ${sqlPath} (${catalog.products.length} listings, ${sql.length} bytes)`);

  if (!args.includes("--apply")) {
    console.log("Dry run only. Re-run with --apply to execute against DATABASE_URL.");
    return;
  }

  const rows = await withClient(async (client) => {
    await client.query(sql);
    return (await client.query(VERIFY_SQL)).rows[0].coalesce as VerificationRow[];
  });
  return report(catalog, rows);
}

function report(catalog: Catalog, rows: VerificationRow[]) {
  const problems = verify(catalog, rows);
  console.log(
    JSON.stringify(
      {
        expected: catalog.products.length,
        active: rows.length,
        problems: problems.length,
      },
      null,
      2,
    ),
  );
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  if (problems.length) process.exitCode = 1;
  else console.log("✓ Storefront matches the supplier catalog.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
