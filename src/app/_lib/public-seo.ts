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
