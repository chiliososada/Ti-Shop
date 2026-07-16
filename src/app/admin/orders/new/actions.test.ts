import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createManualOrder: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  logUnexpected: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  unstable_rethrow: mocks.unstableRethrow,
}));
vi.mock("@/server/admin/orders/manual-order-mutations", () => ({
  createAdminManualOrder: mocks.createManualOrder,
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

import { createManualOrderAction } from "@/app/admin/orders/new/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

const customerUserId = randomUUID();
const variantPublicId = randomUUID();

function validForm() {
  const formData = new FormData();
  formData.set("idempotencyKey", randomUUID());
  formData.set("customerUserId", customerUserId);
  formData.set("paymentMethod", "WIRE_TRANSFER");
  formData.set(
    "itemsJson",
    JSON.stringify([{ variantPublicId, quantity: 2 }]),
  );
  formData.set("addressMode", "SAVED");
  formData.set("addressId", "1");
  formData.set("confirmation", "CREATE_PENDING_MANUAL_ORDER");
  return formData;
}

function createdResult(orderPublicId = randomUUID()) {
  return {
    created: true,
    order: {
      publicId: orderPublicId,
      orderNumber: "SA-20260713-ABC123",
    },
  };
}

describe("manual order action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("returns a committed success warning when refresh is delayed", async () => {
    const orderPublicId = randomUUID();
    const refreshError = new Error("cache backend unavailable");
    mocks.createManualOrder.mockResolvedValue(createdResult(orderPublicId));
    mocks.revalidatePath
      .mockImplementationOnce(() => {
        throw refreshError;
      })
      .mockImplementation(() => undefined);

    const state = await createManualOrderAction(
      INITIAL_ADMIN_ACTION_STATE,
      validForm(),
    );

    expect(state).toMatchObject({ status: "success", refreshPending: true });
    expect(state.message).toContain("database operation is committed");
    expect(state.message).toContain("page refreshes may be delayed");
    expect(state.message).toContain("Do not resubmit");
    expect(mocks.createManualOrder).toHaveBeenCalledTimes(1);
    expect(mocks.unstableRethrow).toHaveBeenCalledWith(refreshError);
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "orders.manual.create.cache-refresh",
      refreshError,
    );
    const paths = mocks.revalidatePath.mock.calls.map(([path]) => String(path));
    expect(paths).toEqual([
      "/admin/orders",
      `/admin/orders/${orderPublicId}`,
      "/account/orders",
      `/account/orders/${orderPublicId}`,
    ]);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("rethrows a framework control-flow error raised during refresh", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    mocks.createManualOrder.mockResolvedValue(createdResult());
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw controlFlowError;
    });
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      createManualOrderAction(INITIAL_ADMIN_ACTION_STATE, validForm()),
    ).rejects.toBe(controlFlowError);

    expect(mocks.createManualOrder).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("preserves the redirect after a successful mutation and refresh", async () => {
    const orderPublicId = randomUUID();
    const redirectError = new Error("NEXT_REDIRECT");
    mocks.createManualOrder.mockResolvedValue(createdResult(orderPublicId));
    mocks.redirect.mockImplementation(() => {
      throw redirectError;
    });

    await expect(
      createManualOrderAction(INITIAL_ADMIN_ACTION_STATE, validForm()),
    ).rejects.toBe(redirectError);

    expect(mocks.createManualOrder).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(4);
    expect(mocks.redirect).toHaveBeenCalledWith(`/admin/orders/${orderPublicId}`);
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
  });
});
