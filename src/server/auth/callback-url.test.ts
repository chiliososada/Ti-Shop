import { describe, expect, it } from "vitest";

import { safeCallbackPath } from "./callback-url";

describe("safeCallbackPath", () => {
  it("keeps an internal path and its query string", () => {
    expect(safeCallbackPath("/admin?tab=orders")).toBe(
      "/admin?tab=orders",
    );
  });

  it.each([
    "https://attacker.example/path",
    "//attacker.example/path",
    "/api/auth/sign-out",
    "/login",
    "/register?next=/admin",
  ])("rejects unsafe callback %s", (candidate) => {
    expect(safeCallbackPath(candidate)).toBe("/account");
  });

  it("uses the first value when a query parameter is repeated", () => {
    expect(safeCallbackPath(["/account", "//attacker.example"])).toBe(
      "/account",
    );
  });
});
