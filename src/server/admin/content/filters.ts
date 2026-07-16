import {
  normalizePageSearchParameter,
  normalizeSearchText,
  type SearchParameter,
} from "@/lib/pagination";

export const ADMIN_CONTENT_PAGE_SIZE = 25;

export type AdminContentFilters = {
  blogQuery: string;
  blogPage: number;
  pageQuery: string;
  pagePage: number;
  faqQuery: string;
  faqPage: number;
};

function invalidPageParameter(value: SearchParameter) {
  if (value === undefined) return false;
  return (
    typeof value !== "string" ||
    !/^[1-9]\d{0,4}$/u.test(value) ||
    Number(value) > 10_000
  );
}

function invalidTextParameter(value: SearchParameter) {
  return value !== undefined && typeof value !== "string";
}

export function parseAdminContentFilters(
  searchParams: Record<string, SearchParameter> = {},
): { filters: AdminContentFilters; validationError: boolean } {
  return {
    filters: {
      blogQuery: normalizeSearchText(searchParams.blogQ),
      blogPage: normalizePageSearchParameter(searchParams.blogPage),
      pageQuery: normalizeSearchText(searchParams.pageQ),
      pagePage: normalizePageSearchParameter(searchParams.pagePage),
      faqQuery: normalizeSearchText(searchParams.faqQ),
      faqPage: normalizePageSearchParameter(searchParams.faqPage),
    },
    validationError:
      invalidTextParameter(searchParams.blogQ) ||
      invalidPageParameter(searchParams.blogPage) ||
      invalidTextParameter(searchParams.pageQ) ||
      invalidPageParameter(searchParams.pagePage) ||
      invalidTextParameter(searchParams.faqQ) ||
      invalidPageParameter(searchParams.faqPage),
  };
}
