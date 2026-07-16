import { describe, expect, it } from "vitest";

import {
  inspectManagedPageBody,
  parseManagedPageContent,
} from "@/lib/managed-page-content";

describe("managed page safe content", () => {
  it("parses only headings, paragraphs, and bounded lists", () => {
    expect(
      parseManagedPageContent(
        "## Scope\n\nThis policy applies to supported orders.\n\n- First rule\n- Second rule",
      ),
    ).toEqual([
      { type: "heading", text: "Scope" },
      {
        type: "paragraph",
        text: "This policy applies to supported orders.",
      },
      { type: "list", items: ["First rule", "Second rule"] },
    ]);
  });

  it.each([
    ["<script>alert(1)</script>", "html"],
    ["Contact jane@example.com for approval.", "personal_information"],
    ["Customer SSN: 123-45-6789", "personal_information"],
    ["NOWPayments API key: abcdefghijklmnop", "payment_secret"],
    ["Routing number: 123456789", "payment_secret"],
    ["Zelle recipient: +1 415-555-1212", "personal_information"],
    [
      "Wallet: 0x1111111111111111111111111111111111111111",
      "payment_secret",
    ],
  ])("rejects unsafe public content: %s", (body, expected) => {
    expect(inspectManagedPageBody(body)).toBe(expected);
    expect(parseManagedPageContent(body)).toBeNull();
  });

  it("allows policy warnings that name sensitive credential types without publishing values", () => {
    const body =
      "Never share passwords, API keys, bank credentials, private keys, recovery phrases, or Zelle details on this page.";
    expect(inspectManagedPageBody(body)).toBeNull();
    expect(parseManagedPageContent(body)).toEqual([
      { type: "paragraph", text: body },
    ]);
  });
});
