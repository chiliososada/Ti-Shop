"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import {
  profileValidationFailure,
  type ProfileActionState,
} from "@/server/account/profile-action-state";
import { updateCurrentCustomerProfile } from "@/server/account/profile";
import {
  CUSTOMER_PROFILE_FIELDS,
  customerProfileSchema,
} from "@/server/account/profile-validators";
import { readStrictAddressFormData } from "@/server/account/address-validators";

function refreshProfilePages() {
  let refreshFailed = false;
  for (const path of ["/account", "/checkout"]) {
    try {
      revalidatePath(path);
    } catch (error) {
      unstable_rethrow(error);
      refreshFailed = true;
      console.error("Customer profile action failed: cache-refresh", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }
  return refreshFailed;
}

export async function updateCustomerProfileAction(
  _previousState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const fields = readStrictAddressFormData(formData, CUSTOMER_PROFILE_FIELDS);
  if (!fields.success) return { status: "error", message: fields.message };

  const parsed = customerProfileSchema.safeParse(fields.data);
  if (!parsed.success) return profileValidationFailure(parsed.error);

  let result: Awaited<ReturnType<typeof updateCurrentCustomerProfile>>;
  try {
    result = await updateCurrentCustomerProfile(parsed.data);
    if (!result.ok) {
      return {
        status: "error",
        message: "This account is not currently available for profile changes.",
      };
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error("Customer profile action failed.", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return {
      status: "error",
      message: "The profile could not be updated. Try again.",
    };
  }

  const refreshFailed = refreshProfilePages();
  return {
    status: "success",
    message: refreshFailed
      ? "Profile changes saved. Page refresh may be delayed; do not resubmit the form just to refresh it."
      : "Profile changes saved.",
  };
}
