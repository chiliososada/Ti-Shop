# Flintmarrow SEO improvements — 2026-09-24

Site: https://flintmarrow.com/. Baseline audit ran against production after the
2026-09-23 price-list catalog sync (182 listings). Lighthouse mobile scores were
already SEO 100 / best-practices 100 on the home and product pages; the gaps were
structural: how listings are paginated, discovered, linked and cached.

## Baseline findings

- Paginated catalog pages (`/products?page=2` …) were `noindex` and pointed their
  canonical at page 1, so products on pages 2–8 had no indexable listing page
  linking to them. Out-of-range pages (`?page=999`) returned 200 with page 1.
- The sitemap listed product URLs but no images; there was no A–Z directory.
- Product pages linked only to four "related" products from the same category,
  not to the other strengths of the same material, and not to the guides.
- Product JSON-LD carried no `sku` (the database has no SKU; the product code
  lives in option values).
- 23 listings retired by the price-list sync and 21 older archived listings
  returned 404 instead of redirecting to a replacement.
- `public/` images were served with `Cache-Control: public, max-age=0`.
- HTTP and `www` were not redirected (fixed the same day at Kong, see
  `hpe1-kong-https` in the assistant memory / deploy notes) and HSTS was absent.

## Implemented

1. **Pagination policy** (`src/app/_lib/public-seo.ts`): real listing pages are
   indexable with a self-referencing canonical (`/products?page=2`) and a
   `, Page N` / `— Page N` title suffix; filter, search and sort variants stay
   `noindex, follow`; malformed or out-of-range page parameters return 404.
   Applied to `/products`, `/categories/[slug]` and `/blog`.
2. **CollectionPage / ItemList JSON-LD** on catalog and category pages
   (`CatalogJsonLd`), positions offset by page.
3. **Image sitemap**: every product entry carries its public primary image
   (`publicProductSitemapSelect` → `images` on the sitemap DTO).
4. **`/research-materials` A–Z directory**: 182 presentations grouped into 95
   materials, each line with strength, USD price per box and product code.
   Family, strength and codes come from `src/data/supplier-catalog.json`
   (`src/lib/catalog-specifications.ts`); publication state and prices come from
   the database (`src/server/catalog/public-directory.ts`). Linked from the
   catalog page and the footer; included in the sitemap.
5. **Product pages**: a "Compare presentations" block links every strength of the
   same material with its price; related products exclude those siblings; a
   guides block (`GuideReading`) links the four published articles from product,
   category and directory pages.
6. **Product JSON-LD `sku`**: product code (variant SKU when present, otherwise the
   supplier code) at Product and Offer level.
7. **Redirects for retired listings** (`scripts/retired-product-redirects.ts`):
   44 explicit 301s from retired product URLs to the nearest published strength
   of the same material, or to the research category when none remains. The
   script validates every target against the published catalog and refuses to
   redirect a published slug. Emit and apply:

   ```sh
   npx tsx scripts/retired-product-redirects.ts > output/retired-product-redirects.sql
   ssh hpe1 'cd ~/flintmarrow && docker compose exec -T db psql -U postgres -d ti_shop -v ON_ERROR_STOP=1 -f -' < output/retired-product-redirects.sql
   ```

8. **Static media caching** (`next.config.ts`): `/products`, `/categories`,
   `/brand` and `/video` files are served with
   `public, max-age=86400, stale-while-revalidate=604800`. HTML stays uncached.
9. Variant option values now store supplier codes as a string (the public
   mappers drop any option set containing arrays); existing rows were flattened
   with a one-off `UPDATE` (see `scratchpad`/deploy notes) so `catalogNumber` is
   exposed again.

## Verification

- `npm run typecheck`, `npm run lint`, unit suite (703 passed; the only failure is
  the MinIO integration test that needs `STORAGE_TEST_S3_*`).
- `SITE_URL=https://flintmarrow.com npm run build`, then the production SEO
  regression (`scripts/verify-production.mjs`) against a local copy of the
  production database: 205 public URLs validated (182 products, 6 categories,
  4 articles, directory and policy pages), sitemap with 182 image entries.
- Local preview: `?page=2` indexable with its own canonical, `?page=999` → 404,
  filters `noindex`; directory renders 95 materials; product page shows
  "Compare presentations"; retired URLs 301 to their replacement.

## Compliance clean-up — 2026-09-26

- Bacteriostatic water (price-list rows 180/181) is no longer listed; FDA's 2026
  warning letters cite reconstitution supplies sold with peptides as evidence of
  human-use intent. Product and category URLs 301 to `/products`.
- The reconstitution how-to post was archived and 301s to `/blog`; the GLP-1
  post's reconstitution section became "Documentation and Storage
  Considerations". The blog now has 3 posts (`src/data/blog.ts` and the
  database were updated together; the one-off SQL asserted that no published
  post mentions reconstitution or syringes).
- Do not add reconstitution guides, dosing calculators, syringe or needle
  content, links to human-effect databases, or disease/weight-loss claims.

## Not done / next steps

- **Search Console**: verify `flintmarrow.com` (DNS TXT, like PureForm) and
  submit `https://flintmarrow.com/sitemap.xml`; only the owner can do this.
- **Content depth**: product descriptions are still templated. The next lever is
  a short, factual, research-only description per material family (~95 texts)
  plus richer category intros. Draft these once query data shows which families
  earn impressions; do not add medical claims, CAS numbers, purity or
  certifications that the supplier has not documented.
- The FAQ, shipping and research-use policy pages are 82–93% identical to
  PureForm's. Low ranking weight, but rewrite whichever site should own those
  queries if they start competing.
- Home page mobile Lighthouse performance is 84 (hero video poster is the LCP,
  320 ms blocking time). Converting the poster to WebP and trimming client JS
  are the remaining performance items.
