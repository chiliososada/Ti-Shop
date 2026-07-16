export type AccessGuardReason =
  | "owner_required"
  | "self_owner_removal"
  | "self_deactivation"
  | "last_active_owner";

type RoleGuardInput = {
  operation: "assign_role" | "remove_role";
  actorUserId: string;
  targetUserId: string;
  roleSlug: string;
  actorIsOwner: boolean;
  targetIsOwner: boolean;
  targetIsActive: boolean;
  activeOwnerCount: number;
};

type AdminStatusGuardInput = {
  operation: "set_admin_active";
  actorUserId: string;
  targetUserId: string;
  nextIsActive: boolean;
  actorIsOwner: boolean;
  targetIsOwner: boolean;
  targetIsActive: boolean;
  activeOwnerCount: number;
};

export type AccessGuardInput = RoleGuardInput | AdminStatusGuardInput;

export function evaluateAccessGuard(
  input: AccessGuardInput,
): AccessGuardReason | null {
  if (
    (input.operation === "assign_role" ||
      input.operation === "remove_role") &&
    input.roleSlug === "owner" &&
    !input.actorIsOwner
  ) {
    return "owner_required";
  }

  if (
    input.operation === "remove_role" &&
    input.roleSlug === "owner" &&
    input.actorUserId === input.targetUserId
  ) {
    return "self_owner_removal";
  }

  if (
    input.operation === "set_admin_active" &&
    !input.nextIsActive &&
    input.actorUserId === input.targetUserId
  ) {
    return "self_deactivation";
  }

  if (
    input.operation === "set_admin_active" &&
    input.targetIsOwner &&
    !input.actorIsOwner
  ) {
    return "owner_required";
  }

  const removesAnActiveOwner =
    input.targetIsOwner &&
    input.targetIsActive &&
    ((input.operation === "remove_role" && input.roleSlug === "owner") ||
      (input.operation === "set_admin_active" && !input.nextIsActive));

  if (removesAnActiveOwner && input.activeOwnerCount <= 1) {
    return "last_active_owner";
  }

  return null;
}
