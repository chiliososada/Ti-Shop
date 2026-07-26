import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({
  getDb: () => {
    throw new Error("Rendering must not touch the database.");
  },
}));

import {
  DEFAULT_EMAIL_TEMPLATES,
  mergeEmailTemplates,
  renderOrderEmail,
  type OrderEmailData,
} from "@/server/email/templates";

function orderData(overrides: Partial<OrderEmailData> = {}): OrderEmailData {
  return {
    orderNumber: "FM-20260726-TEST01",
    customerEmail: "customer@example.com",
    orderUrl: "https://flintmarrow.com/account/orders/abc",
    items: [
      {
        name: "BPC-157",
        variant: "10mg",
        quantity: 4,
        lineTotalMinor: BigInt(18_000),
      },
      {
        name: "<script>alert(1)</script>",
        variant: null,
        quantity: 1,
        lineTotalMinor: BigInt(2_500),
      },
    ],
    subtotalMinor: BigInt(20_500),
    shippingMinor: BigInt(9_000),
    taxMinor: BigInt(0),
    totalMinor: BigInt(29_500),
    whatsapp: {
      display: "+81 80 4051 5888",
      link: "https://wa.me/818040515888?text=Hello",
    },
    tracking: null,
    ...overrides,
  };
}

describe("renderOrderEmail", () => {
  it("renders the order confirmation with totals and WhatsApp guidance", () => {
    const rendered = renderOrderEmail(
      "orderConfirmation",
      DEFAULT_EMAIL_TEMPLATES,
      orderData(),
    );
    expect(rendered.subject).toBe(
      "Order FM-20260726-TEST01 received — payment instructions inside",
    );
    expect(rendered.html).toContain("BPC-157 — 10mg");
    expect(rendered.html).toContain("$295.00");
    expect(rendered.html).toContain("wa.me/818040515888");
    expect(rendered.text).toContain("Total: $295.00");
    expect(rendered.text).toContain("+81 80 4051 5888");
  });

  it("escapes hostile product names in the HTML body", () => {
    const rendered = renderOrderEmail(
      "orderConfirmation",
      DEFAULT_EMAIL_TEMPLATES,
      orderData(),
    );
    expect(rendered.html).not.toContain("<script>alert(1)</script>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });

  it("includes tracking details in the shipped email when present", () => {
    const rendered = renderOrderEmail(
      "orderShipped",
      DEFAULT_EMAIL_TEMPLATES,
      orderData({
        tracking: {
          carrierName: "USPS",
          trackingNumber: "9400 1000 0000",
          trackingUrl: "https://tools.usps.com/track?9400",
        },
      }),
    );
    expect(rendered.subject).toBe("Order FM-20260726-TEST01 has shipped");
    expect(rendered.html).toContain("USPS");
    expect(rendered.html).toContain("9400 1000 0000");
    expect(rendered.html).toContain("Track your package");
    expect(rendered.text).toContain("USPS — 9400 1000 0000");
  });

  it("omits the WhatsApp button outside the confirmation email", () => {
    const rendered = renderOrderEmail(
      "paymentConfirmed",
      DEFAULT_EMAIL_TEMPLATES,
      orderData(),
    );
    expect(rendered.html).not.toContain("wa.me");
  });

  it("carries the research-use notice in both bodies", () => {
    const rendered = renderOrderEmail(
      "paymentConfirmed",
      DEFAULT_EMAIL_TEMPLATES,
      orderData(),
    );
    expect(rendered.html).toContain("laboratory research use only");
    expect(rendered.text).toContain("laboratory research use only");
  });
});

describe("mergeEmailTemplates", () => {
  it("applies partial overrides on top of the defaults", () => {
    const merged = mergeEmailTemplates({
      orderShipped: { subject: "Your Flintmarrow parcel {{orderNumber}}" },
    });
    expect(merged.orderShipped.subject).toBe(
      "Your Flintmarrow parcel {{orderNumber}}",
    );
    expect(merged.orderShipped.intro).toBe(
      DEFAULT_EMAIL_TEMPLATES.orderShipped.intro,
    );
    expect(merged.orderConfirmation).toEqual(
      DEFAULT_EMAIL_TEMPLATES.orderConfirmation,
    );
  });

  it("falls back to defaults entirely when the stored value is malformed", () => {
    expect(mergeEmailTemplates({ bogus: true })).toEqual(
      DEFAULT_EMAIL_TEMPLATES,
    );
    expect(mergeEmailTemplates("not an object")).toEqual(
      DEFAULT_EMAIL_TEMPLATES,
    );
  });

  it("keeps unknown placeholders literal instead of crashing", () => {
    const merged = mergeEmailTemplates({
      paymentConfirmed: { intro: "Hi {{unknownThing}} for {{orderNumber}}" },
    });
    const rendered = renderOrderEmail("paymentConfirmed", merged, orderData());
    expect(rendered.html).toContain("{{unknownThing}}");
    expect(rendered.html).toContain("FM-20260726-TEST01");
  });
});
