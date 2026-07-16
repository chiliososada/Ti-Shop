import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveOrDeleteTag: vi.fn(),
  createPlacement: vi.fn(),
  createTag: vi.fn(),
  deletePlacement: vi.fn(),
  logUnexpected: vi.fn(),
  revalidatePath: vi.fn(),
  unstableRethrow: vi.fn(),
  updatePlacement: vi.fn(),
  updateProductTags: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("next/navigation", () => ({
  unstable_rethrow: mocks.unstableRethrow,
}));
vi.mock("@/server/admin/catalog/organization-mutations", () => ({
  archiveOrDeleteAdminTag: mocks.archiveOrDeleteTag,
  createAdminPlacement: mocks.createPlacement,
  createAdminTag: mocks.createTag,
  deleteAdminPlacement: mocks.deletePlacement,
  updateAdminPlacement: mocks.updatePlacement,
  updateAdminProductTags: mocks.updateProductTags,
  updateAdminTag: mocks.updateTag,
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
  archiveOrDeleteTagAction,
  createPlacementAction,
  createTagAction,
  deletePlacementAction,
  updatePlacementAction,
  updateProductTagsAction,
  updateTagAction,
} from "@/app/admin/catalog/organization/actions";

const PRODUCT_ID = "00000000-0000-4000-8000-000000000001";
const TAG_ID = "00000000-0000-4000-8000-000000000002";
const PLACEMENT_ID = "00000000-0000-4000-8000-000000000003";
const SUBMISSION_ID = "00000000-0000-4000-8000-000000000004";
const PREVIOUS_STATE = { status: "idle" as const, message: "" };
const AFFECTED_PRODUCT = {
  productPublicId: PRODUCT_ID,
  slug: "action-product",
  categorySlugs: ["category-one", "category-two", "category-one"],
};

function form(entries: readonly (readonly [string, string])[]) {
  const formData = new FormData();
  for (const [key, value] of entries) formData.append(key, value);
  return formData;
}

const committedActionCases = [
  {
    name: "tag creation",
    scope: "catalog.tag.create.cache-refresh",
    mutation: mocks.createTag,
    refreshCount: 2,
    arrange() {
      mocks.createTag.mockResolvedValue({
        ok: true,
        duplicate: false,
        publicId: TAG_ID,
        affectedProducts: [],
      });
    },
    invoke() {
      return createTagAction(
        PREVIOUS_STATE,
        form([
          ["submissionId", TAG_ID],
          ["slug", "action-tag"],
          ["name", "Action tag"],
          ["status", "ACTIVE"],
        ]),
      );
    },
  },
  {
    name: "tag update",
    scope: "catalog.tag.update.cache-refresh",
    mutation: mocks.updateTag,
    refreshCount: 7,
    arrange() {
      mocks.updateTag.mockResolvedValue({
        ok: true,
        duplicate: false,
        publicId: TAG_ID,
        affectedProducts: [AFFECTED_PRODUCT],
      });
    },
    invoke() {
      return updateTagAction(
        PREVIOUS_STATE,
        form([
          ["publicId", TAG_ID],
          ["slug", "action-tag"],
          ["name", "Updated action tag"],
          ["status", "ACTIVE"],
        ]),
      );
    },
  },
  {
    name: "tag archive or delete",
    scope: "catalog.tag.archive_or_delete.cache-refresh",
    mutation: mocks.archiveOrDeleteTag,
    refreshCount: 7,
    arrange() {
      mocks.archiveOrDeleteTag.mockResolvedValue({
        ok: true,
        duplicate: false,
        mode: "archived",
        publicId: TAG_ID,
        affectedProducts: [AFFECTED_PRODUCT],
      });
    },
    invoke() {
      return archiveOrDeleteTagAction(
        PREVIOUS_STATE,
        form([["publicId", TAG_ID]]),
      );
    },
  },
  {
    name: "product tag assignment",
    scope: "catalog.product.tags.update.cache-refresh",
    mutation: mocks.updateProductTags,
    refreshCount: 7,
    arrange() {
      mocks.updateProductTags.mockResolvedValue({
        ok: true,
        duplicate: false,
        productPublicId: PRODUCT_ID,
        affectedProducts: [AFFECTED_PRODUCT],
      });
    },
    invoke() {
      return updateProductTagsAction(
        PREVIOUS_STATE,
        form([
          ["productPublicId", PRODUCT_ID],
          ["tagPublicIds", TAG_ID],
        ]),
      );
    },
  },
  {
    name: "placement creation",
    scope: "catalog.merchandising_placement.create.cache-refresh",
    mutation: mocks.createPlacement,
    refreshCount: 8,
    arrange() {
      mocks.createPlacement.mockResolvedValue({
        ok: true,
        duplicate: false,
        placementPublicId: PLACEMENT_ID,
        affectedProducts: [AFFECTED_PRODUCT],
      });
    },
    invoke() {
      return createPlacementAction(
        PREVIOUS_STATE,
        form([
          ["submissionId", SUBMISSION_ID],
          ["placementKey", "legacy-home-bestsellers"],
          ["productPublicId", PRODUCT_ID],
          ["position", "100"],
          ["isActive", "on"],
        ]),
      );
    },
  },
  {
    name: "placement update",
    scope: "catalog.merchandising_placement.update.cache-refresh",
    mutation: mocks.updatePlacement,
    refreshCount: 8,
    arrange() {
      mocks.updatePlacement.mockResolvedValue({
        ok: true,
        duplicate: false,
        placementPublicId: PLACEMENT_ID,
        affectedProducts: [AFFECTED_PRODUCT],
      });
    },
    invoke() {
      return updatePlacementAction(
        PREVIOUS_STATE,
        form([
          ["placementPublicId", PLACEMENT_ID],
          ["placementKey", "legacy-home-bestsellers"],
          ["position", "101"],
          ["isActive", "on"],
        ]),
      );
    },
  },
  {
    name: "placement deletion",
    scope: "catalog.merchandising_placement.delete.cache-refresh",
    mutation: mocks.deletePlacement,
    refreshCount: 8,
    arrange() {
      mocks.deletePlacement.mockResolvedValue({
        ok: true,
        duplicate: false,
        placementPublicId: PLACEMENT_ID,
        affectedProducts: [AFFECTED_PRODUCT],
      });
    },
    invoke() {
      return deletePlacementAction(
        PREVIOUS_STATE,
        form([
          ["placementPublicId", PLACEMENT_ID],
          ["placementKey", "legacy-home-bestsellers"],
        ]),
      );
    },
  },
] as const;

describe("catalog organization Server Action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it.each(committedActionCases)(
    "keeps committed $name successful when every cache refresh fails",
    async ({ arrange, invoke, mutation, refreshCount, scope }) => {
      const refreshError = new Error("cache backend unavailable");
      arrange();
      mocks.revalidatePath.mockImplementation(() => {
        throw refreshError;
      });

      const state = await invoke();

      expect(state).toMatchObject({
        status: "success",
        refreshPending: true,
      });
      expect(state.message).toContain("database change was committed");
      expect(state.message).toContain("cache refreshes are delayed");
      expect(state.message).toContain("Do not submit the form again");
      expect(mutation).toHaveBeenCalledTimes(1);
      expect(mocks.revalidatePath).toHaveBeenCalledTimes(refreshCount);
      expect(
        new Set(mocks.revalidatePath.mock.calls.map(([path]) => String(path)))
          .size,
      ).toBe(refreshCount);
      expect(mocks.logUnexpected).toHaveBeenCalledTimes(1);
      expect(mocks.logUnexpected).toHaveBeenCalledWith(scope, refreshError);
      expect(mocks.unstableRethrow).not.toHaveBeenCalled();
    },
  );
});
