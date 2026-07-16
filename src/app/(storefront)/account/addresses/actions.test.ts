import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mocks = vi.hoisted(() => ({
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
  revalidatePath: vi.fn(),
  unstableRethrow: vi.fn(),
  logUnexpected: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: mocks.unstableRethrow }));
vi.mock("@/server/account/addresses", () => ({
  createCurrentCustomerAddress: mocks.createAddress,
  updateCurrentCustomerAddress: mocks.updateAddress,
  softDeleteCurrentCustomerAddress: mocks.deleteAddress,
}));
vi.mock("@/server/account/address-action-state", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/account/address-action-state")
  >();
  return { ...actual, logUnexpectedAddressActionError: mocks.logUnexpected };
});

import { createAddressAction } from "@/app/(storefront)/account/addresses/actions";
import { INITIAL_ADDRESS_ACTION_STATE } from "@/server/account/address-action-state";

function validAddressForm() {
  const formData = new FormData();
  for (const [key, value] of Object.entries({
    submissionId: randomUUID(),
    label: "Lab",
    recipientName: "Research Customer",
    company: "",
    line1: "1 Research Way",
    line2: "",
    city: "Boston",
    region: "MA",
    postalCode: "02110",
    countryCode: "US",
    phone: "",
  })) {
    formData.set(key, value);
  }
  return formData;
}

describe("customer address action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("does not report a committed address as failed when refresh is delayed", async () => {
    const refreshError = new Error("cache unavailable");
    mocks.createAddress.mockResolvedValue({ ok: true, addressId: "41" });
    mocks.revalidatePath
      .mockImplementationOnce(() => {
        throw refreshError;
      })
      .mockImplementation(() => undefined);

    const state = await createAddressAction(
      INITIAL_ADDRESS_ACTION_STATE,
      validAddressForm(),
    );

    expect(state.status).toBe("success");
    expect(state.message).toContain("do not resubmit");
    expect(mocks.createAddress).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(3);
    expect(mocks.unstableRethrow).toHaveBeenCalledWith(refreshError);
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "cache-refresh",
      refreshError,
    );
  });
});
