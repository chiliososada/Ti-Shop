import { z } from "zod";

import {
  checkboxSchema,
  nullableText,
  publicIdSchema,
} from "@/server/admin/audit/validation";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const ISO_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u;

const carrierCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .transform((value) => value.toUpperCase())
  .pipe(
    z
      .string()
      .regex(
        /^[A-Z0-9][A-Z0-9_-]*$/u,
        "Use only letters, numbers, underscores, and hyphens.",
      ),
  );

const carrierNameSchema = z.string().trim().min(1).max(160);

const trackingTemplateSchema = z
  .string()
  .trim()
  .max(2_048)
  .transform((value, context) => {
    if (!value) return null;
    if (!value.includes("{trackingNumber}")) {
      context.addIssue({
        code: "custom",
        message: "Include the {trackingNumber} placeholder.",
      });
      return z.NEVER;
    }

    try {
      const parsed = new URL(
        value.replaceAll("{trackingNumber}", "EXAMPLE123"),
      );
      if (
        parsed.protocol !== "https:" ||
        parsed.username.length > 0 ||
        parsed.password.length > 0
      ) {
        throw new TypeError("Unsafe tracking template.");
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Use a valid HTTPS URL template without embedded credentials.",
      });
      return z.NEVER;
    }
    return value;
  });

export const CREATE_CARRIER_FORM_FIELDS = [
  "code",
  "name",
  "trackingUrlTemplate",
  "isActive",
] as const;

export const createCarrierSchema = z
  .object({
    code: carrierCodeSchema,
    name: carrierNameSchema,
    trackingUrlTemplate: trackingTemplateSchema,
    isActive: checkboxSchema,
  })
  .strict();

export const UPDATE_CARRIER_FORM_FIELDS = [
  "carrierPublicId",
  "name",
  "trackingUrlTemplate",
  "isActive",
] as const;

export const updateCarrierSchema = z
  .object({
    carrierPublicId: publicIdSchema,
    name: carrierNameSchema,
    trackingUrlTemplate: trackingTemplateSchema,
    isActive: checkboxSchema,
  })
  .strict();

const safeNullableText = (maximum: number) =>
  nullableText(maximum).refine(
    (value) => value === null || !CONTROL_CHARACTER.test(value),
    "Control characters are not allowed.",
  );

const lineQuantitySchema = z
  .string()
  .trim()
  .regex(/^\d+$/u, "Each quantity must be a non-negative whole number.")
  .transform(Number)
  .refine(Number.isSafeInteger, "A quantity is too large.")
  .refine((value) => value <= 1_000_000, "A quantity is too large.");

export const CREATE_SHIPMENT_SCALAR_FIELDS = [
  "orderPublicId",
  "carrierPublicId",
  "serviceLevel",
  "trackingNumber",
  "estimatedDeliveryAt",
] as const;

const optionalTimestampSchema = z
  .string()
  .trim()
  .max(40)
  .transform((value, context) => {
    if (!value) return null;
    if (!ISO_WITH_TIMEZONE.test(value)) {
      context.addIssue({
        code: "custom",
        message: "Use an ISO timestamp with a timezone.",
      });
      return z.NEVER;
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      context.addIssue({ code: "custom", message: "Timestamp is invalid." });
      return z.NEVER;
    }
    return parsed;
  });

export const createShipmentSchema = z
  .object({
    orderPublicId: publicIdSchema,
    carrierPublicId: publicIdSchema,
    serviceLevel: safeNullableText(120),
    trackingNumber: safeNullableText(180),
    estimatedDeliveryAt: optionalTimestampSchema,
    lineQuantities: z
      .array(lineQuantitySchema)
      .min(1)
      .max(500)
      .refine(
        (quantities) => quantities.some((quantity) => quantity > 0),
        "Select at least one item quantity.",
      ),
  })
  .strict();

export type FulfillmentFormDataResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; message: string };

/**
 * Shipment lines intentionally have no client-supplied database identifier:
 * OrderItem has no publicId in the current schema. The form submits one ordered
 * quantity per server-rendered line and the mutation maps it inside the same
 * order transaction. Scalar references remain public UUIDs only.
 */
export function readCreateShipmentFormData(
  formData: FormData,
): FulfillmentFormDataResult {
  const allowedScalars = new Set<string>(CREATE_SHIPMENT_SCALAR_FIELDS);
  const scalarData: Record<string, string> = {};
  const seenScalars = new Set<string>();
  const lineQuantities: string[] = [];

  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION_")) continue;
    if (typeof value !== "string") {
      return {
        success: false,
        message: "File uploads are not supported by this form.",
      };
    }
    if (key === "lineQuantity") {
      lineQuantities.push(value);
      continue;
    }
    if (!allowedScalars.has(key)) {
      return {
        success: false,
        message: "The form contained unexpected fields. Refresh and try again.",
      };
    }
    if (seenScalars.has(key)) {
      return {
        success: false,
        message: "The form contained duplicate fields. Refresh and try again.",
      };
    }
    seenScalars.add(key);
    scalarData[key] = value;
  }

  return {
    success: true,
    data: { ...scalarData, lineQuantities },
  };
}

export const UPDATE_SHIPMENT_STATUS_FORM_FIELDS = [
  "shipmentPublicId",
  "status",
] as const;

