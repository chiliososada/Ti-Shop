import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBlogPost: vi.fn(),
  createFaq: vi.fn(),
  createPage: vi.fn(),
  updateBlogPost: vi.fn(),
  updateFaq: vi.fn(),
  updatePage: vi.fn(),
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
vi.mock("@/server/admin/content/mutations", () => ({
  createAdminBlogPost: mocks.createBlogPost,
  createAdminFaq: mocks.createFaq,
  createAdminPage: mocks.createPage,
  updateAdminBlogPost: mocks.updateBlogPost,
  updateAdminFaq: mocks.updateFaq,
  updateAdminPage: mocks.updatePage,
}));
vi.mock("@/server/admin/audit/action-state", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/admin/audit/action-state")
  >();
  return { ...actual, logUnexpectedAdminActionError: mocks.logUnexpected };
});

import { updatePageAction } from "@/app/admin/content/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

const PAGE_ID = "889766b4-e9ab-40a6-b878-4060da053bdf";

function validUpdatePageForm() {
  const formData = new FormData();
  formData.set("publicId", PAGE_ID);
  formData.set("slug", "updated-page");
  formData.set("title", "Updated page");
  formData.set("body", "Updated public content.");
  formData.set("format", "MARKDOWN");
  formData.set("status", "DRAFT");
  formData.set("publishedAt", "");
  return formData;
}

describe("content Server Action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("logs each refresh failure, continues refreshing, and keeps the save successful", async () => {
    const firstRefreshError = new Error("admin cache unavailable");
    const secondRefreshError = new Error("storefront cache unavailable");
    mocks.updatePage.mockResolvedValue({
      ok: true,
      publicId: PAGE_ID,
      slug: "updated-page",
      previousSlug: "previous-page",
    });
    mocks.revalidatePath
      .mockImplementationOnce(() => {
        throw firstRefreshError;
      })
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw secondRefreshError;
      })
      .mockImplementation(() => undefined);

    const state = await updatePageAction(
      INITIAL_ADMIN_ACTION_STATE,
      validUpdatePageForm(),
    );

    expect(state.status).toBe("success");
    expect(state.message).toContain("database operation is committed");
    expect(state.message).toContain("cache refreshes may be delayed");
    expect(state.message).toContain("Do not resubmit this form");
    expect(mocks.updatePage).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(6);
    const targets = mocks.revalidatePath.mock.calls.map(([path]) => String(path));
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets).toContain("/pages/previous-page");
    expect(targets).toContain("/pages/updated-page");
    expect(mocks.logUnexpected).toHaveBeenCalledTimes(2);
    expect(mocks.logUnexpected).toHaveBeenNthCalledWith(
      1,
      "content.page.update.cache-refresh",
      firstRefreshError,
    );
    expect(mocks.logUnexpected).toHaveBeenNthCalledWith(
      2,
      "content.page.update.cache-refresh",
      secondRefreshError,
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns a failure for a genuine mutation error without attempting refresh", async () => {
    const mutationError = new Error("database unavailable");
    mocks.updatePage.mockRejectedValue(mutationError);

    const state = await updatePageAction(
      INITIAL_ADMIN_ACTION_STATE,
      validUpdatePageForm(),
    );

    expect(state.status).toBe("error");
    expect(state.message).toContain("could not be saved");
    expect(mocks.updatePage).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "content.page.update",
      mutationError,
    );
  });

  it("rethrows framework control flow from the mutation without refreshing", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    mocks.updatePage.mockRejectedValue(controlFlowError);
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      updatePageAction(INITIAL_ADMIN_ACTION_STATE, validUpdatePageForm()),
    ).rejects.toBe(controlFlowError);

    expect(mocks.updatePage).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
  });
});
