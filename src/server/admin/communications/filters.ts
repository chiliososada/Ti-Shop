import {
  normalizePageSearchParameter,
  normalizeSearchText,
  type SearchParameter,
} from "@/lib/pagination";

export const ADMIN_COMMUNICATIONS_PAGE_SIZE = 30;

export const INQUIRY_STATUS_FILTERS = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
] as const;

export const WHATSAPP_INTENT_STATUS_FILTERS = ["RECORDED", "OPENED"] as const;

export type InquiryStatusFilter =
  | ""
  | (typeof INQUIRY_STATUS_FILTERS)[number];
export type WhatsAppIntentStatusFilter =
  | ""
  | (typeof WHATSAPP_INTENT_STATUS_FILTERS)[number];

export type AdminCommunicationsFilters = {
  inquiryQuery: string;
  inquiryStatus: InquiryStatusFilter;
  inquiryPage: number;
  intentQuery: string;
  intentStatus: WhatsAppIntentStatusFilter;
  intentPage: number;
};

function normalizeChoice<const T extends readonly string[]>(
  value: SearchParameter,
  allowed: T,
): "" | T[number] {
  return typeof value === "string" && allowed.includes(value) ? value : "";
}

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

function invalidChoiceParameter(
  value: SearchParameter,
  allowed: readonly string[],
) {
  return (
    value !== undefined &&
    (typeof value !== "string" || (value !== "" && !allowed.includes(value)))
  );
}

export function parseAdminCommunicationsFilters(
  searchParams: Record<string, SearchParameter> = {},
): { filters: AdminCommunicationsFilters; validationError: boolean } {
  return {
    filters: {
      inquiryQuery: normalizeSearchText(searchParams.inquiryQ),
      inquiryStatus: normalizeChoice(
        searchParams.inquiryStatus,
        INQUIRY_STATUS_FILTERS,
      ),
      inquiryPage: normalizePageSearchParameter(searchParams.inquiryPage),
      intentQuery: normalizeSearchText(searchParams.intentQ),
      intentStatus: normalizeChoice(
        searchParams.intentStatus,
        WHATSAPP_INTENT_STATUS_FILTERS,
      ),
      intentPage: normalizePageSearchParameter(searchParams.intentPage),
    },
    validationError:
      invalidTextParameter(searchParams.inquiryQ) ||
      invalidChoiceParameter(
        searchParams.inquiryStatus,
        INQUIRY_STATUS_FILTERS,
      ) ||
      invalidPageParameter(searchParams.inquiryPage) ||
      invalidTextParameter(searchParams.intentQ) ||
      invalidChoiceParameter(
        searchParams.intentStatus,
        WHATSAPP_INTENT_STATUS_FILTERS,
      ) ||
      invalidPageParameter(searchParams.intentPage),
  };
}
