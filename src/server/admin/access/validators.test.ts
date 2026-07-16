import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  adminStatusSchema,
  auditFilterSchema,
  roleAssignmentSchema,
} from "@/server/admin/access/validators";

describe("administrator access validators", () => {
  it("accepts only opaque user IDs and constrained role slugs", () => {
    expect(
      roleAssignmentSchema.parse({
        userPublicId: randomUUID(),
        roleSlug: "operations_manager",
      }).roleSlug,
    ).toBe("operations_manager");
    expect(
      roleAssignmentSchema.safeParse({
        userPublicId: "1",
        roleSlug: "owner;drop table users",
      }).success,
    ).toBe(false);
    expect(
      roleAssignmentSchema.safeParse({
        userPublicId: randomUUID(),
        roleSlug: "owner",
        permission: "roles.manage",
      }).success,
    ).toBe(false);
  });

  it("uses an explicit boolean value for administrator status", () => {
    const userPublicId = randomUUID();
    expect(adminStatusSchema.parse({ userPublicId, isActive: "true" })).toEqual({
      userPublicId,
      isActive: true,
    });
    expect(
      adminStatusSchema.safeParse({ userPublicId, isActive: "on" }).success,
    ).toBe(false);
  });

  it("bounds audit filters and validates their date range", () => {
    expect(
      auditFilterSchema.parse({ action: "orders.", page: "2", pageSize: "25" }),
    ).toMatchObject({ action: "orders.", page: 2, pageSize: 25 });
    expect(
      auditFilterSchema.safeParse({ from: "2026-07-14", to: "2026-07-13" })
        .success,
    ).toBe(false);
    expect(auditFilterSchema.safeParse({ page: "10001" }).success).toBe(false);
    expect(
      auditFilterSchema.safeParse({ actorPublicId: [randomUUID()] }).success,
    ).toBe(false);
  });
});
