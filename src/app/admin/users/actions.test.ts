import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assignSystemRole: vi.fn(),
  removeSystemRole: vi.fn(),
  setAdminActive: vi.fn(),
  assignCustomRole: vi.fn(),
  removeCustomRole: vi.fn(),
  requirePermission: vi.fn(),
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
vi.mock("@/server/admin/access/mutations", () => ({
  assignAdminSystemRole: mocks.assignSystemRole,
  removeAdminSystemRole: mocks.removeSystemRole,
  setAdminProfileActive: mocks.setAdminActive,
}));
vi.mock("@/server/admin/access/role-mutations", () => ({
  assignAdminCustomRole: mocks.assignCustomRole,
  removeAdminCustomRole: mocks.removeCustomRole,
}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: mocks.requirePermission,
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
  assignCustomRoleAction,
  assignSystemRoleAction,
  removeCustomRoleAction,
  removeSystemRoleAction,
  setAdminProfileActiveAction,
} from "@/app/admin/users/actions";
import { INITIAL_ADMIN_ACTION_STATE } from "@/server/admin/audit/action-state";

function systemRoleForm(userPublicId: string) {
  const formData = new FormData();
  formData.set("userPublicId", userPublicId);
  formData.set("roleSlug", "operations_manager");
  return formData;
}

function customRoleForm(userPublicId: string, rolePublicId: string) {
  const formData = new FormData();
  formData.set("userPublicId", userPublicId);
  formData.set("rolePublicId", rolePublicId);
  return formData;
}

function adminStatusForm(userPublicId: string) {
  const formData = new FormData();
  formData.set("userPublicId", userPublicId);
  formData.set("isActive", "false");
  return formData;
}

describe("user access Server Action commit and refresh semantics", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requirePermission.mockResolvedValue({
      session: { user: { id: randomUUID() } },
      roles: ["owner"],
      permissions: new Set(["users.manage", "roles.manage"]),
    });
  });

  const userPublicId = randomUUID();
  const rolePublicId = randomUUID();
  const scenarios = [
    {
      name: "system role assignment",
      action: assignSystemRoleAction,
      mutation: mocks.assignSystemRole,
      form: () => systemRoleForm(userPublicId),
      mutationResult: { ok: true, duplicate: false, userPublicId },
      expectedInput: { userPublicId, roleSlug: "operations_manager" },
      expectedRefreshes: 5,
    },
    {
      name: "system role removal",
      action: removeSystemRoleAction,
      mutation: mocks.removeSystemRole,
      form: () => systemRoleForm(userPublicId),
      mutationResult: { ok: true, duplicate: false, userPublicId },
      expectedInput: { userPublicId, roleSlug: "operations_manager" },
      expectedRefreshes: 5,
    },
    {
      name: "custom role assignment",
      action: assignCustomRoleAction,
      mutation: mocks.assignCustomRole,
      form: () => customRoleForm(userPublicId, rolePublicId),
      mutationResult: {
        ok: true,
        duplicate: false,
        userPublicId,
        rolePublicId,
      },
      expectedInput: { userPublicId, rolePublicId },
      expectedRefreshes: 6,
    },
    {
      name: "custom role removal",
      action: removeCustomRoleAction,
      mutation: mocks.removeCustomRole,
      form: () => customRoleForm(userPublicId, rolePublicId),
      mutationResult: {
        ok: true,
        duplicate: false,
        userPublicId,
        rolePublicId,
      },
      expectedInput: { userPublicId, rolePublicId },
      expectedRefreshes: 6,
    },
    {
      name: "administrator status update",
      action: setAdminProfileActiveAction,
      mutation: mocks.setAdminActive,
      form: () => adminStatusForm(userPublicId),
      mutationResult: { ok: true, duplicate: false, userPublicId },
      expectedInput: { userPublicId, isActive: false },
      expectedRefreshes: 5,
    },
  ];

  for (const scenario of scenarios) {
    it(`keeps a committed ${scenario.name} successful when refresh fails`, async () => {
      const refreshError = new Error("cache backend unavailable");
      scenario.mutation.mockResolvedValue(scenario.mutationResult);
      mocks.revalidatePath
        .mockImplementationOnce(() => {
          throw refreshError;
        })
        .mockImplementation(() => undefined);

      const state = await scenario.action(
        INITIAL_ADMIN_ACTION_STATE,
        scenario.form(),
      );

      expect(state).toMatchObject({
        status: "success",
        refreshPending: true,
      });
      expect(state.message).toContain("database operation is committed");
      expect(state.message).toContain("page refreshes may be delayed");
      expect(state.message).not.toContain("could not be updated");
      expect(scenario.mutation).toHaveBeenCalledTimes(1);
      expect(scenario.mutation).toHaveBeenCalledWith(scenario.expectedInput);
      expect(mocks.unstableRethrow).toHaveBeenCalledWith(refreshError);
      expect(mocks.logUnexpected).toHaveBeenCalledWith(
        expect.stringMatching(/\.cache-refresh$/u),
        refreshError,
      );
      const refreshTargets = mocks.revalidatePath.mock.calls.map(([path]) =>
        String(path),
      );
      expect(refreshTargets).toHaveLength(scenario.expectedRefreshes);
      expect(new Set(refreshTargets).size).toBe(refreshTargets.length);
      expect(refreshTargets.length).toBeLessThanOrEqual(6);
    });
  }
});
