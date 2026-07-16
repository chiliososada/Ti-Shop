import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  buildWhatsAppDestinationUrl,
  isTrustedWhatsAppUrl,
} from "@/lib/whatsapp";
import {
  addMinorAmounts,
  formatUsdMinor,
  multiplyMinorAmount,
} from "@/domain/money";
import { getDb } from "@/server/db/client";
import { buildCurrentUsdPriceWhere } from "@/server/catalog/query-contracts";
import {
  parseOperationalWhatsAppConfig,
  WHATSAPP_SETTING_KEY,
} from "@/server/whatsapp/config";
import type { WhatsAppIntentInput } from "@/server/whatsapp/input";
import {
  normalizeWhatsAppMessageValue,
  normalizeWhatsAppSingleLine,
  renderWhatsAppTemplate,
} from "@/server/whatsapp/templates";

export class WhatsAppIntentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WhatsAppIntentError";
  }
}

type PreparedContext = {
  message: string;
  contextSnapshot: Prisma.InputJsonObject;
  orderId?: bigint;
  productId?: bigint;
};

function unavailable() {
  return new WhatsAppIntentError(
    "WHATSAPP_UNAVAILABLE",
    "WhatsApp contact is not currently configured.",
    503,
  );
}

function missingContext() {
  return new WhatsAppIntentError(
    "CONTACT_CONTEXT_UNAVAILABLE",
    "The requested contact context is unavailable. Refresh and try again.",
    409,
  );
}

function safeOptional(value: string | null | undefined, fallback: string) {
  const normalized = value ? normalizeWhatsAppSingleLine(value) : "";
  return normalized || fallback;
}

async function prepareContext(
  tx: Prisma.TransactionClient,
  input: WhatsAppIntentInput,
  userId: string | null,
  siteOrigin: string,
  config: NonNullable<ReturnType<typeof parseOperationalWhatsAppConfig>>,
): Promise<PreparedContext> {
  const now = new Date();

  switch (input.templateKey) {
    case "global":
      return {
        message: renderWhatsAppTemplate(config, "global", {}),
        contextSnapshot: {},
      };

    case "product": {
      const product = await tx.product.findFirst({
        where: {
          slug: input.productSlug,
          status: "ACTIVE",
          deletedAt: null,
          publishedAt: { not: null, lte: now },
        },
        select: {
          id: true,
          title: true,
          slug: true,
          casNumber: true,
          variants: {
            where: {
              status: "ACTIVE",
              deletedAt: null,
              publishedAt: { not: null, lte: now },
            },
            orderBy: [{ position: "asc" }, { id: "asc" }],
            take: 1,
            select: { sku: true },
          },
        },
      });
      if (!product) throw missingContext();

      const productName = normalizeWhatsAppSingleLine(product.title);
      const productSlug = product.slug;
      const sku = safeOptional(product.variants[0]?.sku, "Not listed");
      const casNumber = safeOptional(product.casNumber, "Not listed");
      const productUrl = new URL(
        `/products/${encodeURIComponent(product.slug)}`,
        siteOrigin,
      ).toString();
      return {
        productId: product.id,
        message: renderWhatsAppTemplate(config, "product", {
          productName,
          productSlug,
          sku,
          casNumber,
          productUrl,
        }),
        contextSnapshot: {
          productName,
          productSlug,
          sku,
          casNumber,
          productUrl,
        },
      };
    }

    case "cart": {
      const variantIds = [...new Set(input.lines.map((line) => line.variantPublicId))];
      const variants = await tx.productVariant.findMany({
        where: {
          publicId: { in: variantIds },
          status: "ACTIVE",
          deletedAt: null,
          publishedAt: { not: null, lte: now },
          product: {
            status: "ACTIVE",
            deletedAt: null,
            publishedAt: { not: null, lte: now },
          },
        },
        select: {
          publicId: true,
          priceMode: true,
          prices: {
            where: buildCurrentUsdPriceWhere(now),
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { amountMinor: true, currency: true },
          },
          product: { select: { title: true, slug: true } },
        },
      });
      const variantsById = new Map(
        variants.map((variant) => [variant.publicId, variant]),
      );
      const safeLines = input.lines.map((line) => {
        const variant = variantsById.get(line.variantPublicId);
        if (!variant || variant.product.slug !== line.productSlug) {
          throw missingContext();
        }
        const price = variant.prices[0];
        if (
          variant.priceMode !== "FIXED" ||
          !price ||
          price.currency !== "USD"
        ) {
          throw missingContext();
        }
        return {
          productName: normalizeWhatsAppSingleLine(variant.product.title),
          productSlug: variant.product.slug,
          quantity: line.quantity,
          lineTotalMinor: multiplyMinorAmount(price.amountMinor, line.quantity),
        };
      });
      const cartLines = safeLines
        .map(
          (line) =>
            `${line.quantity} × ${line.productName} (${line.productSlug})`,
        )
        .join("\n");
      const displayedSubtotal = formatUsdMinor(
        addMinorAmounts(safeLines.map((line) => line.lineTotalMinor)),
      );
      return {
        message: renderWhatsAppTemplate(config, "cart", {
          cartLines,
          displayedSubtotal,
        }),
        contextSnapshot: {
          lines: safeLines.map((line) => ({
            productName: line.productName,
            productSlug: line.productSlug,
            quantity: line.quantity,
          })),
          displayedSubtotal,
          currency: "USD",
        },
      };
    }

    case "order": {
      if (!userId) {
        throw new WhatsAppIntentError(
          "AUTH_REQUIRED",
          "Sign in to prepare an order support message.",
          401,
        );
      }
      const order = await tx.order.findFirst({
        where: { publicId: input.orderPublicId, userId },
        select: { id: true, orderNumber: true },
      });
      if (!order) throw missingContext();
      const orderReference = normalizeWhatsAppSingleLine(order.orderNumber);
      return {
        orderId: order.id,
        message: renderWhatsAppTemplate(config, "order", { orderReference }),
        contextSnapshot: { orderReference },
      };
    }

    case "contact": {
      const category = normalizeWhatsAppSingleLine(input.category);
      const requirement = normalizeWhatsAppMessageValue(input.requirement);
      if (!category || !requirement) throw missingContext();
      return {
        message: renderWhatsAppTemplate(config, "contact", {
          category,
          requirement,
        }),
        // The free-form requirement is used transiently to prepare the handoff,
        // but is deliberately not copied into the analytics snapshot.
        contextSnapshot: {
          category,
          requirementLength: requirement.length,
        },
      };
    }
  }
}