export const updateShipmentStatusSchema = z
  .object({
    shipmentPublicId: publicIdSchema,
    status: z.enum([
      "DRAFT",
      "LABEL_CREATED",
      "IN_TRANSIT",
      "DELIVERED",
      "EXCEPTION",
      "RETURNED",
      "CANCELED",
    ]),
  })
  .strict();

export const UPDATE_SHIPMENT_DETAILS_FORM_FIELDS = [
  "shipmentPublicId",
  "serviceLevel",
  "trackingNumber",
  "estimatedDeliveryAt",
] as const;

export const updateShipmentDetailsSchema = z
  .object({
    shipmentPublicId: publicIdSchema,
    serviceLevel: safeNullableText(120),
    trackingNumber: safeNullableText(180),
    estimatedDeliveryAt: optionalTimestampSchema,
  })
  .strict();

const optionalPositiveInteger = (maximum: number) =>
  z
    .string()
    .trim()
    .transform((value, context) => {
      if (!value) return null;
      if (!/^\d+$/u.test(value)) {
        context.addIssue({
          code: "custom",
          message: "Use a positive whole number or leave this blank.",
        });
        return z.NEVER;
      }
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
        context.addIssue({
          code: "custom",
          message: `Use a whole number from 1 to ${maximum.toLocaleString("en-US")}.`,
        });
        return z.NEVER;
      }
      return parsed;
    });

const packageMeasurements = {
  weightGrams: optionalPositiveInteger(1_000_000),
  lengthMillimeters: optionalPositiveInteger(100_000),
  widthMillimeters: optionalPositiveInteger(100_000),
  heightMillimeters: optionalPositiveInteger(100_000),
} as const;

function validatePackageDimensions(
  value: {
    lengthMillimeters: number | null;
    widthMillimeters: number | null;
    heightMillimeters: number | null;
  },
  context: z.RefinementCtx,
) {
  const dimensions = [
    value.lengthMillimeters,
    value.widthMillimeters,
    value.heightMillimeters,
  ];
  const populated = dimensions.filter((dimension) => dimension !== null).length;
  if (populated !== 0 && populated !== dimensions.length) {
    context.addIssue({
      code: "custom",
      path: ["lengthMillimeters"],
      message: "Enter all three package dimensions or leave all three blank.",
    });
  }
}

export const CREATE_PACKAGE_FORM_FIELDS = [
  "shipmentPublicId",
  "weightGrams",
  "lengthMillimeters",
  "widthMillimeters",
  "heightMillimeters",
] as const;

export const createPackageSchema = z
  .object({ shipmentPublicId: publicIdSchema, ...packageMeasurements })
  .strict()
  .superRefine(validatePackageDimensions);

export const UPDATE_PACKAGE_FORM_FIELDS = [
  "packagePublicId",
  "weightGrams",
  "lengthMillimeters",
  "widthMillimeters",
  "heightMillimeters",
] as const;

export const updatePackageSchema = z
  .object({ packagePublicId: publicIdSchema, ...packageMeasurements })
  .strict()
  .superRefine(validatePackageDimensions);

export const DELETE_PACKAGE_FORM_FIELDS = ["packagePublicId"] as const;
export const deletePackageSchema = z
  .object({ packagePublicId: publicIdSchema })
  .strict();

const occurredAtSchema = z
  .string()
  .trim()
  .max(40)
  .transform((value, context) => {
    if (!ISO_WITH_TIMEZONE.test(value)) {
      context.addIssue({
        code: "custom",
        message: "Use an ISO timestamp with a timezone.",
      });
      return z.NEVER;
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      context.addIssue({ code: "custom", message: "Event time is invalid." });
      return z.NEVER;
    }
    return parsed;
  });

export const TRACKING_EVENT_FORM_FIELDS = [
  "shipmentPublicId",
  "status",
  "message",
  "location",
  "occurredAt",
] as const;

export const trackingEventSchema = z
  .object({
    shipmentPublicId: publicIdSchema,
    status: z.enum([
      "INFO",
      "LABEL_CREATED",
      "PICKED_UP",
      "IN_TRANSIT",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "EXCEPTION",
      "RETURNED",
    ]),
    message: safeNullableText(5_000),
    location: safeNullableText(255),
    occurredAt: occurredAtSchema,
  })
  .strict()
  .refine((value) => value.status !== "INFO" || value.message !== null, {
    path: ["message"],
    message: "An informational event needs a message.",
  });

export type CreateCarrierInput = z.output<typeof createCarrierSchema>;
export type UpdateCarrierInput = z.output<typeof updateCarrierSchema>;
export type CreateShipmentInput = z.output<typeof createShipmentSchema>;
export type UpdateShipmentStatusInput = z.output<
  typeof updateShipmentStatusSchema
>;
export type UpdateShipmentDetailsInput = z.output<
  typeof updateShipmentDetailsSchema
>;
export type CreatePackageInput = z.output<typeof createPackageSchema>;
export type UpdatePackageInput = z.output<typeof updatePackageSchema>;
export type DeletePackageInput = z.output<typeof deletePackageSchema>;
export type TrackingEventInput = z.output<typeof trackingEventSchema>;
