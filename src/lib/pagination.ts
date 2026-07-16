export type SearchParameter = string | string[] | undefined;

export type Pagination = {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  skip: number;
};

const MAX_PAGE = 10_000;

export function normalizeSearchText(
  value: SearchParameter,
  maximumLength = 120,
): string {
  if (typeof value !== "string" || maximumLength < 1) return "";

  return value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, maximumLength)
    .trim();
}

export function normalizePageSearchParameter(
  value: SearchParameter,
  fallback = 1,
): number {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d{0,4}$/u.test(value)
  ) {
    return fallback;
  }

  const page = Number(value);
  return Number.isSafeInteger(page) && page <= MAX_PAGE ? page : fallback;
}

export function normalizePageOption(
  value: number | undefined,
  fallback = 1,
): number {
  if (value === undefined || !Number.isSafeInteger(value)) return fallback;
  return value >= 1 && value <= MAX_PAGE ? value : fallback;
}

export function buildPagination(
  totalValue: number,
  requestedPageValue: number,
  pageSizeValue: number,
): Pagination {
  const total = Number.isSafeInteger(totalValue) && totalValue > 0 ? totalValue : 0;
  const pageSize =
    Number.isSafeInteger(pageSizeValue) && pageSizeValue > 0
      ? pageSizeValue
      : 1;
  const requestedPage = normalizePageOption(requestedPageValue);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);

  return {
    page,
    pageSize,
    pageCount,
    total,
    skip: (page - 1) * pageSize,
  };
}

export function buildQueryHref(
  pathname: string,
  values: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(values).sort()) {
    const value = values[key];
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
