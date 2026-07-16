import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  customRoleAssignmentSchema,
  customRoleCreateSchema,
  customRoleUpdateSchema,
} from "@/server/admin/access/role-validators";

describe("custom administrator role validators", () => {
  it("normalizes a strict role create payload and sorts permissions", () => {
    const submissionId = randomUUID();
    expect(
      customRoleCreateSchema.parse({
        submissionId,
        name: "  Research support  ",
        description: "  Handles research inquiries.  ",
        permissionSlugs: JSON.stringify([
          "customers.read",
          "admin.access",
        ]),
      }),
    ).toEqual({
      submissionId,
      name: "Research support",
      description: "Handles research inquiries.",
      permissionSlugs: ["admin.access", "customers.read"],
    });
  });

  it("rejects unknown, duplicate, malformed, and non-admin permission sets", () => {
    const base = {
      submissionId: randomUUID(),
      name: "Support role",
      description: "",
    };

    for (const permissionSlugs of [
      "not-json",
      JSON.stringify(["admin.access", "unknown.permission"]),
      JSON.stringify(["admin.access", "admin.access"]),
      JSON.stringify(["customers.read"]),
    ]) {
      expect(
        customRoleCreateSchema.safeParse({ ...base, permissionSlugs }).success,
      ).toBe(false);
    }
  });

  it("rejects unexpected fields, control characters, and non-opaque IDs", () => {
    expect(
      customRoleUpdateSchema.safeParse({
        publicId: randomUUID(),
        name: "Unsafe\nrole",
        description: "",
        permissionSlugs: JSON.stringify(["admin.access"]),
      }).success,
    ).toBe(false);
    expect(
      customRoleAssignmentSchema.safeParse({
        userPublicId: randomUUID(),
        rolePublicId: "1",
        isSystem: false,
      }).success,
    ).toBe(false);
  });
});
