import type { Metadata } from "next";

export type PublicSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function hasPublicSearchParams(searchParams: PublicSearchParams) {
  return Object.keys(searchParams).length > 0;
}

export function publicRobots(
  searchParams: PublicSearchParams,
  options: { noIndex?: boolean; noFollow?: boolean } = {},
): Metadata["robots"] {
  return {
    index: !(options.noIndex || hasPublicSearchParams(searchParams)),
    follow: !options.noFollow,
  };
}

export function normalizePublicQuery(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim().slice(0, 120) ?? "";
}

/**
 * Real listing pages (page 2, 3, …) are indexable with their own canonical URL,
 * following Google's pagination guidance. Filters, search and display variants
 * stay noindex and point back to the listing.
 */
export function catalogListingSeo(
  path: string,
  query: PublicSearchParams,
  page: number,
) {
  const canonical = page > 1 ? `${path}?page=${page}` : path;
  const extraParams = Object.keys(query).some((key) => key !== "page");
  const validPage = query.page === undefined || query.page === String(page);
  return {
    canonical,
    robots: { index: !extraParams && validPage, follow: true },
  };
}

/** Reject malformed and clamped page requests instead of serving a duplicate page. */
export function isValidListingPage(
  query: PublicSearchParams,
  resolvedPage: number,
) {
  return query.page === undefined || query.page === String(resolvedPage);
}
