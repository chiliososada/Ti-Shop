import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { buildMerchantTrackingUrl } from "@/lib/tracking";
import { buildWhatsAppDestinationUrl } from "@/lib/whatsapp";
import { resolvePublicSiteOrigin } from "@/lib/site-url";
import { getDb } from "@/server/db/client";
import { getEmailConfigState } from "@/server/email/config";
import { EMAIL_EVENT_TYPES } from "@/server/email/enqueue";
import {
  loadEmailTemplates,
  renderOrderEmail,
  type EmailTemplateKey,
  type OrderEmailData,
} from "@/server/email/templates";
import {
  sendViaSmtp,
  type EmailSender,
} from "@/server/email/transport";
import {
  parseOperationalWhatsAppConfig,
  WHATSAPP_SETTING_KEY,
} from "@/server/whatsapp/config";

const MAX_DELIVERY_ATTEMPTS = 12;
const MAX_BACKOFF_SECONDS = 3_600;
/**
 * A notification that could not be sent for this long is stale: delivering a
 * days-old "order received" mail after SMTP finally comes up would confuse
 * customers more than staying silent.
 */
const MAX_EVENT_AGE_HOURS = 72;

const orderPayloadSchema = z.object({
  orderPublicId: z.string().min(1),
  shipmentPublicId: z.string().min(1).optional(),
});

type ClaimedEvent = {
  id: bigint;
  event_type: string;
  payload: unknown;
  attempts: number;
  created_at: Date;
};

export type EmailOutboxRunReport = {
  claimed: number;
  published: number;
  retried: number;
  failedPermanently: number;
  details: {
    outboxId: string;
    eventType: string;
    outcome: "published" | "retried" | "failed";
    error: string | null;
  }[];
};

function backoffSeconds(attempts: number): number {
  return Math.min(2 ** Math.min(attempts, 12), MAX_BACKOFF_SECONDS);
}

const EVENT_TEMPLATE_BY_TYPE: Record<string, EmailTemplateKey> = {
  [EMAIL_EVENT_TYPES.orderConfirmation]: "orderConfirmation",
  [EMAIL_EVENT_TYPES.paymentConfirmed]: "paymentConfirmed",
  [EMAIL_EVENT_TYPES.orderShipped]: "orderShipped",
};

class PermanentEmailError extends Error {}

async function loadOrderEmailData(input: {
  orderPublicId: string;
  shipmentPublicId?: string;
}): Promise<OrderEmailData> {
  const db = getDb();
  const order = await db.order.findUnique({
    where: { publicId: input.orderPublicId },
    select: {
      publicId: true,
      orderNumber: true,
      customerEmail: true,
      subtotalMinor: true,
      shippingMinor: true,
      taxMinor: true,
      totalMinor: true,
      items: {
        orderBy: [{ id: "asc" }],
        select: {
          productName: true,
          variantName: true,
          quantity: true,
          lineTotalMinor: true,
        },
      },
    },
  });
  if (!order) {
    throw new PermanentEmailError(
      `Order ${input.orderPublicId} no longer exists.`,
    );
  }

  let tracking: OrderEmailData["tracking"] = null;
  if (input.shipmentPublicId) {
    const shipment = await db.shipment.findUnique({
      where: { publicId: input.shipmentPublicId },
      select: {
        trackingNumber: true,
        carrier: { select: { name: true, trackingUrlTemplate: true } },
      },
    });
    if (shipment) {
      tracking = {
        carrierName: shipment.carrier?.name ?? null,
        trackingNumber: shipment.trackingNumber,
        trackingUrl: buildMerchantTrackingUrl(
          shipment.carrier?.trackingUrlTemplate ?? null,
          shipment.trackingNumber,
        ),
      };
    }
  }

  const whatsappSetting = await db.siteSetting.findUnique({
    where: { key: WHATSAPP_SETTING_KEY },
    select: { value: true },
  });
  const whatsappConfig = parseOperationalWhatsAppConfig(
    whatsappSetting?.value,
  );
  const whatsapp = whatsappConfig
    ? {
        display: whatsappConfig.displayValue,
        link: buildWhatsAppDestinationUrl(
          whatsappConfig.phoneE164,
          `Hello, I need help with order reference ${order.orderNumber}.`,
        ),
      }
    : null;

  const siteOrigin = resolvePublicSiteOrigin();

  return {
    orderNumber: order.orderNumber,
    customerEmail: order.customerEmail,
    orderUrl: `${siteOrigin}/account/orders/${order.publicId}`,
    items: order.items.map((item) => ({
      name: item.productName,
      variant: item.variantName,
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor,
    })),
    subtotalMinor: order.subtotalMinor,
    shippingMinor: order.shippingMinor,
    taxMinor: order.taxMinor,
    totalMinor: order.totalMinor,
    whatsapp,
    tracking,
  };
}

