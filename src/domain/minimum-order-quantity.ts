export const DEFAULT_MINIMUM_ORDER_QUANTITY = 1;
export const MAXIMUM_DIRECT_CHECKOUT_QUANTITY = 99;

export function minimumOrderQuantityFromOptionValues(
  optionValues: unknown,
): number | null {
  if (optionValues === null) {
    return DEFAULT_MINIMUM_ORDER_QUANTITY;
  }
  if (typeof optionValues !== "object" || Array.isArray(optionValues)) {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(optionValues, "minimumOrderQuantity")) {
    return DEFAULT_MINIMUM_ORDER_QUANTITY;
  }
  const value = (optionValues as Record<string, unknown>).minimumOrderQuantity;
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= DEFAULT_MINIMUM_ORDER_QUANTITY &&
    value <= MAXIMUM_DIRECT_CHECKOUT_QUANTITY
    ? value
    : null;
}

export type MinimumOrderQuantityEvaluation =
  | { ok: true; minimumOrderQuantity: number }
  | { ok: false; reason: "invalid_configuration" }
  | {
      ok: false;
      reason: "below_minimum";
      minimumOrderQuantity: number;
    };

export function evaluateMinimumOrderQuantity(
  optionValues: unknown,
  requestedQuantity: number,
): MinimumOrderQuantityEvaluation {
  const minimumOrderQuantity =
    minimumOrderQuantityFromOptionValues(optionValues);
  if (minimumOrderQuantity === null) {
    return { ok: false, reason: "invalid_configuration" };
  }
  if (
    !Number.isSafeInteger(requestedQuantity) ||
    requestedQuantity < minimumOrderQuantity
  ) {
    return {
      ok: false,
      reason: "below_minimum",
      minimumOrderQuantity,
    };
  }
  return { ok: true, minimumOrderQuantity };
}

export function clampDirectCheckoutQuantity(
  requestedQuantity: number,
  minimumOrderQuantity: number,
) {
  const validMinimum =
    Number.isSafeInteger(minimumOrderQuantity) &&
    minimumOrderQuantity >= DEFAULT_MINIMUM_ORDER_QUANTITY &&
    minimumOrderQuantity <= MAXIMUM_DIRECT_CHECKOUT_QUANTITY
      ? minimumOrderQuantity
      : DEFAULT_MINIMUM_ORDER_QUANTITY;
  const wholeQuantity = Number.isFinite(requestedQuantity)
    ? Math.floor(requestedQuantity)
    : validMinimum;
  return Math.max(
    validMinimum,
    Math.min(MAXIMUM_DIRECT_CHECKOUT_QUANTITY, wholeQuantity),
  );
}
