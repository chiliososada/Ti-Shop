import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRedirect: vi.fn(),
  updateRedirect: vi.fn(),
  updateSeo: vi.fn(),
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
vi.mock("@/server/admin/seo/mutations", () => ({
  createAdminRedirect: mocks.createRedirect,
  updateAdminRedirect: mocks.updateRedirect,
  updateAdminSeo: mocks.updateSeo,
}));
vi.mock("@/server/admin/audit/action-state", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/admin/audit/action-state")
  >();
  return { ...actual, logUnexpectedAdminActionError: mocks.logUnexpected };
});

import {
  createRedirectAction,
  updateSeoAction,
} from "@/app/admin/seo/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

const TARGET_ID = "c5c3f925-d98a-4599-963f-6b49fc646e93";

function validSeoForm() {
  const formData = new FormData();
  formData.set("entityType", "product");
  formData.set("targetPublicId", TARGET_ID);
  formData.set("title", "Search title");
  formData.set("description", "Search description");
  formData.set("canonicalUrl", "/products/action-product");
  formData.set("openGraphMediaPublicId", "");
  return formData;
}

function arrangeSuccessfulSeoMutation() {
  mocks.updateSeo.mockResolvedValue({
    ok: true,
    entityType: "product",
    publicId: TARGET_ID,
    publicPath: "/products/action-product",
    isManagedPage: false,
  });
}

function validRedirectCreateForm() {
  const formData = new FormData();
  formData.set("sourcePath", "/old-research-page");
  formData.set("destinationPath", "/research");
  formData.set("statusCode", "301");
  formData.set("preserveQuery", "on");
  formData.set("isActive", "on");
  formData.set("startsAt", "");
  formData.set("endsAt", "");
  return formData;
}

describe("SEO Server Action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("records each ordinary refresh error and returns committed success", async () => {
    const firstRefreshError = new Error("admin SEO cache unavailable");
    const secondRefreshError = new Error("sitemap cache unavailable");
    arrangeSuccessfulSeoMutation();
    mocks.revalidatePath
      .mockImplementationOnce(() => {
        throw firstRefreshError;
      })
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw secondRefreshError;
      })
      .mockImplementation(() => undefined);

    const state = await updateSeoAction(
      INITIAL_ADMIN_ACTION_STATE,
      validSeoForm(),
    );

    expect(state).toMatchObject({ status: "success", refreshPending: true });
    expect(state.message).toContain("database operation is committed");
    expect(state.message).toContain("cache refreshes may be delayed");
    expect(state.message).toContain("Do not resubmit this form");
    expect(mocks.updateSeo).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(4);
    expect(mocks.logUnexpected).toHaveBeenCalledTimes(2);
    expect(mocks.logUnexpected).toHaveBeenNthCalledWith(
      1,
      "seo.metadata.update.cache-refresh",
      firstRefreshError,
    );
    expect(mocks.logUnexpected).toHaveBeenNthCalledWith(
      2,
      "seo.metadata.update.cache-refresh",
      secondRefreshError,
    );
  });

  it("does not redirect or report failure after a committed redirect refresh error", async () => {
    const refreshError = new Error("redirect list cache unavailable");
    mocks.createRedirect.mockResolvedValue({ ok: true, publicId: TARGET_ID });
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw refreshError;
    });

    const state = await createRedirectAction(
      INITIAL_ADMIN_ACTION_STATE,
      validRedirectCreateForm(),
    );

    expect(state).toMatchObject({ status: "success", refreshPending: true });
    expect(state.message).toContain("database operation is committed");
    expect(state.message).toContain("Do not resubmit this form");
    expect(mocks.createRedirect).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "seo.redirect.create.cache-refresh",
      refreshError,
    );
  });

  it("returns a failure when the SEO mutation itself fails", async () => {
    const mutationError = new Error("database write failed");
    mocks.updateSeo.mockRejectedValue(mutationError);

    const state = await updateSeoAction(
      INITIAL_ADMIN_ACTION_STATE,
      validSeoForm(),
    );

    expect(state.status).toBe("error");
    expect(state.message).toContain("could not be saved");
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "seo.metadata.update",
      mutationError,
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rethrows framework control flow raised during cache refresh", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    arrangeSuccessfulSeoMutation();
    mocks.revalidatePath.mockImplementationOnce(() => {
      throw controlFlowError;
    });
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      updateSeoAction(INITIAL_ADMIN_ACTION_STATE, validSeoForm()),
    ).rejects.toBe(controlFlowError);

    expect(mocks.updateSeo).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
  });
});
