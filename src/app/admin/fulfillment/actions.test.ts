import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addTrackingEvent: vi.fn(),
  createCarrier: vi.fn(),
  createPackage: vi.fn(),
  createShipment: vi.fn(),
  deletePackage: vi.fn(),
  updateCarrier: vi.fn(),
  updatePackage: vi.fn(),
  updateShipmentDetails: vi.fn(),
  updateShipmentStatus: vi.fn(),
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
vi.mock("@/server/admin/fulfillment/mutations", () => ({
  addAdminTrackingEvent: mocks.addTrackingEvent,
  createAdminCarrier: mocks.createCarrier,
  createAdminPackage: mocks.createPackage,
  createAdminShipment: mocks.createShipment,
  deleteAdminPackage: mocks.deletePackage,
  updateAdminCarrier: mocks.updateCarrier,
  updateAdminPackage: mocks.updatePackage,
  updateAdminShipmentDetails: mocks.updateShipmentDetails,
  updateAdminShipmentStatus: mocks.updateShipmentStatus,
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

import { createPackageAction } from "@/app/admin/fulfillment/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

function validCreatePackageForm(shipmentPublicId = randomUUID()) {
  const formData = new FormData();
  formData.set("shipmentPublicId", shipmentPublicId);
  formData.set("weightGrams", "1250");
  formData.set("lengthMillimeters", "200");
  formData.set("widthMillimeters", "150");
  formData.set("heightMillimeters", "100");
  return formData;
}

describe("fulfillment Server Action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("keeps a committed package creation successful and attempts every refresh", async () => {
    const orderPublicId = randomUUID();
    const shipmentPublicId = randomUUID();
    const refreshError = new Error("cache backend unavailable");
    mocks.createPackage.mockResolvedValue({
      ok: true,
      publicId: randomUUID(),
      orderPublicId,
      shipmentNumber: "SHP-10001",
      packageNumber: 2,
    });
    mocks.revalidatePath
      .mockImplementationOnce(() => {
        throw refreshError;
      })
      .mockImplementation(() => undefined);

    const state = await createPackageAction(
      INITIAL_ADMIN_ACTION_STATE,
      validCreatePackageForm(shipmentPublicId),
    );

    expect(state).toMatchObject({
      status: "success",
      refreshPending: true,
    });
    expect(state.message).toContain("database operation is committed");
    expect(state.message).toContain("page refreshes may be delayed");
    expect(state.message).not.toContain("could not be added");
    expect(mocks.createPackage).toHaveBeenCalledTimes(1);
    expect(mocks.createPackage).toHaveBeenCalledWith({
      shipmentPublicId,
      weightGrams: 1250,
      lengthMillimeters: 200,
      widthMillimeters: 150,
      heightMillimeters: 100,
    });
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "fulfillment.package.create.cache-refresh",
      refreshError,
    );
    expect(mocks.unstableRethrow).toHaveBeenCalledWith(refreshError);

    const refreshTargets = mocks.revalidatePath.mock.calls.map(([path]) =>
      String(path),
    );
    expect(refreshTargets).toEqual([
      "/admin/fulfillment",
      `/admin/fulfillment/orders/${orderPublicId}`,
      "/admin/orders",
      `/admin/orders/${orderPublicId}`,
      "/account/orders",
      `/account/orders/${orderPublicId}`,
      "/admin",
    ]);
    expect(new Set(refreshTargets).size).toBe(refreshTargets.length);
    expect(refreshTargets.length).toBeLessThanOrEqual(8);
  });

  it("rethrows framework control-flow errors from the mutation", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    mocks.createPackage.mockRejectedValue(controlFlowError);
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      createPackageAction(
        INITIAL_ADMIN_ACTION_STATE,
        validCreatePackageForm(),
      ),
    ).rejects.toBe(controlFlowError);

    expect(mocks.createPackage).toHaveBeenCalledTimes(1);
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rethrows framework control-flow errors raised while refreshing", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    mocks.createPackage.mockResolvedValue({
      ok: true,
      publicId: randomUUID(),
      orderPublicId: randomUUID(),
      shipmentNumber: "SHP-10002",
      packageNumber: 1,
    });
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw controlFlowError;
    });
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      createPackageAction(
        INITIAL_ADMIN_ACTION_STATE,
        validCreatePackageForm(),
      ),
    ).rejects.toBe(controlFlowError);

    expect(mocks.createPackage).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
  });
});
