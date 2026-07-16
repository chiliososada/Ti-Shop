import { z } from "zod";

import { MAX_POSTGRES_BIGINT } from "@/domain/money";
import {
  checkoutItemsSchema,
  usOrderAddressSchema,
} from "@/server/orders/input";

export const ADMIN_MANUAL_ORDER_FORM_FIELDS = [
  "idempotencyKey",
  "customerUserId",
  "paymentMethod",
  "itemsJson",
  "addressMode",
  "addressId",
  "recipientName",
  "company",
  "line1",
  "line2",
  "city",
  "region",
  "postalCode",
  "countryCode",
  "phone",
  "confirmation",
] as const;

const optionalFormText = z.string().max(255).optional().default("");

function parseItemsJson(value: string, context: z.RefinementCtx) {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    context.addIssue({
      code: "custom",
      path: ["itemsJson"],
      message: "Order items are invalid. Refresh and select the products again.",
    });
    return null;
  }
  const parsed = checkoutItemsSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: "custom",
        path: ["itemsJson", ...issue.path],
        message: issue.message,
      });
    }
    return null;
  }
  return [...parsed.data].sort((left, right) =>
    left.variantPublicId.localeCompare(right.variantPublicId),
  );
}

export const adminManualOrderFormSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    customerUserId: z.string().uuid(),
    paymentMethod: z.enum(["WIRE_TRANSFER", "ZELLE"]),
    itemsJson: z.string().min(2).max(20_000),
    addressMode: z.enum(["SAVED", "CUSTOM"]),
    addressId: z
      .string()
      .trim()
      .max(30)
      .optional()
      .default(""),
    recipientName: optionalFormText,
    company: optionalFormText,
    line1: optionalFormText,
    line2: optionalFormText,
    city: z.string().max(120).optional().default(""),
    region: z.string().max(120).optional().default(""),
    postalCode: z.string().max(20).optional().default(""),
    countryCode: z.string().max(2).optional().default("US"),
    phone: z.string().max(32).optional().default(""),
    confirmation: z.literal("CREATE_PENDING_MANUAL_ORDER", {
      error:
        "Confirm the WhatsApp arrangement and that no payment has been marked received.",
    }),
  })
  .strict()
  .transform((value, context) => {
    const items = parseItemsJson(value.itemsJson, context);
    if (!items) return z.NEVER;

    if (value.addressMode === "SAVED") {
      if (
        !/^[1-9]\d*$/u.test(value.addressId) ||
        BigInt(value.addressId) > MAX_POSTGRES_BIGINT
      ) {
        context.addIssue({
          code: "custom",
          path: ["addressId"],
          message: "Choose an active customer address.",
        });
        return z.NEVER;
      }
      return {
        idempotencyKey: value.idempotencyKey.toLowerCase(),
        customerUserId: value.customerUserId.toLowerCase(),
        paymentMethod: value.paymentMethod,
        items,
        address: { mode: "SAVED" as const, addressId: value.addressId },
      };
    }

    const address = usOrderAddressSchema.safeParse({
      recipientName: value.recipientName,
      ...(value.company.trim() ? { company: value.company } : {}),
      line1: value.line1,
      ...(value.line2.trim() ? { line2: value.line2 } : {}),
      city: value.city,
      region: value.region,
      postalCode: value.postalCode,
      countryCode: value.countryCode,
      ...(value.phone.trim() ? { phone: value.phone } : {}),
    });
    if (!address.success) {
      for (const issue of address.error.issues) {
        context.addIssue({
          code: "custom",
          path: [typeof issue.path[0] === "string" ? issue.path[0] : "address"],
          message: issue.message,
        });
      }
      return z.NEVER;
    }
    return {
      idempotencyKey: value.idempotencyKey.toLowerCase(),
      customerUserId: value.customerUserId.toLowerCase(),
      paymentMethod: value.paymentMethod,
      items,
      address: { mode: "CUSTOM" as const, value: address.data },
    };
  });

export type AdminManualOrderInput = z.output<
  typeof adminManualOrderFormSchema
>;
