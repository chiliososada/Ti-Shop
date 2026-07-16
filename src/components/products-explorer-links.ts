import type { PublicProductSort } from "@/domain/catalog";
import { buildQueryHref } from "@/lib/pagination";

export function buildProductsExplorerHref({
  category,
  query,
  sort,
  page = 1,
}: {
  category: string;
  query: string;
  sort: PublicProductSort;
  page?: number;
}) {
  return buildQueryHref("/products", {
    category: category === "all" ? undefined : category,
    page: page > 1 ? page : undefined,
    q: query || undefined,
    sort: sort === "recommended" ? undefined : sort,
  });
}
