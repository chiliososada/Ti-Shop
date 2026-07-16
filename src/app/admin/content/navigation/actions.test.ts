import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createNavigation: vi.fn(),
  createNavigationItem: vi.fn(),
  updateNavigation: vi.fn(),
  updateNavigationItem: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  logUnexpected: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  unstable_rethrow: mocks.unstableRethrow,
}));
vi.mock("@/server/admin/navigation/mutations", () => ({
  createAdminNavigation: mocks.createNavigation,
  createAdminNavigationItem: mocks.createNavigationItem,
  updateAdminNavigation: mocks.updateNavigation,
  updateAdminNavigationItem: mocks.updateNavigationItem,
}));
vi.mock("@/server/admin/audit/action-state", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/admin/audit/action-state")
  >();
  return { ...actual, logUnexpectedAdminActionError: mocks.logUnexpected };
});

import { createNavigationAction } from "@/app/admin/content/navigation/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

const NAVIGATION_ID = "3a9fd8b6-9c4a-4fe5-98e9-92c7c75aa1f8";
const SUBMISSION_ID = "df9ff0b6-56ab-479a-b25f-047671788d1f";

function validCreateNavigationForm() {
  const formData = new FormData();
  formData.set("submissionId", SUBMISSION_ID);
  formData.set("key", "test-header");
  formData.set("name", "Test header");
  formData.set("status", "DRAFT");
  return formData;
}

describe("navigation Server Action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("returns a committed-success warning instead of retrying or redirecting after refresh failure", async () => {
    const refreshError = new Error("layout cache unavailable");
    mocks.createNavigation.mockResolvedValue({
      ok: true,
      duplicate: false,
      publicId: NAVIGATION_ID,
    });
    mocks.revalidatePath
      .mockImplementationOnce(() => {
        throw refreshError;
      })
      .mockImplementation(() => undefined);

    const state = await createNavigationAction(
      INITIAL_ADMIN_ACTION_STATE,
      validCreateNavigationForm(),
    );

    expect(state.status).toBe("success");
    expect(state.message).toContain("database operation is committed");
    expect(state.message).toContain("cache refreshes may be delayed");
    expect(state.message).toContain("Do not resubmit this form");
    expect(mocks.createNavigation).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(4);
    const targets = mocks.revalidatePath.mock.calls.map(([path, type]) =>
      `${String(path)}:${String(type ?? "literal")}`,
    );
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets).toContain("/:layout");
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "content.navigation.create.cache-refresh",
      refreshError,
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns a failure for a genuine mutation error without attempting refresh", async () => {
    const mutationError = new Error("database unavailable");
    mocks.createNavigation.mockRejectedValue(mutationError);

    const state = await createNavigationAction(
      INITIAL_ADMIN_ACTION_STATE,
      validCreateNavigationForm(),
    );

    expect(state.status).toBe("error");
    expect(state.message).toContain("could not be created");
    expect(mocks.createNavigation).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "content.navigation.create",
      mutationError,
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("rethrows framework control flow from the mutation without refreshing", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    mocks.createNavigation.mockRejectedValue(controlFlowError);
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      createNavigationAction(
        INITIAL_ADMIN_ACTION_STATE,
        validCreateNavigationForm(),
      ),
    ).rejects.toBe(controlFlowError);

    expect(mocks.createNavigation).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
