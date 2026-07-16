export const CORE_MERCHANDISING_PLACEMENT_KEYS = [
  "legacy-featured-products",
  "legacy-home-bestsellers",
  "legacy-category-signatures",
] as const;

// Legacy import positions are single digits today. Keeping a wider immutable
// band prevents manual rows from blocking a first or repeated legacy import.
export const CORE_MERCHANDISING_MANUAL_POSITION_START = 100;
