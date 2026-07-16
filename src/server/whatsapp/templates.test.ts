import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEFAULT_WHATSAPP_SETTING,
  parseOperationalWhatsAppConfig,
} from "@/server/whatsapp/config";
import {
  normalizeWhatsAppSingleLine,
  renderWhatsAppTemplate,
} from "@/server/whatsapp/templates";

const config = parseOperationalWhatsAppConfig({
  ...DEFAULT_WHATSAPP_SETTING,
  configured: true,
  phoneE164: "+12025550123",
  displayValue: "+1 202 555 0123",
});

if (!config) throw new Error("Test configuration must be operational.");

describe("WhatsApp template rendering", () => {
  it("renders server-controlled product placeholders", () => {
    const message = renderWhatsAppTemplate(config, "product", {
      productName: "BPC-157",
      productSlug: "bpc-157",
      sku: "BPC-10MG",
      casNumber: "137525-51-0",
      productUrl: "https://shop.example/products/bpc-157",
    });
    expect(message).toContain("Product: BPC-157");
    expect(message).toContain("SKU: BPC-10MG");
    expect(message).toContain("https://shop.example/products/bpc-157");
  });

  it("removes unsafe control characters and line breaks from single-line data", () => {
    expect(normalizeWhatsAppSingleLine("Name\nInjected\u0000 value"))
      .toBe("Name Injected value");
  });
});
