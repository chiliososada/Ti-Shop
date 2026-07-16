import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  disableAccount: vi.fn(),
  restoreAccount: vi.fn(),
  revalidatePath: vi.fn(),
  logUnexpected: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: mocks.unstableRethrow,
}));
vi.mock("@/server/admin/customers/mutations", () => ({
  updateAdminCustomerProfile: mocks.updateProfile,
  disableAdminCustomerAccount: mocks.disableAccount,
  restoreAdminCustomerAccount: mocks.restoreAccount,
}));
vi.mock("@/server/admin/audit/action-state", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/admin/audit/action-state")
  >();
  return { ...actual, logUnexpectedAdminActionError: mocks.logUnexpected };
});

import {
  disableCustomerAccountAction,
  restoreCustomerAccountAction,
  updateCustomerProfileAction,
} from "@/app/admin/customers/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

const CUSTOMER_ID = "f60bbf0e-4957-41ee-af8c-e6c50ceca73e";

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe("customer administration action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  const scenarios = [
    {
      name: "profile update",
      action: updateCustomerProfileAction,
      mutation: mocks.updateProfile,
      form: () =>
        form({
          publicId: CUSTOMER_ID,
          name: "Alice Research",
          firstName: "Alice",
          lastName: "Research",
          phone: "+1 202 555 0123",
          countryCode: "US",
        }),
      result: { ok: true, publicId: CUSTOMER_ID },
      scope: "customers.profile.update.cache-refresh",
    },
    {
      name: "account disable",
      action: disableCustomerAccountAction,
      mutation: mocks.disableAccount,
      form: () =>
        form({
          publicId: CUSTOMER_ID,
          reason: "Customer requested account deactivation.",
          confirmationEmail: "alice@example.com",
          confirmation: "DISABLE_CUSTOMER_ACCOUNT",
        }),
      result: {
        ok: true,
        publicId: CUSTOMER_ID,
        duplicate: false,
        revokedSessionCount: 2,
      },
      scope: "customers.account.disable.cache-refresh",
    },
    {
      name: "account restore",
      action: restoreCustomerAccountAction,
      mutation: mocks.restoreAccount,
      form: () =>
        form({
          publicId: CUSTOMER_ID,
          confirmationEmail: "alice@example.com",
          confirmation: "RESTORE_CUSTOMER_ACCOUNT",
        }),
      result: { ok: true, publicId: CUSTOMER_ID, duplicate: false },
      scope: "customers.account.restore.cache-refresh",
    },
  ];

  for (const scenario of scenarios) {
    it(`keeps a committed ${scenario.name} successful and continues refreshes`, async () => {
      const refreshError = new Error("customer list cache unavailable");
      scenario.mutation.mockResolvedValue(scenario.result);
      mocks.revalidatePath
        .mockImplementationOnce(() => {
          throw refreshError;
        })
        .mockImplementationOnce(() => undefined);

      const state = await scenario.action(
        INITIAL_ADMIN_ACTION_STATE,
        scenario.form(),
      );

      expect(state).toMatchObject({ status: "success", refreshPending: true });
      expect(state.message).toContain("database operation is committed");
      expect(state.message).toContain("page refreshes may be delayed");
      expect(state.message).toContain("Do not resubmit this form");
      expect(scenario.mutation).toHaveBeenCalledTimes(1);
      expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
      expect(mocks.logUnexpected).toHaveBeenCalledWith(
        scenario.scope,
        refreshError,
      );
      const paths = mocks.revalidatePath.mock.calls.map(([path]) =>
        String(path),
      );
      expect(new Set(paths).size).toBe(paths.length);
    });
  }

  it("preserves an account-control business failure without refresh", async () => {
    mocks.restoreAccount.mockResolvedValue({
      ok: false,
      reason: "confirmation_mismatch",
    });

    const state = await restoreCustomerAccountAction(
      INITIAL_ADMIN_ACTION_STATE,
      scenarios[2].form(),
    );

    expect(state.status).toBe("error");
    expect(state.message).toContain("confirmation email did not match");
    expect(mocks.restoreAccount).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a failure when the profile mutation itself fails", async () => {
    const mutationError = new Error("database write failed");
    mocks.updateProfile.mockRejectedValue(mutationError);

    const state = await updateCustomerProfileAction(
      INITIAL_ADMIN_ACTION_STATE,
      scenarios[0].form(),
    );

    expect(state.status).toBe("error");
    expect(state.message).toContain("could not be saved");
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "customers.profile.update",
      mutationError,
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rethrows framework control flow raised during refresh", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    mocks.disableAccount.mockResolvedValue(scenarios[1].result);
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw controlFlowError;
    });
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      disableCustomerAccountAction(
        INITIAL_ADMIN_ACTION_STATE,
        scenarios[1].form(),
      ),
    ).rejects.toBe(controlFlowError);

    expect(mocks.disableAccount).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
  });
});
