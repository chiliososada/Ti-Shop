import { describe, expect, it } from "vitest";

import {
  buildWhatsAppDestinationUrl,
  isE164PhoneNumber,
  isTrustedWhatsAppUrl,
} from "@/lib/whatsapp";

describe("WhatsApp URL safety", () => {
  it("builds an encoded wa.me destination from an E.164 number", () => {
    const message = "Hello & welcome\n2 × BPC-157";
    const url = new URL(
      buildWhatsAppDestinationUrl("+12025550123", message),
    );

    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe("/12025550123");
    expect(url.searchParams.get("text")).toBe(message);
    expect(isTrustedWhatsAppUrl(url.toString())).toBe(true);
  });

  it.each([
    "12025550123",
    "+0123456789",
    "+123",
    "+1234567890123456",
    "+1 202 555 0123",
  ])("rejects non-E.164 number %s", (value) => {
    expect(isE164PhoneNumber(value)).toBe(false);
    expect(() => buildWhatsAppDestinationUrl(value, "Hello")).toThrow();
  });

  it.each([
    "http://wa.me/12025550123?text=hello",
    "https://wa.me.evil.example/12025550123?text=hello",
    "https://user@wa.me/12025550123?text=hello",
    "https://wa.me/not-a-number?text=hello",
    "https://wa.me/12025550123?text=hello&next=https://evil.example",
    "https://example.com/",
  ])("rejects untrusted destination %s", (value) => {
    expect(isTrustedWhatsAppUrl(value)).toBe(false);
  });
});
