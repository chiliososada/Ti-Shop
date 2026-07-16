import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_WHATSAPP_TEMPLATES } from "@/server/whatsapp/config";
import { adminWhatsAppSettingsSchema } from "@/server/admin/settings/whatsapp/validators";

function validForm() {
  return {
    configured: "on",
    phoneE164: "+12025550123",
    displayValue: "+1 202 555 0123",
    welcomeMessage: "How can we help?",
    businessHours: "Monday–Friday, 9:00–17:00 ET",
    templateGlobal: DEFAULT_WHATSAPP_TEMPLATES.global,
    templateProduct: DEFAULT_WHATSAPP_TEMPLATES.product,
    templateCart: DEFAULT_WHATSAPP_TEMPLATES.cart,
    templateOrder: DEFAULT_WHATSAPP_TEMPLATES.order,
    templateContact: DEFAULT_WHATSAPP_TEMPLATES.contact,
  };
}

describe("admin WhatsApp settings validator", () => {
  it("maps strict form fields to the stored setting", () => {
    expect(adminWhatsAppSettingsSchema.parse(validForm())).toMatchObject({
      configured: true,
      phoneE164: "+12025550123",
      templates: { order: DEFAULT_WHATSAPP_TEMPLATES.order },
    });
  });

  it.each([
    { phoneE164: "12025550123" },
    { displayValue: "" },
    { templateOrder: "Hello, order please" },
    { templateProduct: "Hello {{productName}} {{redirect}}" },
    { unexpected: "field" },
  ])("rejects unsafe or incomplete changes", (change) => {
    expect(
      adminWhatsAppSettingsSchema.safeParse({ ...validForm(), ...change })
        .success,
    ).toBe(false);
  });
});
