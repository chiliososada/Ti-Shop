import { describe, expect, it } from "vitest";

import { accountNameSchema } from "@/server/auth/account-name";

describe("account name validation", () => {
  it.each(["", " ", "A", `A${"b".repeat(255)}`])(
    "rejects %j",
    (value) => {
      expect(accountNameSchema.safeParse(value).success).toBe(false);
    },
  );

  it("trims a valid name on the server", () => {
    expect(accountNameSchema.parse("  Ada Lovelace  ")).toBe("Ada Lovelace");
  });
});
