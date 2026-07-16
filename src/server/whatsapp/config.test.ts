import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEFAULT_WHATSAPP_SETTING,
  parseOperationalWhatsAppConfig,
  templateValidationMessage,
  whatsappSettingValueSchema,
} from "@/server/whatsapp/config";

const configuredValue = {
  ...DEFAULT_WHATSAPP_SETTING,
  configured: true,
  phoneE164: "+12025550123",
  displayValue: "+1 202 555 0123",
};

describe("WhatsApp configuration", () => {
  it("fails closed for the safe seed default", () => {
    expect(parseOperationalWhatsAppConfig(DEFAULT_WHATSAPP_SETTING)).toBeNull();
  });

  it("accepts a complete enabled configuration", () => {
    expect(parseOperationalWhatsAppConfig(configuredValue)).toMatchObject({
      configured: true,
      phoneE164: "+12025550123",
      displayValue: "+1 202 555 0123",
    });
  });

  it.each([
    { ...configuredValue, phoneE164: "12025550123" },
    { ...configuredValue, displayValue: null },
    { ...configuredValue, unexpected: true },
    {
      ...configuredValue,
      templates: { ...configuredValue.templates, product: "Ask about it" },
    },
  ])("rejects incomplete or non-strict enabled values", (value) => {
    expect(whatsappSettingValueSchema.safeParse(value).success).toBe(false);
    expect(parseOperationalWhatsAppConfig(value)).toBeNull();
  });

  it("rejects unknown and malformed template placeholders", () => {
    expect(templateValidationMessage("global", "Hello {{redirect}}"))
      .toMatch(/Unknown placeholder/);
    expect(templateValidationMessage("order", "Hello {{orderReference"))
      .toMatch(/exact/);
  });
});
