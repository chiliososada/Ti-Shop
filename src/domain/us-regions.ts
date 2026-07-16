/**
 * Canonical set of USPS two-letter codes accepted for shipping/billing: the
 * 50 states, DC, and the five inhabited territories the store ships to. Both
 * the account address form and the checkout address share this one list, so a
 * bogus code like "ZZ" can never reach an order's shipping snapshot.
 */
export const US_REGION_CODES = [
  // 50 states
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  // District of Columbia
  "DC",
  // Inhabited territories
  "AS", // American Samoa
  "GU", // Guam
  "MP", // Northern Mariana Islands
  "PR", // Puerto Rico
  "VI", // U.S. Virgin Islands
] as const;

export type UsRegionCode = (typeof US_REGION_CODES)[number];

const US_REGION_CODE_SET = new Set<string>(US_REGION_CODES);

export function isUsRegionCode(value: string): value is UsRegionCode {
  return US_REGION_CODE_SET.has(value);
}
