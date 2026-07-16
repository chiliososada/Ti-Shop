import { describe, expect, it } from "vitest";

import { evaluateAccessGuard } from "@/server/admin/access/policy";

const base = {
  actorUserId: "actor",
  targetUserId: "target",
  actorIsOwner: true,
  targetIsOwner: true,
  targetIsActive: true,
  activeOwnerCount: 2,
} as const;

describe("administrator access guard", () => {
  it("allows only owners to grant or revoke the owner role", () => {
    expect(
      evaluateAccessGuard({
        ...base,
        operation: "assign_role",
        roleSlug: "owner",
        actorIsOwner: false,
      }),
    ).toBe("owner_required");
    expect(
      evaluateAccessGuard({
        ...base,
        operation: "remove_role",
        roleSlug: "owner",
        actorIsOwner: false,
      }),
    ).toBe("owner_required");
  });

  it("does not let an owner remove their own owner assignment", () => {
    expect(
      evaluateAccessGuard({
        ...base,
        operation: "remove_role",
        roleSlug: "owner",
        targetUserId: "actor",
      }),
    ).toBe("self_owner_removal");
  });

  it("does not let an administrator deactivate their own profile", () => {
    expect(
      evaluateAccessGuard({
        ...base,
        operation: "set_admin_active",
        nextIsActive: false,
        targetUserId: "actor",
      }),
    ).toBe("self_deactivation");
  });

  it("allows only owners to change another owner's active status", () => {
    expect(
      evaluateAccessGuard({
        ...base,
        operation: "set_admin_active",
        nextIsActive: false,
        actorIsOwner: false,
      }),
    ).toBe("owner_required");
    expect(
      evaluateAccessGuard({
        ...base,
        operation: "set_admin_active",
        nextIsActive: true,
        targetIsActive: false,
        actorIsOwner: false,
      }),
    ).toBe("owner_required");
  });

  it("protects the final active owner from role removal and deactivation", () => {
    expect(
      evaluateAccessGuard({
        ...base,
        operation: "remove_role",
        roleSlug: "owner",
        activeOwnerCount: 1,
      }),
    ).toBe("last_active_owner");
    expect(
      evaluateAccessGuard({
        ...base,
        operation: "set_admin_active",
        nextIsActive: false,
        activeOwnerCount: 1,
      }),
    ).toBe("last_active_owner");
  });

  it("allows changes that cannot reduce the active owner set", () => {
    expect(
      evaluateAccessGuard({
        ...base,
        operation: "remove_role",
        roleSlug: "auditor",
        activeOwnerCount: 1,
      }),
    ).toBeNull();
    expect(
      evaluateAccessGuard({
        ...base,
        operation: "remove_role",
        roleSlug: "owner",
        targetIsActive: false,
        activeOwnerCount: 1,
      }),
    ).toBeNull();
    expect(
      evaluateAccessGuard({
        ...base,
        operation: "set_admin_active",
        nextIsActive: true,
        activeOwnerCount: 1,
      }),
    ).toBeNull();
  });
});
