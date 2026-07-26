import "server-only";

import { z } from "zod";

import { formatUsdMinor } from "@/domain/money";
import { getDb } from "@/server/db/client";

/**
 * Operator-editable wording lives in SiteSetting under this key as
 * `{ [templateKey]: { subject?, intro?, outro? } }`. Anything absent falls
 * back to the shipped defaults, so a partial override never breaks a send.
 * The structural parts of every email (item table, totals, tracking box,
 * footer) are rendered in code and are not operator-editable.
 */
export const EMAIL_TEMPLATES_SETTING_KEY = "notifications.email_templates";

export const EMAIL_TEMPLATE_KEYS = [
  "orderConfirmation",
  "paymentConfirmed",
  "orderShipped",
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export type EmailTemplate = {
  subject: string;
  intro: string;
  outro: string;
};

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplate> =
  {
    orderConfirmation: {
      subject: "Order {{orderNumber}} received — payment instructions inside",
      intro:
        "Thank you for your order. We have received order {{orderNumber}} and reserved your items.\n\nThis order is awaiting payment. To complete it, contact us on WhatsApp and we will send the payment instructions. Please include your order number {{orderNumber}} with your payment so we can match it quickly.",
      outro:
        "We verify every payment manually during business hours. You will receive a confirmation email as soon as your payment is verified.",
    },
    paymentConfirmed: {
      subject: "Payment confirmed for order {{orderNumber}}",
      intro:
        "We have verified your payment for order {{orderNumber}}. Your order is now confirmed and is being prepared for dispatch.",
      outro:
        "You will receive another email with tracking details as soon as your order ships.",
    },
    orderShipped: {
      subject: "Order {{orderNumber}} has shipped",
      intro: "Good news — your order {{orderNumber}} is on its way.",
      outro:
        "Tracking updates can take up to 24 hours to appear in the carrier's system. Keep this email for your records.",
    },
  };

const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

const templateFieldSchema = z
  .string()
  .min(1)
  .max(4000)
  .refine((value): boolean => !CONTROL_CHARACTER_PATTERN.test(value), {
    message: "Templates cannot contain control characters.",
  });

export const emailTemplatesSettingSchema = z
  .object({
    orderConfirmation: z
      .object({
        subject: templateFieldSchema.optional(),
        intro: templateFieldSchema.optional(),
        outro: templateFieldSchema.optional(),
      })
      .optional(),
    paymentConfirmed: z
      .object({
        subject: templateFieldSchema.optional(),
        intro: templateFieldSchema.optional(),
        outro: templateFieldSchema.optional(),
      })
      .optional(),
    orderShipped: z
      .object({
        subject: templateFieldSchema.optional(),
        intro: templateFieldSchema.optional(),
        outro: templateFieldSchema.optional(),
      })
      .optional(),
  })
  .strict();

export function mergeEmailTemplates(
  overrides: unknown,
): Record<EmailTemplateKey, EmailTemplate> {
  const parsed = emailTemplatesSettingSchema.safeParse(overrides);
  if (!parsed.success) return DEFAULT_EMAIL_TEMPLATES;
  const merged = {} as Record<EmailTemplateKey, EmailTemplate>;
  for (const key of EMAIL_TEMPLATE_KEYS) {
    merged[key] = { ...DEFAULT_EMAIL_TEMPLATES[key], ...parsed.data[key] };
  }
  return merged;
}

export async function loadEmailTemplates(): Promise<
  Record<EmailTemplateKey, EmailTemplate>
> {
  const setting = await getDb().siteSetting.findUnique({
    where: { key: EMAIL_TEMPLATES_SETTING_KEY },
    select: { value: true },
  });
  if (!setting) return DEFAULT_EMAIL_TEMPLATES;
  return mergeEmailTemplates(setting.value);
}

export type OrderEmailItem = {
  name: string;
  variant: string | null;
  quantity: number;
  lineTotalMinor: bigint;
};

export type OrderEmailData = {
  orderNumber: string;
  customerEmail: string;
  orderUrl: string;
  items: readonly OrderEmailItem[];
  subtotalMinor: bigint;
  shippingMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  whatsapp: { display: string; link: string } | null;
  tracking: {
    carrierName: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
  } | null;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const PLACEHOLDER_PATTERN = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu;

function interpolate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(
    PLACEHOLDER_PATTERN,
    (match, name: string) => variables[name] ?? match,
  );
}

function templateVariables(data: OrderEmailData): Record<string, string> {
  return {
    orderNumber: data.orderNumber,
    orderTotal: formatUsdMinor(data.totalMinor),
    carrierName: data.tracking?.carrierName ?? "the carrier",
    trackingNumber: data.tracking?.trackingNumber ?? "",
    whatsappNumber: data.whatsapp?.display ?? "",
  };
}

const BRAND_COLOR = "#43543d";
const MUTED_COLOR = "#5a6069";
const LINE_COLOR = "#e4e4de";

function itemsHtml(data: OrderEmailData): string {
  const rows = data.items
    .map((item) => {
      const label = item.variant
        ? `${escapeHtml(item.name)} — ${escapeHtml(item.variant)}`
        : escapeHtml(item.name);
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid ${LINE_COLOR};">${label}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${LINE_COLOR};text-align:center;white-space:nowrap;">× ${item.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${LINE_COLOR};text-align:right;white-space:nowrap;">${formatUsdMinor(item.lineTotalMinor)}</td>
      </tr>`;
    })
    .join("");
  const totals = [
    ["Subtotal", data.subtotalMinor],
    ["Shipping", data.shippingMinor],
    ["Tax", data.taxMinor],
  ] as const;
  const totalRows = totals
    .map(
      ([label, amount]) => `<tr>
        <td colspan="2" style="padding:4px 0;color:${MUTED_COLOR};">${label}</td>
        <td style="padding:4px 0;text-align:right;white-space:nowrap;">${formatUsdMinor(amount)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;margin:16px 0;">
    ${rows}
    ${totalRows}
    <tr>
      <td colspan="2" style="padding:8px 0;font-weight:bold;border-top:1px solid ${LINE_COLOR};">Total</td>
      <td style="padding:8px 0;font-weight:bold;text-align:right;border-top:1px solid ${LINE_COLOR};white-space:nowrap;">${formatUsdMinor(data.totalMinor)}</td>
    </tr>
  </table>`;
}

function itemsText(data: OrderEmailData): string {
  const lines = data.items.map((item) => {
    const label = item.variant ? `${item.name} — ${item.variant}` : item.name;
    return `  - ${label} × ${item.quantity}  ${formatUsdMinor(item.lineTotalMinor)}`;
  });
  lines.push(
    `  Subtotal: ${formatUsdMinor(data.subtotalMinor)}`,
    `  Shipping: ${formatUsdMinor(data.shippingMinor)}`,
    `  Tax: ${formatUsdMinor(data.taxMinor)}`,
    `  Total: ${formatUsdMinor(data.totalMinor)}`,
  );
  return lines.join("\n");
}

function trackingHtml(data: OrderEmailData): string {
  if (!data.tracking?.trackingNumber) return "";
  const carrier = data.tracking.carrierName
    ? `${escapeHtml(data.tracking.carrierName)} — `
    : "";
  const number = escapeHtml(data.tracking.trackingNumber);
  const link = data.tracking.trackingUrl
    ? `<p style="margin:8px 0 0;"><a href="${escapeHtml(data.tracking.trackingUrl)}" style="color:${BRAND_COLOR};">Track your package</a></p>`
    : "";
  return `<div style="background:#f2f4ee;border-radius:8px;padding:14px 18px;margin:16px 0;font-size:14px;">
    <strong>Tracking:</strong> ${carrier}${number}${link}
  </div>`;
}

function trackingText(data: OrderEmailData): string {
  if (!data.tracking?.trackingNumber) return "";
  const parts = [
    `Tracking: ${data.tracking.carrierName ? `${data.tracking.carrierName} — ` : ""}${data.tracking.trackingNumber}`,
  ];
  if (data.tracking.trackingUrl) parts.push(data.tracking.trackingUrl);
  return `\n${parts.join("\n")}\n`;
}

function whatsappHtml(data: OrderEmailData): string {
  if (!data.whatsapp) return "";
  return `<p style="margin:16px 0;">
    <a href="${escapeHtml(data.whatsapp.link)}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:999px;font-size:14px;font-weight:bold;">Contact us on WhatsApp (${escapeHtml(data.whatsapp.display)})</a>
  </p>`;
}

function paragraphsHtml(text: string): string {
  return text
    .split(/\n{2,}/u)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px;line-height:1.65;">${escapeHtml(paragraph).replaceAll("\n", "<br/>")}</p>`,
    )
    .join("");
}

function layoutHtml(data: OrderEmailData, body: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#faf7f0;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#21252b;">
  <table role="presentation" width="100%" style="border-collapse:collapse;background:#faf7f0;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" style="max-width:600px;width:100%;border-collapse:collapse;background:#ffffff;border-radius:12px;">
        <tr><td style="padding:28px 32px 12px;">
          <div style="font-size:20px;font-weight:bold;letter-spacing:0.12em;color:${BRAND_COLOR};">FLINTMARROW</div>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;font-size:15px;">
          ${body}
          <p style="margin:20px 0 0;font-size:13px;color:${MUTED_COLOR};">Order reference: <strong>${escapeHtml(data.orderNumber)}</strong> · <a href="${escapeHtml(data.orderUrl)}" style="color:${BRAND_COLOR};">View your order</a></p>
        </td></tr>
        <tr><td style="padding:18px 32px 26px;border-top:1px solid ${LINE_COLOR};font-size:12px;color:${MUTED_COLOR};line-height:1.6;">
          Flintmarrow products are supplied for laboratory research use only and are not for human or veterinary use.<br/>
          This is a transactional message about your order. Replies reach our support inbox.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderOrderEmail(
  kind: EmailTemplateKey,
  templates: Record<EmailTemplateKey, EmailTemplate>,
  data: OrderEmailData,
): RenderedEmail {
  const template = templates[kind];
  const variables = templateVariables(data);
  const subject = interpolate(template.subject, variables);
  const intro = interpolate(template.intro, variables);
  const outro = interpolate(template.outro, variables);

  const sections: string[] = [paragraphsHtml(intro)];
  const textSections: string[] = [intro];

  if (kind === "orderShipped") {
    sections.push(trackingHtml(data));
    const tracking = trackingText(data);
    if (tracking) textSections.push(tracking.trim());
  }

  sections.push(itemsHtml(data));
  textSections.push(`Order ${data.orderNumber}\n${itemsText(data)}`);

  if (kind === "orderConfirmation") {
    sections.push(whatsappHtml(data));
    if (data.whatsapp) {
      textSections.push(
        `Contact us on WhatsApp: ${data.whatsapp.display}\n${data.whatsapp.link}`,
      );
    }
  }

  sections.push(paragraphsHtml(outro));
  textSections.push(outro);
  textSections.push(`View your order: ${data.orderUrl}`);
  textSections.push(
    "Flintmarrow products are supplied for laboratory research use only and are not for human or veterinary use.",
  );

  return {
    subject,
    html: layoutHtml(data, sections.join("\n")),
    text: textSections.join("\n\n"),
  };
}
