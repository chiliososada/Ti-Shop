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
  adjustAdminInventory,
  createAdminInventoryLocation,
  updateAdminInventoryLocation,
} from "@/server/admin/inventory/mutations";
import {
  ADJUST_INVENTORY_FIELDS,
  adjustInventorySchema,
  CREATE_LOCATION_FIELDS,
  createLocationSchema,
  UPDATE_LOCATION_FIELDS,
  updateLocationSchema,
} from "@/server/admin/inventory/validators";

type InventoryActionState = AdminActionState & {
  refreshPending?: boolean;
};

const MAX_INVENTORY_REVALIDATION_TARGETS = 2;

function revalidateInventoryPages(
  paths: readonly string[],
  errorScope: `${string}.cache-refresh`,
) {
  const targets = new Set(paths);
  let refreshPending = false;

  if (targets.size > MAX_INVENTORY_REVALIDATION_TARGETS) {
    refreshPending = true;
    logUnexpectedAdminActionError(
      errorScope,
      new Error("Inventory cache refresh target limit was exceeded."),
    );
  }

  for (const path of [...targets].slice(
    0,
    MAX_INVENTORY_REVALIDATION_TARGETS,
  )) {
    try {
      revalidatePath(path);
    } catch (error) {
      unstable_rethrow(error);
      refreshPending = true;
      logUnexpectedAdminActionError(errorScope, error);
    }
  }

  return refreshPending;
}

function committedInventorySuccess(
  message: string,
  refreshPending: boolean,
): InventoryActionState {
  if (!refreshPending) return actionSuccess(message);
  return {
    status: "success",
    message: `${message} The database operation is committed, but one or more affected page refreshes may be delayed. Do not resubmit solely to retry the refresh; reload the affected page later.`,
    refreshPending: true,
  };
}

export async function createLocationAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const fields = readStrictFormData(formData, CREATE_LOCATION_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = createLocationSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createAdminInventoryLocation>>;
  try {
    result = await createAdminInventoryLocation(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("inventory.location.create", error);
    return actionFailure(
      "The inventory location could not be created. Check the code and try again.",
    );
  }
  const refreshPending = revalidateInventoryPages(
    ["/admin/inventory", `/admin/inventory/locations/${result.publicId}`],
    "inventory.location.create.cache-refresh",
  );
  return committedInventorySuccess(
    "US inventory location created.",
    refreshPending,
  );
}

export async function updateLocationAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const fields = readStrictFormData(formData, UPDATE_LOCATION_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = updateLocationSchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateAdminInventoryLocation>>;
  try {
    result = await updateAdminInventoryLocation(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("inventory.location.update", error);
    return actionFailure(
      "The inventory location could not be saved. Check the code and try again.",
    );
  }
  if (!result.ok) {
    return actionFailure("The US inventory location could not be found.");
  }
  const refreshPending = revalidateInventoryPages(
    ["/admin/inventory", `/admin/inventory/locations/${result.publicId}`],
    "inventory.location.update.cache-refresh",
  );
  return committedInventorySuccess("Inventory location saved.", refreshPending);
}

export async function adjustInventoryAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const fields = readStrictFormData(formData, ADJUST_INVENTORY_FIELDS);
  if (!fields.success) return formDataFailure(fields.message);
  const parsed = adjustInventorySchema.safeParse(fields.data);
  if (!parsed.success) return validationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof adjustAdminInventory>>;
  try {
    result = await adjustAdminInventory(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAdminActionError("inventory.level.adjust", error);
    return actionFailure("Inventory could not be adjusted. Refresh and try again.");
  }
  if (!result.ok) {
    const message = {
      idempotency_conflict:
        "This submission identifier was already used for different adjustment data. Refresh and try again.",
      not_found:
        "The selected US location or product variant could not be found.",
      invalid_quantity: "The resulting stock quantity is not valid.",
      negative_on_hand: "This adjustment would make on-hand stock negative.",
      below_reserved:
        "This adjustment would put non-backorder stock below its reserved quantity.",
    }[result.reason];
    return actionFailure(message);
  }

  const message = result.duplicate
    ? `This adjustment was already recorded. On hand remains ${result.onHandAfter}.`
    : `Inventory adjusted. On hand is now ${result.onHandAfter}.`;
  const refreshPending = revalidateInventoryPages(
    ["/admin/inventory"],
    "inventory.level.adjust.cache-refresh",
  );
  return committedInventorySuccess(message, refreshPending);
}