export async function createWhatsAppContactIntent({
  input,
  userId,
  siteOrigin,
}: {
  input: WhatsAppIntentInput;
  userId: string | null;
  siteOrigin: string;
}) {
  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(siteOrigin).origin;
  } catch {
    throw unavailable();
  }

  return getDb().$transaction(
    async (tx) => {
      const setting = await tx.siteSetting.findUnique({
        where: { key: WHATSAPP_SETTING_KEY },
        select: { value: true },
      });
      const config = parseOperationalWhatsAppConfig(setting?.value);
      if (!config) throw unavailable();

      const prepared = await prepareContext(
        tx,
        input,
        userId,
        normalizedOrigin,
        config,
      );
      const destinationUrl = buildWhatsAppDestinationUrl(
        config.phoneE164,
        prepared.message,
      );
      if (!isTrustedWhatsAppUrl(destinationUrl)) throw unavailable();

      // This is when the server issues a trusted handoff URL. A browser can
      // still block the client-side popup, so it is not proof of opening or
      // message delivery.
      const handoffPreparedAt = new Date();
      const intent = await tx.whatsAppContactIntent.create({
        data: {
          userId,
          orderId: prepared.orderId,
          productId: prepared.productId,
          sourcePath: input.sourcePath,
          messageTemplateKey: input.templateKey,
          // Do not persist the rendered message: contact requirements can
          // contain information that is unnecessary for click analytics.
          prefilledMessage: null,
          contextSnapshot: prepared.contextSnapshot,
          openedAt: handoffPreparedAt,
        },
        select: { publicId: true },
      });

      return {
        intentPublicId: intent.publicId,
        destinationUrl,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
