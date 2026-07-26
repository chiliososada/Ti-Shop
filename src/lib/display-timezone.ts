/**
 * Every operator- and customer-facing timestamp renders in US Central Time:
 * the storefront serves the United States market, and the operations team
 * agreed on one wall clock for order, payment, and fulfillment records.
 * IANA zone (not a fixed offset) so daylight saving stays correct.
 */
export const DISPLAY_TIME_ZONE = "America/Chicago";

/** Short suffix shown next to formatted timestamps. */
export const DISPLAY_TIME_ZONE_LABEL = "CT";
