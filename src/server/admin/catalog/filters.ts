import {
  normalizePageSearchParameter,
  normalizeSearchText,
  type SearchParameter,
} from "@/lib/pagination";

export const ADMIN_CATALOG_PAGE_SIZE = 25;

export type AdminCatalogFilters = {
  productQuery: string;
  productPage: number;
  categoryQuery: string;
  categoryPage: number;
};

function invalidPageParameter(value: SearchParameter) {
  if (value === undefined) return false;
  return (
    typeof value !== "string" ||
    !/^[1-9]\d{0,4}$/u.test(value) ||
    Number(value) > 10_000
  );
}

export function parseAdminCatalogFilters(
  searchParams: Record<string, SearchParameter> = {},
): { filters: AdminCatalogFilters; validationError: boolean } {
  const productQuery = normalizeSearchText(searchParams.productQ);
  const categoryQuery = normalizeSearchText(searchParams.categoryQ);

  return {
    filters: {
      productQuery,
      productPage: normalizePageSearchParameter(searchParams.productPage),
      categoryQuery,
      categoryPage: normalizePageSearchParameter(searchParams.categoryPage),
    },
    validationError:
      (searchParams.productQ !== undefined &&
        typeof searchParams.productQ !== "string") ||
      (searchParams.categoryQ !== undefined &&
        typeof searchParams.categoryQ !== "string") ||
      invalidPageParameter(searchParams.productPage) ||
      invalidPageParameter(searchParams.categoryPage),
  };
}
