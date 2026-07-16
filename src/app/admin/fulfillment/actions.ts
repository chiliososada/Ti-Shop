"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import {
  actionFailure,
  actionSuccess,
  formDataFailure,
  logUnexpectedAdminActionError,
  type AdminActionState,
  validationFailure,
} from "@/server/admin/audit/action-state";
import { readStrictFormData } from "@/server/admin/audit/form-data";
import {
  addAdminTrackingEvent,
  createAdminCarrier,
  createAdminPackage,
  createAdminShipment,
  deleteAdminPackage,
  updateAdminCarrier,
  updateAdminPackage,
  updateAdminShipmentDetails,
  updateAdminShipmentStatus,
} from "@/server/admin/fulfillment/mutations";
import {
  CREATE_CARRIER_FORM_FIELDS,
  CREATE_PACKAGE_FORM_FIELDS,
  createCarrierSchema,
  createPackageSchema,
  createShipmentSchema,
  DELETE_PACKAGE_FORM_FIELDS,
  deletePackageSchema,
  readCreateShipmentFormData,
  TRACKING_EVENT_FORM_FIELDS,
  trackingEventSchema,
  UPDATE_CARRIER_FORM_FIELDS,
  UPDATE_PACKAGE_FORM_FIELDS,
  UPDATE_SHIPMENT_DETAILS_FORM_FIELDS,
  UPDATE_SHIPMENT_STATUS_FORM_FIELDS,
  updateCarrierSchema,
  updatePackageSchema,
  updateShipmentDetailsSchema,
  updateShipmentStatusSchema,
} from "@/server/admin/fulfillment/validators";

export type FulfillmentActionState = AdminActionState & {
  refreshPending?: boolean;
};

type RevalidationTarget = {
  path: string;
  type?: "page" | "layout";
};

const MAX_FULFILLMENT_REVALIDATION_TARGETS = 8;

function revalidateFulfillmentViews(
  targets: readonly RevalidationTarget[],
  errorScope: `${string}.cache-refresh`,
) {
  const uniqueTargets = new Map<string, RevalidationTarget>();
  for (const target of targets) {
    uniqueTargets.set(`${target.path}:${target.type ?? "literal"}`, target);
  }

  let firstError: unknown;
  const boundedTargets = [...uniqueTargets.values()].slice(
    0,
    MAX_FULFILLMENT_REVALIDATION_TARGETS,
  );
  if (uniqueTargets.size > MAX_FULFILLMENT_REVALIDATION_TARGETS) {
    firstError = new Error(
      "Fulfillment cache refresh target limit was exceeded.",
    );
  }

  for (const target of boundedTargets) {
    try {
      revalidatePath(target.path, target.type);
    } catch (error) {
      unstable_rethrow(error);
      firstError ??= error;
    }
  }

  if (firstError !== undefined) {
    logUnexpectedAdminActionError(errorScope, firstError);
    return true;
  }
  return false;
}

function revalidateCarrierViews(errorScope: `${string}.cache-refresh`) {
  return revalidateFulfillmentViews(
    [{ path: "/admin/fulfillment" }],
    errorScope,
  );
}

function revalidateOrderFulfillment(
  orderPublicId: string,
  errorScope: `${string}.cache-refresh`,
) {
  return revalidateFulfillmentViews(
    [
      { path: "/admin/fulfillment" },
      { path: `/admin/fulfillment/orders/${orderPublicId}` },
      { path: "/admin/orders" },
      { path: `/admin/orders/${orderPublicId}` },
      { path: "/account/orders" },
      { path: `/account/orders/${orderPublicId}` },
      { path: "/admin" },
    ],
    errorScope,
  );
}

function committedActionSuccess(
  message: string,
  refreshPending: boolean,
): FulfillmentActionState {
  if (!refreshPending) return actionSuccess(message);
  return {
    status: "success",
    message: `${message} The database operation is committed, but one or more affected page refreshes may be delayed. Do not resubmit solely to retry the refresh; reload the affected page later.`,
    refreshPending: true,
  };
}

