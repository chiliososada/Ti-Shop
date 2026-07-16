import { z } from "zod";

import {
  CHECKOUT_PAYMENT_METHODS,
  type CheckoutPaymentMethod,
} from "@/domain/order";
import { isUsRegionCode } from "@/domain/us-regions";

const optionalTrimmed = (maximum: number) =>
  z.string().trim().min(1).max(maximum).optional();

export const usOrderAddressSchema = z
  .object({
    recipientName: z.string().trim().min(1).max(255),
    company: optionalTrimmed(255),
    line1: z.string().trim().min(1).max(255),
    line2: optionalTrimmed(255),
    city: z.string().trim().min(1).max(120),
    region: z
      .string()
      .trim()
      .toUpperCase()
      .refine(
        // Explicit boolean return: TS 5.5+ would otherwise infer a type
        // predicate and narrow the schema output to the literal union.
        (value): boolean => isUsRegionCode(value),
        "Use a valid US state, district, or territory code.",
      ),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}(?:-\d{4})?$/u, "Use a valid US ZIP code."),
    countryCode: z.literal("US"),
    phone: z
      .string()
      .trim()
      .min(7)
      .max(32)
      .regex(/^[+()0-9 .-]+$/u, "Use a valid phone number.")
      .optional(),
  })
  .strict();

export const checkoutItemsSchema = z
  .array(
    z
      .object({
        variantPublicId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      })
      .strict(),
  )
  .min(1)
  .max(50)
  .superRefine((items, context) => {
    const seen = new Set<string>();
    let totalQuantity = 0;

    items.forEach((item, index) => {
      totalQuantity += item.quantity;
      if (seen.has(item.variantPublicId)) {
        context.addIssue({
          code: "custom",
          message: "Each product variant may appear only once.",
          path: [index, "variantPublicId"],
        });
      }
      seen.add(item.variantPublicId);
    });

    if (totalQuantity > 200) {
      context.addIssue({
        code: "custom",
        message: "The total checkout quantity cannot exceed 200.",
      });
    }
  });

export const checkoutInputSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    items: checkoutItemsSchema,
    shippingAddress: usOrderAddressSchema,
    billingAddress: usOrderAddressSchema.optional(),
    paymentMethod: z.enum(CHECKOUT_PAYMENT_METHODS),
  })
  .strict();

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;
export type UsOrderAddressInput = z.infer<typeof usOrderAddressSchema>;

export type NormalizedCheckoutInput = Omit<CheckoutInput, "paymentMethod"> & {
  paymentMethod: CheckoutPaymentMethod;
};

export function normalizeCheckoutInput(
  value: CheckoutInput,
): NormalizedCheckoutInput {
  return {
    idempotencyKey: value.idempotencyKey.toLowerCase(),
    items: [...value.items].sort((left, right) =>
      left.variantPublicId.localeCompare(right.variantPublicId),
    ),
    shippingAddress: value.shippingAddress,
    billingAddress: value.billingAddress,
    paymentMethod: value.paymentMethod,
  };
}
