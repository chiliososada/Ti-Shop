"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import {
  addressActionFailure,
  addressActionSuccess,
  addressValidationFailure,
  logUnexpectedAddressActionError,
  type AddressActionState,
} from "@/server/account/address-action-state";
import {
  createCurrentCustomerAddress,
  softDeleteCurrentCustomerAddress,
  updateCurrentCustomerAddress,
} from "@/server/account/addresses";
import {
  CREATE_ADDRESS_FIELDS,
  createAddressSchema,
  DELETE_ADDRESS_FIELDS,
  deleteAddressSchema,
  readStrictAddressFormData,
  UPDATE_ADDRESS_FIELDS,
  updateAddressSchema,
} from "@/server/account/address-validators";

function revalidateAddressPages(addressId?: string) {
  const paths = new Set([
    "/account",
    "/account/addresses",
    ...(addressId ? [`/account/addresses/${addressId}`] : []),
  ]);
  let refreshFailed = false;
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch (error) {
      unstable_rethrow(error);
      refreshFailed = true;
      logUnexpectedAddressActionError("cache-refresh", error);
    }
  }
  return refreshFailed;
}

function committedAddressSuccess(message: string, refreshFailed: boolean) {
  return addressActionSuccess(
    refreshFailed
      ? `${message} Page refresh may be delayed; do not resubmit the form just to refresh it.`
      : message,
  );
}

export async function createAddressAction(
  _previousState: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const fields = readStrictAddressFormData(formData, CREATE_ADDRESS_FIELDS);
  if (!fields.success) return addressActionFailure(fields.message);
  const parsed = createAddressSchema.safeParse(fields.data);
  if (!parsed.success) return addressValidationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof createCurrentCustomerAddress>>;
  try {
    result = await createCurrentCustomerAddress(parsed.data);
    if (!result.ok) {
      return addressActionFailure(
        "You have reached the limit of 20 active saved addresses.",
      );
    }
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAddressActionError("create", error);
    return addressActionFailure("The address could not be saved. Try again.");
  }
  return committedAddressSuccess(
    result.duplicate ? "This address submission was already saved." : "Address saved.",
    revalidateAddressPages(result.addressId),
  );
}

export async function updateAddressAction(
  _previousState: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const fields = readStrictAddressFormData(formData, UPDATE_ADDRESS_FIELDS);
  if (!fields.success) return addressActionFailure(fields.message);
  const parsed = updateAddressSchema.safeParse(fields.data);
  if (!parsed.success) return addressValidationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateCurrentCustomerAddress>>;
  try {
    result = await updateCurrentCustomerAddress(parsed.data);
    if (!result.ok) {
      return addressActionFailure("The address is no longer available.");
    }
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAddressActionError("update", error);
    return addressActionFailure("The address could not be updated. Try again.");
  }
  return committedAddressSuccess(
    "Address changes saved.",
    revalidateAddressPages(result.addressId),
  );
}

export async function deleteAddressAction(
  _previousState: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const fields = readStrictAddressFormData(formData, DELETE_ADDRESS_FIELDS);
  if (!fields.success) return addressActionFailure(fields.message);
  const parsed = deleteAddressSchema.safeParse(fields.data);
  if (!parsed.success) return addressValidationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof softDeleteCurrentCustomerAddress>>;
  try {
    result = await softDeleteCurrentCustomerAddress(parsed.data.addressId);
    if (!result.ok) {
      return addressActionFailure("The address is no longer available.");
    }
  } catch (error) {
    unstable_rethrow(error);
    logUnexpectedAddressActionError("delete", error);
    return addressActionFailure("The address could not be removed. Try again.");
  }
  return committedAddressSuccess(
    "Address removed from your address book.",
    revalidateAddressPages(result.addressId),
  );
}
