/**
 * Emit SQL that 301-redirects retired product URLs to the closest published
 * listing (same material, nearest strength) or, when no listing of that
 * material remains, to the research category. Keeps link equity and sends
 * visitors with old links somewhere useful instead of a 404.
 *
 *   tsx scripts/retired-product-redirects.ts > output/retired-product-redirects.sql
 *
 * Every target is validated against src/data/supplier-catalog.json (published
 * listings) and src/data/categories.ts before any SQL is written.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { categories } from "../src/data/categories";

const root = resolve(import.meta.dirname, "..");
const catalog = JSON.parse(
  readFileSync(resolve(root, "src/data/supplier-catalog.json"), "utf8"),
) as { products: Array<{ slug: string }> };
const publishedSlugs = new Set(catalog.products.map((product) => product.slug));
const categorySlugs = new Set(categories.map((category) => category.slug));

/** retired slug → destination path (product slug or /categories/<slug>). */
const redirects: Record<string, string> = {
  // Retired by the 2026-09-23 price-list sync.
  dsip: "dsip-5mg",
  hcg: "hcg-5000iu",
  "hcg-2000iu": "hcg-5000iu",
  "semaglutide-40mg": "semaglutide-50mg",
  "semaglutide-60mg": "semaglutide-50mg",
  "semaglutide-100mg": "semaglutide-50mg",
  "large-bottle-10ml": "/categories/bac-water",
  "bpc-157-15mg-plus-tb-500-15mg-blend": "bpc-157-10mg-plus-tb-500-10mg-blend",
  "cjc-1295-with-dac-10mg": "cjc-1295-with-dac-5mg",
  "oxytocin-10mg": "oxytocin-5mg",
  "p21-p021-10mg": "p21-5mg",
  "thymalin-20mg": "thymalin",
  "botulinum-toxin-100iu": "/categories/skin-aging",
  "ftpp-adipotide-10mg": "ftpp-adipotide",
  "cbl-514-5mg": "/categories/metabolic",
  "cbl-514-10mg": "/categories/metabolic",
  "cbl-514-20mg": "/categories/metabolic",
  "os-01-100mg": "/categories/skin-aging",
  "melanotan-ii-20mg": "melanotan-il",
  "bacteriostatic-water-7ml": "bacteriostatic-water-10ml",
  "sermorelin-acetate-20mg": "sermorelin-acetate-10mg",
  "follistatin-344-10mg": "follistatin-344-1mg",
  "hgh-fragment-176-191-10iu": "hgh-fragment-176-191-10mg",
  // Archived before the sync; their URLs may still be indexed or bookmarked.
  "ace-031": "ace-031-1mg",
  adamax: "adamax-5mg",
  "bpc157-500mcg": "bpc-157",
  "cagrisema-2-5mg-2-5mg": "cagrisema-2-5mg-plus-2-5mg-blend",
  dermorphin: "dermorphin-5mg",
  dulaglutide: "dulaglutide-5mg",
  epo: "epo-3000iu",
  fox04: "foxo4-dri-2mg",
  "frag-17-23": "/categories/muscle-growth",
  "fst-344": "follistatin-344-1mg",
  "hgh-fragment-176-191": "hgh-fragment-176-191-2mg",
  "l-carnitine": "l-carnitine-1200mg",
  "lipo-c": "mic-lipo-c-with-b12",
  liraglutide: "liraglutide-5mg",
  "pe-22-28": "pe-22-28-5mg",
  "retatrutide-20mg-trizepatide-40mg": "/categories/metabolic",
  semaglutide: "semaglutide-5mg",
  "sermorelin-acetate": "sermorelin-acetate-5mg",
  "slu-pp-332-250mcg": "slu-pp-322",
  tesofensine: "/categories/metabolic",
  vip: "vip-10mg",
};

function lit(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

const statements = ["BEGIN;"];
for (const [source, target] of Object.entries(redirects)) {
  if (publishedSlugs.has(source)) {
    throw new Error(`${source} is a published listing and must not be redirected`);
  }
  const destination = target.startsWith("/categories/") ? target : `/products/${target}`;
  const valid = target.startsWith("/categories/")
    ? categorySlugs.has(target.slice("/categories/".length))
    : publishedSlugs.has(target);
  if (!valid) throw new Error(`${source}: unknown redirect target ${target}`);
  statements.push(
    `INSERT INTO app.redirects (public_id, source_path, destination_path, status_code, preserve_query, is_active, updated_at)
 SELECT gen_random_uuid(), ${lit(`/products/${source}`)}, ${lit(destination)}, 301, true, true, now()
 WHERE NOT EXISTS (SELECT 1 FROM app.products WHERE slug = ${lit(source)} AND status = 'active' AND deleted_at IS NULL)
 ON CONFLICT (source_path) DO UPDATE SET destination_path = EXCLUDED.destination_path, status_code = 301, is_active = true, updated_at = now();`,
  );
}
statements.push("COMMIT;");
process.stdout.write(`${statements.join("\n\n")}\n`);
console.error(`${Object.keys(redirects).length} redirects`);
