import { describe, expect, it } from "vitest";

import { isPermissionGranted } from "./permissions";

describe("isPermissionGranted", () => {
  it("allows an active administrator with the required permission", () => {
    expect(
      isPermissionGranted(true, new Set(["admin.access"]), "admin.access"),
    ).toBe(true);
  });

  it("denies an inactive administrator even when the role has permission", () => {
    expect(
      isPermissionGranted(false, new Set(["admin.access"]), "admin.access"),
    ).toBe(false);
  });

  it("denies an active administrator without the required permission", () => {
    expect(isPermissionGranted(true, new Set(), "admin.access")).toBe(false);
  });
});
