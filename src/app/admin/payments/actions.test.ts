import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updatePaymentMethodConfig: vi.fn(),
  updateOnlinePaymentSwitch: vi.fn(),
  updateCheckoutCharges: vi.fn(),
  revalidatePath: vi.fn(),
  logUnexpected: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("next/navigation", () => ({
  unstable_rethrow: mocks.unstableRethrow,
}));
vi.mock("@/server/admin/payments/mutations", () => ({
  updateAdminPaymentMethodConfig: mocks.updatePaymentMethodConfig,
  updateAdminOnlinePaymentSwitch: mocks.updateOnlinePaymentSwitch,
  updateAdminCheckoutCharges: mocks.updateCheckoutCharges,
}));
vi.mock("@/server/admin/audit/action-state", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/admin/audit/action-state")
  >();
  return {
    ...actual,
    logUnexpectedAdminActionError: mocks.logUnexpected,
  };
});

import {
  updateCheckoutChargesAction,
  updateOnlinePaymentSwitchAction,
  updatePaymentMethodConfigAction,
} from "@/app/admin/payments/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe("payment settings action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  const scenarios = [
    {
      name: "payment method update",
      action: updatePaymentMethodConfigAction,
      mutation: mocks.updatePaymentMethodConfig,
      form: () =>
        form({
          method: "WIRE_TRANSFER",
          displayName: "Wire transfer",
          publicInstructions: "Contact us on WhatsApp for settlement details.",
          isEnabled: "on",
        }),
      result: { ok: true, method: "WIRE_TRANSFER" },
      expectedRefreshes: 4,
      scope: "payments.method_config.update.cache-refresh",
    },
    {
      name: "online payment switch update",
      action: updateOnlinePaymentSwitchAction,
      mutation: mocks.updateOnlinePaymentSwitch,
      form: () => form({ isEnabled: "on" }),
      result: { ok: true, isEnabled: true },
      expectedRefreshes: 3,
      scope: "settings.online_payments.update.cache-refresh",
    },
    {
      name: "checkout charges update",
      action: updateCheckoutChargesAction,
      mutation: mocks.updateCheckoutCharges,
      form: () =>
        form({
          configured: "on",
          shippingFlatMinor: "500",
          taxRateBps: "825",
        }),
      result: { ok: true },
      expectedRefreshes: 3,
      scope: "settings.checkout_charges.update.cache-refresh",
    },
  ];

  for (const scenario of scenarios) {
    it(`keeps a committed ${scenario.name} successful and continues refreshes`, async () => {
      const refreshError = new Error("cache backend unavailable");
      scenario.mutation.mockResolvedValue(scenario.result);
      mocks.revalidatePath
        .mockImplementationOnce(() => {
          throw refreshError;
        })
        .mockImplementation(() => undefined);

      const state = await scenario.action(
        INITIAL_ADMIN_ACTION_STATE,
        scenario.form(),
      );

      expect(state).toMatchObject({ status: "success", refreshPending: true });
      expect(state.message).toContain("database operation is committed");
      expect(state.message).toContain("page refreshes may be delayed");
      expect(state.message).toContain("Do not resubmit");
      expect(scenario.mutation).toHaveBeenCalledTimes(1);
      expect(mocks.unstableRethrow).toHaveBeenCalledWith(refreshError);
      expect(mocks.logUnexpected).toHaveBeenCalledWith(
        scenario.scope,
        refreshError,
      );
      const targets = mocks.revalidatePath.mock.calls.map(([path, type]) =>
        `${String(path)}:${String(type ?? "literal")}`,
      );
      expect(targets).toHaveLength(scenario.expectedRefreshes);
      expect(new Set(targets).size).toBe(targets.length);
    });
  }

  it("preserves a business failure without attempting refresh", async () => {
    mocks.updateOnlinePaymentSwitch.mockResolvedValue({
      ok: false,
      reason: "not_found",
    });

    const state = await updateOnlinePaymentSwitchAction(
      INITIAL_ADMIN_ACTION_STATE,
      form({ isEnabled: "on" }),
    );

    expect(state.status).toBe("error");
    expect(mocks.updateOnlinePaymentSwitch).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rethrows a framework control-flow error raised during refresh", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    mocks.updateOnlinePaymentSwitch.mockResolvedValue({
      ok: true,
      isEnabled: true,
    });
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw controlFlowError;
    });
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      updateOnlinePaymentSwitchAction(
        INITIAL_ADMIN_ACTION_STATE,
        form({ isEnabled: "on" }),
      ),
    ).rejects.toBe(controlFlowError);

    expect(mocks.updateOnlinePaymentSwitch).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
  });
});
