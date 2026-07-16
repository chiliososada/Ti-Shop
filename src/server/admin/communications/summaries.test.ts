import { describe, expect, it } from "vitest";

import {
  buildWhatsAppFollowUpSubject,
  summarizeWhatsAppTemplateKey,
  WHATSAPP_FOLLOW_UP_NOTICE,
} from "@/server/admin/communications/summaries";

describe("communication summaries", () => {
  it("only exposes known WhatsApp template labels", () => {
    expect(summarizeWhatsAppTemplateKey("product")).toBe("product");
    expect(summarizeWhatsAppTemplateKey("private-template-name")).toBe(
      "not recorded",
    );
    expect(summarizeWhatsAppTemplateKey(null)).toBe("not recorded");
  });

  it("creates bounded operational subjects from trusted linked records", () => {
    expect(
      buildWhatsAppFollowUpSubject({
        orderNumber: "SA-20260713-123",
        productTitle: "Ignored product",
      }),
    ).toBe("WhatsApp follow-up for order SA-20260713-123");
    expect(
      buildWhatsAppFollowUpSubject({
        orderNumber: null,
        productTitle: "A".repeat(400),
      }),
    ).toHaveLength(255);
  });

  it("states that a generated record is not a customer message", () => {
    expect(WHATSAPP_FOLLOW_UP_NOTICE).toContain("Administrative follow-up");
    expect(WHATSAPP_FOLLOW_UP_NOTICE).toContain("did not retain");
    expect(WHATSAPP_FOLLOW_UP_NOTICE).not.toMatch(/customer said/iu);
  });
});