export async function createCarrierAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const fields = readStrictFormData(formData, CREATE_CARRIER_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = createCarrierSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminCarrier>>;
  try {
    result = await createAdminCarrier(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("fulfillment.carrier.create", error);
    return actionFailure(
      "The carrier could not be saved. Refresh and try again.",
    );
  }
  if (!result.ok) {
    return actionFailure("That carrier code is already in use.");
  }

  const refreshPending = revalidateCarrierViews(
    "fulfillment.carrier.create.cache-refresh",
  );
  return committedActionSuccess(
    `Carrier ${result.code} created.`,
    refreshPending,
  );
}

export async function updateCarrierAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const fields = readStrictFormData(formData, UPDATE_CARRIER_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = updateCarrierSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminCarrier>>;
  try {
    result = await updateAdminCarrier(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("fulfillment.carrier.update", error);
    return actionFailure(
      "The carrier could not be saved. Refresh and try again.",
    );
  }
  if (!result.ok) return actionFailure("The carrier could not be found.");

  const refreshPending = revalidateCarrierViews(
    "fulfillment.carrier.update.cache-refresh",
  );
  return committedActionSuccess(
    `Carrier ${result.code} saved.`,
    refreshPending,
  );
}

export async function createShipmentAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const fields = readCreateShipmentFormData(formData);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = createShipmentSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminShipment>>;
  try {
    result = await createAdminShipment(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("fulfillment.shipment.create", error);
    return actionFailure(
      "The shipment could not be saved. Refresh and try again.",
    );
  }
  if (!result.ok) {
    const message =
      result.reason === "payment_not_paid"
        ? "Fulfillment is blocked until the order payment status is paid."
        : result.reason === "order_not_fulfillable"
          ? "Only confirmed or processing orders can be fulfilled."
          : result.reason === "carrier_unavailable"
            ? "The selected carrier is no longer active."
            : result.reason === "lines_changed"
              ? "The order lines changed. Refresh before creating a shipment."
              : result.reason === "invalid_quantity"
                ? "A quantity exceeds the remaining fulfillable amount. Refresh and review the lines."
                : "The order could not be found.";
    return actionFailure(message);
  }

  const refreshPending = revalidateOrderFulfillment(
    result.orderPublicId,
    "fulfillment.shipment.create.cache-refresh",
  );
  return committedActionSuccess(
    `Shipment ${result.shipmentNumber} created.`,
    refreshPending,
  );
}

export async function updateShipmentStatusAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const fields = readStrictFormData(
    formData,
    UPDATE_SHIPMENT_STATUS_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = updateShipmentStatusSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminShipmentStatus>>;
  try {
    result = await updateAdminShipmentStatus(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("fulfillment.shipment.status.update", error);
    return actionFailure(
      "The shipment status could not be saved. Refresh and try again.",
    );
  }
  if (!result.ok) {
    return actionFailure(
      result.reason === "invalid_transition"
        ? "That shipment status transition is not allowed. Refresh and review the current status."
        : result.reason === "payment_not_paid"
          ? "Pre-dispatch shipment progress is blocked because the order payment is no longer paid. You may cancel the shipment instead."
          : "The shipment could not be found.",
    );
  }

  const refreshPending = revalidateOrderFulfillment(
    result.orderPublicId,
    "fulfillment.shipment.status.update.cache-refresh",
  );
  return committedActionSuccess(
    `${result.shipmentNumber} is now ${result.status.toLowerCase().replaceAll("_", " ")}.`,
    refreshPending,
  );
}

export async function updateShipmentDetailsAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const fields = readStrictFormData(
    formData,
    UPDATE_SHIPMENT_DETAILS_FORM_FIELDS,
  );
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = updateShipmentDetailsSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminShipmentDetails>>;
  try {
    result = await updateAdminShipmentDetails(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("fulfillment.shipment.details.update", error);
    return actionFailure(
      "The shipment details could not be saved. Refresh and try again.",
    );
  }
  if (!result.ok) {
    return actionFailure(
      result.reason === "duplicate_tracking"
        ? "That tracking number is already assigned to another shipment for this carrier."
        : "The shipment could not be found.",
    );
  }

  const refreshPending = revalidateOrderFulfillment(
    result.orderPublicId,
    "fulfillment.shipment.details.update.cache-refresh",
  );
  return committedActionSuccess(
    result.duplicate
      ? `${result.shipmentNumber} already has these logistics details.`
      : `${result.shipmentNumber} logistics details saved.`,
    refreshPending,
  );
}

function packageFailure(reason: "not_found" | "shipment_locked" | "limit") {
  if (reason === "shipment_locked") {
    return actionFailure(
      "Packages can only be changed while the shipment is draft or label created.",
    );
  }
  if (reason === "limit") {
    return actionFailure("A shipment cannot contain more than 100 packages.");
  }
  return actionFailure("The shipment or package could not be found.");
}

export async function createPackageAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const fields = readStrictFormData(formData, CREATE_PACKAGE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = createPackageSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminPackage>>;
  try {
    result = await createAdminPackage(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("fulfillment.package.create", error);
    return actionFailure("The package could not be added. Refresh and try again.");
  }
  if (!result.ok) return packageFailure(result.reason);

  const refreshPending = revalidateOrderFulfillment(
    result.orderPublicId,
    "fulfillment.package.create.cache-refresh",
  );
  return committedActionSuccess(
    `Package ${result.packageNumber} added to ${result.shipmentNumber}.`,
    refreshPending,
  );
}

export async function updatePackageAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const fields = readStrictFormData(formData, UPDATE_PACKAGE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = updatePackageSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminPackage>>;
  try {
    result = await updateAdminPackage(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("fulfillment.package.update", error);
    return actionFailure("The package could not be saved. Refresh and try again.");
  }
  if (!result.ok) return packageFailure(result.reason);

  const refreshPending = revalidateOrderFulfillment(
    result.orderPublicId,
    "fulfillment.package.update.cache-refresh",
  );
  return committedActionSuccess(
    result.duplicate
      ? `Package ${result.packageNumber} already has these measurements.`
      : `Package ${result.packageNumber} saved.`,
    refreshPending,
  );
}

export async function deletePackageAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const fields = readStrictFormData(formData, DELETE_PACKAGE_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = deletePackageSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof deleteAdminPackage>>;
  try {
    result = await deleteAdminPackage(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("fulfillment.package.delete", error);
    return actionFailure("The package could not be removed. Refresh and try again.");
  }
  if (!result.ok) return packageFailure(result.reason);

  const refreshPending = revalidateOrderFulfillment(
    result.orderPublicId,
    "fulfillment.package.delete.cache-refresh",
  );
  return committedActionSuccess(
    `Package ${result.packageNumber} removed from ${result.shipmentNumber}.`,
    refreshPending,
  );
}

export async function addTrackingEventAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<FulfillmentActionState> {
  const fields = readStrictFormData(formData, TRACKING_EVENT_FORM_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = trackingEventSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof addAdminTrackingEvent>>;
  try {
    result = await addAdminTrackingEvent(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("fulfillment.tracking_event.create", error);
    return actionFailure(
      "The tracking event could not be saved. Refresh and try again.",
    );
  }
  if (!result.ok) {
    return actionFailure(
      result.reason === "payment_not_paid"
        ? "Tracking cannot dispatch this shipment because the order payment is no longer paid."
        : "The shipment could not be found.",
    );
  }

  const refreshPending = revalidateOrderFulfillment(
    result.orderPublicId,
    "fulfillment.tracking_event.create.cache-refresh",
  );
  return committedActionSuccess(
    `Tracking event added to ${result.shipmentNumber}.`,
    refreshPending,
  );
}
