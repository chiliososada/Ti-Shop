import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCategory: vi.fn(),
  createProduct: vi.fn(),
  createProductMedia: vi.fn(),
  createVariant: vi.fn(),
  detachProductMedia: vi.fn(),
  updateCategory: vi.fn(),
  updateProduct: vi.fn(),
  updateProductCategories: vi.fn(),
  updateProductMedia: vi.fn(),
  updateVariant: vi.fn(),
  updateVariantPrice: vi.fn(),
  revalidatePath: vi.fn(),
  logUnexpected: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: mocks.unstableRethrow,
}));
vi.mock("@/server/admin/catalog/mutations", () => ({
  createAdminCategory: mocks.createCategory,
  createAdminProduct: mocks.createProduct,
  createAdminProductMedia: mocks.createProductMedia,
  createAdminVariant: mocks.createVariant,
  detachAdminProductMedia: mocks.detachProductMedia,
  updateAdminCategory: mocks.updateCategory,
  updateAdminProduct: mocks.updateProduct,
  updateAdminProductCategories: mocks.updateProductCategories,
  updateAdminProductMedia: mocks.updateProductMedia,
  updateAdminVariant: mocks.updateVariant,
  updateAdminVariantPrice: mocks.updateVariantPrice,
}));
vi.mock("@/server/admin/audit/action-state", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/admin/audit/action-state")
  >();
  return { ...actual, logUnexpectedAdminActionError: mocks.logUnexpected };
});

import { createProductAction } from "@/app/admin/catalog/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

const PRODUCT_ID = "e2e76604-fd15-4de5-83ea-f938b61dc24f";

function validCreateProductForm() {
  const formData = new FormData();
  formData.set("slug", "action-product");
  formData.set("title", "Action product");
  formData.set("position", "3");
  return formData;
}

describe("catalog Server Action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("keeps a committed mutation successful and attempts every unique refresh", async () => {
    const firstRefreshError = new Error("cache one unavailable");
    const secondRefreshError = new Error("cache two unavailable");
    mocks.createProduct.mockResolvedValue({
      ok: true,
      publicId: PRODUCT_ID,
      slug: "action-product",
      categorySlugs: ["research", "research"],
      refreshHome: true,
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

    const state = await createProductAction(
      INITIAL_ADMIN_ACTION_STATE,
      validCreateProductForm(),
    );

    expect(state.status).toBe("success");
    expect(state.message).toContain("database operation is committed");
    expect(state.message).toContain("cache refreshes may be delayed");
    expect(state.message).toContain("Do not resubmit this form");
    expect(state.message).not.toContain("could not be created");
    expect(mocks.createProduct).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(7);
    const targets = mocks.revalidatePath.mock.calls.map(([path, type]) =>
      `${String(path)}:${String(type ?? "literal")}`,
    );
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets).toContain("/categories/[slug]:page");
    expect(mocks.logUnexpected).toHaveBeenCalledTimes(2);
    expect(mocks.logUnexpected).toHaveBeenNthCalledWith(
      1,
      "catalog.product.create.cache-refresh",
      firstRefreshError,
    );
    expect(mocks.logUnexpected).toHaveBeenNthCalledWith(
      2,
      "catalog.product.create.cache-refresh",
      secondRefreshError,
    );
  });

  it("rethrows framework control flow from the mutation without refreshing", async () => {
    const controlFlowError = new Error("NEXT_REDIRECT");
    mocks.createProduct.mockRejectedValue(controlFlowError);
    mocks.unstableRethrow.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      createProductAction(
        INITIAL_ADMIN_ACTION_STATE,
        validCreateProductForm(),
      ),
    ).rejects.toBe(controlFlowError);

    expect(mocks.createProduct).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logUnexpected).not.toHaveBeenCalled();
  });

  it("returns a failure for a genuine mutation error without attempting refresh", async () => {
    const mutationError = new Error("database unavailable");
    mocks.createProduct.mockRejectedValue(mutationError);

    const state = await createProductAction(
      INITIAL_ADMIN_ACTION_STATE,
      validCreateProductForm(),
    );

    expect(state).toMatchObject({ status: "error" });
    expect(state.message).toContain("could not be created");
    expect(mocks.createProduct).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logUnexpected).toHaveBeenCalledWith(
      "catalog.product.create",
      mutationError,
    );
  });

  it("preserves business failures without attempting cache refresh", async () => {
    mocks.createProduct.mockResolvedValue({ ok: false, reason: "slug_conflict" });

    const state = await createProductAction(
      INITIAL_ADMIN_ACTION_STATE,
      validCreateProductForm(),
    );

    expect(state).toMatchObject({ status: "error" });
    expect(state.message).toContain("slug is already reserved");
    expect(mocks.createProduct).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
