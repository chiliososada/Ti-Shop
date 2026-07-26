import Link from "next/link";

import { PaginationNav } from "@/components/PaginationNav";
import { ProductCard } from "@/components/ProductCard";
import type {
  PublicCategoryListItemDto,
  PublicProductSort,
  PublicProductSummaryDto,
} from "@/domain/catalog";
import { buildProductsExplorerHref } from "@/components/products-explorer-links";

const SORT_OPTIONS: ReadonlyArray<{
  value: PublicProductSort;
  label: string;
}> = [
  { value: "recommended", label: "Recommended" },
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "newest", label: "Newest" },
];

export function ProductsExplorer({
  products,
  total,
  page,
  pageCount,
  categories,
  activeCategory = "all",
  query = "",
  sort = "recommended",
}: {
  products: PublicProductSummaryDto[];
  total: number;
  page: number;
  pageCount: number;
  categories: PublicCategoryListItemDto[];
  activeCategory?: string;
  query?: string;
  sort?: PublicProductSort;
}) {
  const tabs = [
    { slug: "all", name: "All" },
    ...categories.map((category) => ({
      slug: category.slug,
      name: category.name,
    })),
  ];

  return (
    <div>
      <div className="flex flex-col gap-5 border-b border-line pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" aria-label="Product categories">
          {tabs.map((tab) => (
            <Link
              key={tab.slug}
              href={buildProductsExplorerHref({
                category: tab.slug,
                query,
                sort,
              })}
              aria-current={activeCategory === tab.slug ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                activeCategory === tab.slug
                  ? "bg-ink-900 text-cream-50"
                  : "bg-surface-alt text-body hover:bg-cream-300"
              }`}
            >
              {tab.name}
            </Link>
          ))}
        </div>
        <form action="/products" className="relative w-full lg:w-72">
          {activeCategory !== "all" ? (
            <input type="hidden" name="category" value={activeCategory} />
          ) : null}
          {sort !== "recommended" ? (
            <input type="hidden" name="sort" value={sort} />
          ) : null}
          <label htmlFor="catalog-search" className="sr-only">
            Search products
          </label>
          <input
            id="catalog-search"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search product name…"
            className="w-full rounded-full border border-ink-900/15 bg-cream-50 px-5 py-2.5 text-sm outline-none transition-colors focus:border-sage-500 focus:ring-2 focus:ring-sage-400/30"
          />
        </form>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <p className="text-caption text-muted" aria-live="polite">
          Showing {products.length} of {total} catalog{" "}
          {total === 1 ? "listing" : "listings"}
        </p>
        <nav
          aria-label="Sort products"
          className="flex flex-wrap items-center gap-2 text-caption"
        >
          <span className="font-semibold text-muted">Sort:</span>
          {SORT_OPTIONS.map((option) => (
            <Link
              key={option.value}
              href={buildProductsExplorerHref({
                category: activeCategory,
                query,
                sort: option.value,
              })}
              aria-current={sort === option.value ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 font-semibold transition-colors ${
                sort === option.value
                  ? "bg-ink-900 text-cream-50"
                  : "bg-surface-alt text-body hover:bg-cream-300"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.publicId} product={product} />
        ))}
      </div>

      {products.length === 0 ? (
        <p className="mt-16 text-center text-muted">
          No catalog listings match your filters.
        </p>
      ) : null}

      <PaginationNav
        page={page}
        pageCount={pageCount}
        previousHref={
          page > 1
            ? buildProductsExplorerHref({
                category: activeCategory,
                query,
                sort,
                page: page - 1,
              })
            : null
        }
        nextHref={
          page < pageCount
            ? buildProductsExplorerHref({
                category: activeCategory,
                query,
                sort,
                page: page + 1,
              })
            : null
        }
        label="Product catalog pagination"
      />
    </div>
  );
}
