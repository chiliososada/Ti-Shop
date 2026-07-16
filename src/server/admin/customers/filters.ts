import {
  normalizePageSearchParameter,
  normalizeSearchText,
  type SearchParameter,
} from "@/lib/pagination";

export const ADMIN_CUSTOMER_PAGE_SIZE = 30;

export type AdminCustomerFilters = {
  q: string;
  page: number;
};

function invalidPageParameter(value: SearchParameter) {
  if (value === undefined) return false;
  return (
    typeof value !== "string" ||
    !/^[1-9]\d{0,4}$/u.test(value) ||
    Number(value) > 10_000
  );
}

export function parseAdminCustomerFilters(
  searchParams: Record<string, SearchParameter> = {},
): { filters: AdminCustomerFilters; validationError: boolean } {
  return {
    filters: {
      q: normalizeSearchText(searchParams.q),
      page: normalizePageSearchParameter(searchParams.page),
    },
    validationError:
      (searchParams.q !== undefined && typeof searchParams.q !== "string") ||
      invalidPageParameter(searchParams.page),
  };
}
