import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  revalidatePath: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: mocks.unstableRethrow }));
vi.mock("@/server/account/profile", () => ({
  updateCurrentCustomerProfile: mocks.updateProfile,
}));

import { updateCustomerProfileAction } from "@/app/(storefront)/account/actions";
import { INITIAL_PROFILE_ACTION_STATE } from "@/server/account/profile-action-state";

function validProfileForm() {
  const formData = new FormData();
  for (const [key, value] of Object.entries({
    name: "Research Customer",
    firstName: "Research",
    lastName: "Customer",
    phone: "",
    countryCode: "US",
    preferredCurrency: "USD",
    locale: "en-US",
  })) {
    formData.set(key, value);
  }
  return formData;
}

describe("customer profile action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("does not report a committed profile update as failed when refresh is delayed", async () => {
    const refreshError = new Error("cache unavailable");
    mocks.updateProfile.mockResolvedValue({ ok: true });
    mocks.revalidatePath
      .mockImplementationOnce(() => {
        throw refreshError;
      })
      .mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const state = await updateCustomerProfileAction(
      INITIAL_PROFILE_ACTION_STATE,
      validProfileForm(),
    );

    expect(state.status).toBe("success");
    expect(state.message).toContain("do not resubmit");
    expect(mocks.updateProfile).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
    expect(mocks.unstableRethrow).toHaveBeenCalledWith(refreshError);
    consoleError.mockRestore();
  });
});
