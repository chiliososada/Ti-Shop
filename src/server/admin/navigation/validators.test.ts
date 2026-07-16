import { describe, expect, it } from "vitest";

import {
  navigationCreateFormSchema,
  navigationItemCreateFormSchema,
} from "@/server/admin/navigation/validators";

const PUBLIC_ID = "00000000-0000-4000-8000-000000000001";

describe("navigation administration validators", () => {
  it("strictly accepts a named navigation and rejects unsafe keys or fields", () => {
    const valid = {
      submissionId: PUBLIC_ID,
      key: "header",
      name: "Primary header",
      status: "PUBLISHED",
    };

    expect(navigationCreateFormSchema.safeParse(valid).success).toBe(true);
    expect(
      navigationCreateFormSchema.safeParse({ ...valid, key: "Header Menu" })
        .success,
    ).toBe(false);
    expect(
      navigationCreateFormSchema.safeParse({ ...valid, secret: "no" }).success,
    ).toBe(false);
  });

  it("normalizes safe link inputs and treats omitted checkboxes as false", () => {
    expect(
      navigationItemCreateFormSchema.parse({
        submissionId: PUBLIC_ID,
        navigationPublicId: "00000000-0000-4000-8000-000000000002",
        label: " Products ",
        url: "/products",
        position: "4",
        isVisible: "on",
      }),
    ).toMatchObject({
      label: "Products",
      url: "/products",
      position: 4,
      isVisible: true,
      openInNewTab: false,
    });
  });

  it("rejects unsafe destinations and label control characters", () => {
    const base = {
      submissionId: PUBLIC_ID,
      navigationPublicId: "00000000-0000-4000-8000-000000000002",
      label: "Documentation",
      url: "https://docs.example.com/",
      position: "0",
    };

    for (const url of [
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "//evil.example/",
      "https://user:password@example.com/",
      "/admin/users",
      "/api/orders",
      "/account/orders",
      "/checkout",
      "/_next/static/chunk.js",
    ]) {
      expect(
        navigationItemCreateFormSchema.safeParse({ ...base, url }).success,
        url,
      ).toBe(false);
    }
    expect(
      navigationItemCreateFormSchema.safeParse({
        ...base,
        label: "Docs\u202Eevil",
      }).success,
    ).toBe(false);
    expect(
      navigationItemCreateFormSchema.safeParse({
        ...base,
        label: "Documentation\n",
      }).success,
    ).toBe(false);
  });
});