/**
 * Claims and delivers pending email.* outbox events. FOR UPDATE SKIP LOCKED
 * keeps concurrent workers from double-sending; a claimed event is marked
 * published only after the SMTP server accepted the message.
 */
export async function processEmailOutboxBatch(input?: {
  limit?: number;
  now?: Date;
  send?: EmailSender;
}): Promise<EmailOutboxRunReport> {
  const limit = Math.min(Math.max(input?.limit ?? 25, 1), 100);
  const now = input?.now ?? new Date();
  const send = input?.send ?? sendViaSmtp;
  const lockedBy = `email-worker-${randomUUID().slice(0, 8)}`;
  const db = getDb();

  const report: EmailOutboxRunReport = {
    claimed: 0,
    published: 0,
    retried: 0,
    failedPermanently: 0,
    details: [],
  };

  const claimed = await db.$queryRaw<ClaimedEvent[]>`
    UPDATE "app"."outbox_events"
    SET "status" = 'processing', "locked_at" = ${now}, "locked_by" = ${lockedBy}
    WHERE "id" IN (
      SELECT "id" FROM "app"."outbox_events"
      WHERE "status" = 'pending'
        AND "event_type" LIKE 'email.%'
        AND "available_at" <= ${now}
      ORDER BY "available_at", "id"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "event_type", "payload", "attempts", "created_at"
  `;
  report.claimed = claimed.length;
  if (claimed.length === 0) return report;

  const configState = getEmailConfigState();
  const templates = await loadEmailTemplates();

  for (const event of claimed) {
    const outboxId = String(event.id);
    const attempts = event.attempts + 1;

    const complete = async (
      outcome: "published" | "retried" | "failed",
      error: string | null,
    ) => {
      await db.outboxEvent.update({
        where: { id: event.id },
        data:
          outcome === "published"
            ? {
                status: "PUBLISHED",
                attempts,
                publishedAt: now,
                lockedAt: null,
                lockedBy: null,
                lastError: null,
              }
            : outcome === "retried"
              ? {
                  status: "PENDING",
                  attempts,
                  availableAt: new Date(
                    now.getTime() + backoffSeconds(attempts) * 1_000,
                  ),
                  lockedAt: null,
                  lockedBy: null,
                  lastError: error,
                }
              : {
                  status: "FAILED",
                  attempts,
                  lockedAt: null,
                  lockedBy: null,
                  lastError: error,
                },
        select: { id: true },
      });
      if (outcome === "published") report.published += 1;
      if (outcome === "retried") report.retried += 1;
      if (outcome === "failed") report.failedPermanently += 1;
      report.details.push({
        outboxId,
        eventType: event.event_type,
        outcome,
        error,
      });
    };

    const templateKey = EVENT_TEMPLATE_BY_TYPE[event.event_type];
    if (!templateKey) {
      await complete("failed", `Unknown email event type ${event.event_type}.`);
      continue;
    }

    const ageHours =
      (now.getTime() - event.created_at.getTime()) / (60 * 60 * 1_000);
    if (ageHours > MAX_EVENT_AGE_HOURS) {
      await complete(
        "failed",
        `Notification is older than ${MAX_EVENT_AGE_HOURS}h and was dropped as stale.`,
      );
      continue;
    }

    if (!configState.configured) {
      // Not an attempt against SMTP; retry quietly until configuration
      // arrives or the event goes stale.
      await complete("retried", configState.reason);
      continue;
    }

    try {
      const payload = orderPayloadSchema.parse(event.payload);
      const data = await loadOrderEmailData(payload);
      const rendered = renderOrderEmail(templateKey, templates, data);
      await send(configState.env, {
        to: data.customerEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      await complete("published", null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown email failure.";
      if (error instanceof PermanentEmailError || error instanceof z.ZodError) {
        await complete("failed", message);
      } else if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        await complete(
          "failed",
          `Gave up after ${attempts} attempts: ${message}`,
        );
      } else {
        await complete("retried", message);
      }
    }
  }

  return report;
}
