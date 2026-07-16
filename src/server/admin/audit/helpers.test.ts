import { describe, expect, it } from "vitest";
import { z } from "zod";

import { validationFailure } from "@/server/admin/audit/action-state";
import { readStrictFormData } from "@/server/admin/audit/form-data";
import { toAuditJson } from "@/server/admin/audit/serialize";

describe("strict admin FormData", () => {
  it("accepts only declared scalar fields and ignores Next action metadata", () => {
    const form = new FormData();
    form.set("title", "Product");
    form.set("$ACTION_ID_example", "internal");

    expect(readStrictFormData(form, ["title"])).toEqual({
      success: true,
      data: { title: "Product" },
    });
  });

  it("rejects unknown, duplicate, and file fields", () => {
    const unknown = new FormData();
    unknown.set("title", "Product");
    unknown.set("internalId", "1");
    expect(readStrictFormData(unknown, ["title"]).success).toBe(false);

    const duplicate = new FormData();
    duplicate.append("title", "A");
    duplicate.append("title", "B");
    expect(readStrictFormData(duplicate, ["title"]).success).toBe(false);

    const file = new FormData();
    file.set("title", new Blob(["x"]), "x.txt");
    expect(readStrictFormData(file, ["title"]).success).toBe(false);
  });
});

describe("admin action helpers", () => {
  it("returns accessible field errors without raw input values", () => {
    const result = z.object({ title: z.string().min(3) }).safeParse({ title: "x" });
    if (result.success) throw new Error("Expected validation to fail.");

    expect(validationFailure(result.error)).toEqual({
      status: "error",
      message: "Review the highlighted form errors and try again.",
      fieldErrors: { title: ["Too small: expected string to have >=3 characters"] },
    });
  });

  it("serializes bigint and dates into JSON-safe audit snapshots", () => {
    const snapshot = toAuditJson({
      id: BigInt(42),
      at: new Date("2026-07-13T00:00:00.000Z"),
      nested: [BigInt(7), null],
    });

    expect(snapshot).toEqual({
      id: "42",
      at: "2026-07-13T00:00:00.000Z",
      nested: ["7", null],
    });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });
});
