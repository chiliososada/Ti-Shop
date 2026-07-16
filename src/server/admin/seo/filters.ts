import {
  normalizePageSearchParameter,
  normalizeSearchText,
  type SearchParameter,
} from "@/lib/pagination";

export const ADMIN_SEO_PAGE_SIZE = 30;
export const ADMIN_SEO_INDEX_TYPES = [
  "product",
  "category",
  "blog",
  "page",
  "redirect",
] as const;

export type AdminSeoIndexType = (typeof ADMIN_SEO_INDEX_TYPES)[number];

export type AdminSeoFilters = {
  entityType: AdminSeoIndexType;
  query: string;
  page: number;
};

function isAdminSeoIndexType(value: string): value is AdminSeoIndexType {
  return (ADMIN_SEO_INDEX_TYPES as readonly string[]).includes(value);
}

function invalidPageParameter(value: SearchParameter) {
  if (value === undefined) return false;
  return (
    typeof value !== "string" ||
    !/^[1-9]\d{0,4}$/u.test(value) ||
    Number(value) > 10_000
  );
}

function normalizeEntityType(value: SearchParameter): AdminSeoIndexType {
  return typeof value === "string" && isAdminSeoIndexType(value)
    ? value
    : "product";
}

export function parseAdminSeoFilters(
  searchParams: Record<string, SearchParameter> = {},
): { filters: AdminSeoFilters; validationError: boolean } {
  return {
    filters: {
      entityType: normalizeEntityType(searchParams.entity),
      query: normalizeSearchText(searchParams.q),
      page: normalizePageSearchParameter(searchParams.page),
    },
    validationError:
      (searchParams.entity !== undefined &&
        (typeof searchParams.entity !== "string" ||
          !isAdminSeoIndexType(searchParams.entity))) ||
      (searchParams.q !== undefined && typeof searchParams.q !== "string") ||
      invalidPageParameter(searchParams.page),
  };
}
