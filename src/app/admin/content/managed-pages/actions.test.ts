import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsertManagedPage: vi.fn(),
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
vi.mock("@/server/admin/content/managed-page-mutations", () => ({
  upsertAdminManagedPage: mocks.upsertManagedPage,
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

import { saveManagedPageAction } from "@/app/admin/content/managed-pages/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

function validManagedPageForm() {
  const formData = new FormData();
  formData.set("routeKey", "SHIPPING");
  formData.set("title", "Shipping policy");
  formData.set("body", "## Shipping\n\nReviewed shipping details.");
  formData.set("status", "DRAFT");
  formData.set("publishedAt", "");
  return formData;
}

describe("managed page Server Action commit and refresh semantics", () => {
  beforeEach(() => {
    mocks.upsertManagedPage.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.logUnexpected.mockReset();
    mocks.unstableRethrow.mockReset();
  });

  it("keeps a committed save successful when cache refresh partly fails", async () => {
    const refreshError = new Error("cache backend unavailable");
    mocks.upsertManagedPage.mockResolvedValue({
      ok: true,
      duplicate: false,
      publicId: "4c666c26-c45e-4fd0-b690-694891fec8b2",
      publicPath: "/shipping",
      adminSlug: "shipping",
    });
    mocks.revalidatePath
      .mockImplementationOnce(() => {
        throw refreshError;
      })
      .mockImplementation(() => undefined);

    const state = await saveManagedPageAction(
      INITIAL_ADMIN_ACTION_STATE,
      validManagedPageForm(),
    );

    expect(state).toMatchObject({
      status: "success",
      refreshPending: true,
    });
    expect(state.message).toContain("database operation is committed");
    expect(state.message).toContain("refreshes may be delayed");
    expect(state.message).not.toContain("could not be saved");
    expect(mocks.upsertManagedPage).toHaveBeenCalledTimes(1);
    expect(mocks.upsertManagedPage).toHaveBeenCalledWith({
      routeKey: "SHIPPING",
      title: "Shipping policy",
      body: "## Shipping\n\nReviewed shipping details.",
      status: "DRAFT",
      publishedAt: null,
    });
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "content.managed_page.cache-refresh",
      refreshError,
    );
    expect(mocks.unstableRethrow).not.toHaveBeenCalled();

    const refreshTargets = mocks.revalidatePath.mock.calls.map(([path]) =>
      String(path),
    );
    expect(refreshTargets).toHaveLength(6);
    expect(new Set(refreshTargets).size).toBe(refreshTargets.length);
    expect(refreshTargets.length).toBeLessThanOrEqual(8);
  });
});
