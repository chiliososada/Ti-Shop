import { describe, expect, it } from "vitest";

import {
  AdminIdentityCliUsageError,
  parseGrantAdminArgs,
  parseVerifyUserEmailArgs,
} from "../../../../scripts/lib/admin-identity-cli";

const userId = "0e69d767-3bd8-4a2c-82f1-616ecff21dad";

describe("administrator identity CLI arguments", () => {
  it("requires both exact identity fields and an operation-specific confirmation", () => {
    expect(
      parseGrantAdminArgs([
        "--confirm-owner-grant",
        "--email=OWNER@Example.com",
        `--user-id=${userId}`,
      ]),
    ).toEqual({ userId, email: "owner@example.com" });

    expect(
      parseVerifyUserEmailArgs([
        `--user-id=${userId}`,
        "--confirm-out-of-band",
        "--email=owner@example.com",
      ]),
    ).toEqual({ userId, email: "owner@example.com" });
  });

  it("rejects missing confirmations, partial identities, duplicate flags, and positional input", () => {
    const invalidArgumentSets = [
      [`--user-id=${userId}`, "--email=owner@example.com"],
      ["--confirm-owner-grant", "--email=owner@example.com"],
      [
        "--confirm-owner-grant",
        `--user-id=${userId}`,
        "--email=owner@example.com",
        "--email=second@example.com",
      ],
      ["owner@example.com", "--confirm-owner-grant"],
    ];

    for (const args of invalidArgumentSets) {
      expect(() => parseGrantAdminArgs(args)).toThrow(
        AdminIdentityCliUsageError,
      );
    }
  });
});
