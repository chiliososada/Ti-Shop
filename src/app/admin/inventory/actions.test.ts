import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  adjustInventory: vi.fn(),
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
vi.mock("@/server/admin/inventory/mutations", () => ({
  createAdminInventoryLocation: mocks.createLocation,
  updateAdminInventoryLocation: mocks.updateLocation,
  adjustAdminInventory: mocks.adjustInventory,
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
  adjustInventoryAction,
  createLocationAction,
  updateLocationAction,
} from "@/app/admin/inventory/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

function locationForm(publicId?: string) {
  return form({
    ...(publicId ? { publicId } : {}),
    code: "US-WEST",
    name: "US West",
    countryCode: "US",
    region: "CA",
    city: "Los Angeles",
    isActive: "on",
  });
}

describe("inventory action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  const locationPublicId = randomUUID();
  const scenarios = [
    {
      name: "location creation",
      action: createLocationAction,
      mutation: mocks.createLocation,
      form: () => locationForm(),
      result: { ok: true, publicId: locationPublicId },
      expectedRefreshes: 2,
      scope: "inventory.location.create.cache-refresh",
    },
    {
      name: "location update",
      action: updateLocationAction,
      mutation: mocks.updateLocation,
      form: () => locationForm(locationPublicId),
      result: { ok: true, publicId: locationPublicId },
      expectedRefreshes: 2,
      scope: "inventory.location.update.cache-refresh",
    },
    {
      name: "stock adjustment",
      action: adjustInventoryAction,
      mutation: mocks.adjustInventory,
      form: () =>
        form({
          idempotencyKey: randomUUID(),
          locationPublicId,
          variantPublicId: randomUUID(),
          quantityDelta: "5",
          reason: "Cycle count correction",
        }),
      result: { ok: true, duplicate: false, onHandAfter: 15 },
      expectedRefreshes: 1,
      scope: "inventory.level.adjust.cache-refresh",
    },
  ];

  for (const scenario of scenarios) {
    it(`keeps a committed ${scenario.name} successful after a refresh failure`, async () => {
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
      const paths = mocks.revalidatePath.mock.calls.map(([path]) => String(path));
      expect(paths).toHaveLength(scenario.expectedRefreshes);
      expect(new Set(paths).size).toBe(paths.length);
    });
  }

  it("preserves a business failure without attempting refresh", async () => {
    mocks.updateLocation.mockResolvedValue({ ok: false, reason: "not_found" });

    const state = await updateLocationAction(
      INITIAL_ADMIN_ACTION_STATE,
      locationForm(locationPublicId),
    );

    expect(state.status).toBe("error");
    expect(mocks.updateLocation).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rethrows a framework control-flow error raised during refresh", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    mocks.createLocation.mockResolvedValue({
      ok: true,
      publicId: locationPublicId,
    });
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw controlFlowError;
    });
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      createLocationAction(INITIAL_ADMIN_ACTION_STATE, locationForm()),
    ).rejects.toBe(controlFlowError);

    expect(mocks.createLocation).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
  });
});
