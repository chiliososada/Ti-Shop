import "server-only";

import { createHash } from "node:crypto";

import {
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from "@/generated/prisma/client";
import { getAuthRuntimeEnv } from "@/server/config/runtime-env";
import { getDb } from "@/server/db/client";
import { parseConfiguredCheckoutCharges } from "@/server/orders/charges";
import { isPaymentMethodOperational } from "@/server/payments/method-config";
import {
  createNowPaymentsClient,
  isTrustedNowPaymentsCheckoutUrl,
  NowPaymentsApiError,
  type NowPaymentsClient,
  type NowPaymentsInvoice,
} from "@/server/payments/nowpayments/client";
import { usdDecimalToMinor } from "@/server/payments/nowpayments/decimal";
import { getNowPaymentsRuntimeConfig } from "@/server/payments/nowpayments/runtime-config";

export type NowPaymentsInitializationErrorCode =
  | "NOWPAYMENTS_UNAVAILABLE"
  | "PAYMENT_NOT_FOUND"
  | "PAYMENT_METHOD_UNAVAILABLE"
  | "PAYMENT_NOT_INITIALIZABLE"
  | "PAYMENT_INITIALIZATION_IN_PROGRESS"
  | "PAYMENT_PROVIDER_REJECTED"
  | "PAYMENT_PROVIDER_UNCERTAIN";

export class NowPaymentsInitializationError extends Error {
  constructor(
    readonly code: NowPaymentsInitializationErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "NowPaymentsInitializationError";
  }
}

class ProviderInvoiceIntegrityError extends Error {
  constructor() {
    super("NOWPayments returned invoice details that do not match the order.");
    this.name = "ProviderInvoiceIntegrityError";
  }
}

type ClaimedPayment = {
  paymentId: bigint;
  paymentPublicId: string;
  amountMinor: bigint;
  currency: string;
  metadata: Prisma.JsonValue | null;
  orderPublicId: string;
  orderNumber: string;
};

type RejectedClaim = {
  kind: "rejected";
  error: NowPaymentsInitializationError;
};

export type InitializedNowPaymentsInvoice = {
  created: boolean;
  paymentPublicId: string;
  orderPublicId: string;
  checkoutUrl: string;
  mode: "mock" | "sandbox" | "production";
};

function metadataObject(value: Prisma.JsonValue | null) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Prisma.JsonObject) } as Prisma.InputJsonObject;
  }
  return {} as Prisma.InputJsonObject;
}

function invoiceEventId(providerInvoiceId: string) {
  return `nowpayments:invoice:${createHash("sha256")
    .update(providerInvoiceId)
    .digest("hex")}`;
}

function initializationEventId(
  paymentPublicId: string,
  initializationKey: string,
  outcome: "rejected" | "uncertain",
) {
  return `nowpayments:init:${createHash("sha256")
    .update(`${paymentPublicId}:${initializationKey}:${outcome}`)
    .digest("hex")}`;
}

function claimReviewEventId(paymentPublicId: string, reason: string) {
  return `nowpayments:claim-review:${createHash("sha256")
    .update(`${paymentPublicId}:${reason}`)
    .digest("hex")}`;
}

export function isStaleNowPaymentsInitialization(
  startedAt: unknown,
  nowMs = Date.now(),
) {
  if (typeof startedAt !== "string") return true;
  const startedAtMs = Date.parse(startedAt);
  return (
    !Number.isFinite(startedAtMs) ||
    startedAtMs > nowMs + 60_000 ||
    nowMs - startedAtMs >= 15 * 60_000
  );
}

async function claimPayment(
  userId: string,
  orderPublicId: string,
  paymentPublicId: string,
  initializationKey: string,
  mode: "mock" | "sandbox" | "production",
  siteOrigin: string,
): Promise<
  | { kind: "existing"; result: InitializedNowPaymentsInvoice }
  | { kind: "claimed"; payment: ClaimedPayment }
  | RejectedClaim
> {
  const db = getDb();

  return db.$transaction(
    async (tx) => {
      const payment = await tx.payment.findFirst({
          where: {
            publicId: paymentPublicId,
            method: PaymentMethod.NOWPAYMENTS,
            order: { is: { publicId: orderPublicId, userId } },
          },
          select: {
            id: true,
            publicId: true,
            status: true,
            currency: true,
            amountMinor: true,
            providerInvoiceId: true,
            providerStatus: true,
            checkoutUrl: true,
            metadata: true,
            order: {
              select: {
                publicId: true,
                orderNumber: true,
                status: true,
                currency: true,
                totalMinor: true,
              },
            },
          },
        });
      const methodConfig = await tx.paymentMethodConfig.findUnique({
          where: { method: PaymentMethod.NOWPAYMENTS },
          select: {
            isEnabled: true,
            settingKey: true,
            setting: { select: { value: true } },
          },
        });

      if (!payment) {
        throw new NowPaymentsInitializationError(
          "PAYMENT_NOT_FOUND",
          "The NOWPayments payment was not found for this order.",
          404,
        );
      }
      if (!methodConfig || !isPaymentMethodOperational(methodConfig)) {
        throw new NowPaymentsInitializationError(
          "PAYMENT_METHOD_UNAVAILABLE",
          "NOWPayments is not currently enabled for checkout.",
          409,
        );
      }

      const paymentMetadata = metadataObject(payment.metadata);
      const rejectForReview = async (
        providerStatus: string,
        message: string,
      ): Promise<RejectedClaim> => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.REVIEW_REQUIRED,
            providerStatus,
          },
        });
        await tx.paymentEvent.createMany({
          data: [
            {
              paymentId: payment.id,
              providerEventId: claimReviewEventId(
                payment.publicId,
                providerStatus,
              ),
              eventType: `nowpayments.initialization.${providerStatus}`,
              statusBefore: payment.status,
              statusAfter: PaymentStatus.REVIEW_REQUIRED,
              amountMinor: payment.amountMinor,
              rawPayload: { reason: providerStatus, providerMode: mode },
              occurredAt: new Date(),
            },
          ],
          skipDuplicates: true,
        });
        return {
          kind: "rejected",
          error: new NowPaymentsInitializationError(
            "PAYMENT_NOT_INITIALIZABLE",
            message,
            409,
          ),
        };
      };
      const checkoutCharges = parseConfiguredCheckoutCharges(
        paymentMetadata.checkoutCharges,
      );
      if (
        payment.currency !== "USD" ||
        payment.order.currency !== "USD" ||
        payment.amountMinor !== payment.order.totalMinor ||
        !checkoutCharges
      ) {
        return rejectForReview(
          "order_payment_integrity_mismatch",
          "The order amount or checkout configuration requires administrator review.",
        );
      }

      if (payment.providerInvoiceId && payment.checkoutUrl) {
        const storedMode = paymentMetadata.providerMode;
        const resumableStatuses: readonly PaymentStatus[] = [
          PaymentStatus.PENDING,
          PaymentStatus.AWAITING_CONFIRMATION,
          PaymentStatus.PROCESSING,
          PaymentStatus.PARTIALLY_PAID,
        ];
        if (
          storedMode !== mode ||
          !resumableStatuses.includes(payment.status)
        ) {
          throw new NowPaymentsInitializationError(
            "PAYMENT_NOT_INITIALIZABLE",
            "This provider checkout can no longer be resumed.",
            409,
          );
        }
        if (
          !isTrustedNowPaymentsCheckoutUrl(
            payment.checkoutUrl,
            mode,
            siteOrigin,
          )
        ) {
          return rejectForReview(
            "stored_checkout_url_rejected",
            "The stored checkout link requires administrator review.",
          );
        }

        return {
          kind: "existing",
          result: {
            created: false,
            paymentPublicId: payment.publicId,
            orderPublicId: payment.order.publicId,
            checkoutUrl: payment.checkoutUrl,
            mode,
          },
        };
      }

      if (payment.providerInvoiceId || payment.checkoutUrl) {
        return rejectForReview(
          "incomplete_invoice_state",
          "The payment has incomplete provider state and requires review.",
        );
      }

      if (
        payment.status === PaymentStatus.PROCESSING &&
        payment.providerStatus === "invoice_creating"
      ) {
        if (
          isStaleNowPaymentsInitialization(
            paymentMetadata.nowPaymentsInitializationStartedAt,
          )
        ) {
          return rejectForReview(
            "stale_invoice_creation_unknown",
            "The provider outcome is unknown after an interrupted checkout initialization and requires review.",
          );
        }
        throw new NowPaymentsInitializationError(
          "PAYMENT_INITIALIZATION_IN_PROGRESS",
          "NOWPayments checkout initialization is already in progress.",
          409,
        );
      }
      if (
        payment.status !== PaymentStatus.CREATED ||
        payment.order.status !== "PENDING_PAYMENT"
      ) {
        throw new NowPaymentsInitializationError(
          "PAYMENT_NOT_INITIALIZABLE",
          "This payment can no longer start a new NOWPayments checkout.",
          409,
        );
      }

      const metadata = {
        ...paymentMetadata,
        providerMode: mode,
        nowPaymentsInitializationKey: initializationKey,
        nowPaymentsInitializationStartedAt: new Date().toISOString(),
      } satisfies Prisma.InputJsonObject;
      const claimed = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.CREATED,
          providerInvoiceId: null,
          checkoutUrl: null,
        },
        data: {
          status: PaymentStatus.PROCESSING,
          providerStatus: "invoice_creating",
          metadata,
        },
      });
      if (claimed.count !== 1) {
        throw new NowPaymentsInitializationError(
          "PAYMENT_INITIALIZATION_IN_PROGRESS",
          "NOWPayments checkout initialization is already in progress.",
          409,
        );
      }

      return {
        kind: "claimed",
        payment: {
          paymentId: payment.id,
          paymentPublicId: payment.publicId,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          metadata,
          orderPublicId: payment.order.publicId,
          orderNumber: payment.order.orderNumber,
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function assertMatchingInvoice(
  invoice: NowPaymentsInvoice,
  payment: ClaimedPayment,
  siteOrigin: string,
) {
  if (
    payment.currency !== "USD" ||
    invoice.priceCurrency.toUpperCase() !== payment.currency ||
    usdDecimalToMinor(invoice.priceAmount) !== payment.amountMinor ||
    !isTrustedNowPaymentsCheckoutUrl(invoice.invoiceUrl, invoice.mode, siteOrigin)
  ) {
    throw new ProviderInvoiceIntegrityError();
  }
}

async function recordInitializationFailure(
  payment: ClaimedPayment,
  initializationKey: string,
  outcome: "rejected" | "uncertain",
  invoice?: NowPaymentsInvoice,
) {
  const db = getDb();
  const nextStatus =
    outcome === "rejected"
      ? PaymentStatus.CREATED
      : PaymentStatus.REVIEW_REQUIRED;
  const providerStatus =
    outcome === "rejected" ? "invoice_rejected" : "invoice_creation_unknown";

  try {
    await db.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({
        where: {
          id: payment.paymentId,
          status: PaymentStatus.PROCESSING,
          providerStatus: "invoice_creating",
        },
        data: {
          status: nextStatus,
          providerStatus,
          ...(invoice
            ? {
                providerInvoiceId: invoice.providerInvoiceId,
                checkoutUrl: invoice.invoiceUrl,
              }
            : {}),
          metadata: {
            ...metadataObject(payment.metadata),
            providerMode: invoice?.mode,
            nowPaymentsInitializationKey: initializationKey,
            nowPaymentsInitializationOutcome: outcome,
          },
        },
      });
      if (updated.count !== 1) return;

      await tx.paymentEvent.create({
        data: {
          paymentId: payment.paymentId,
          providerEventId: initializationEventId(
            payment.paymentPublicId,
            initializationKey,
            outcome,
          ),
          eventType: `nowpayments.invoice.${outcome}`,
          statusBefore: PaymentStatus.PROCESSING,
          statusAfter: nextStatus,
          amountMinor: payment.amountMinor,
          rawPayload: invoice
            ? {
                providerInvoiceId: invoice.providerInvoiceId,
                priceAmount: invoice.priceAmount,
                priceCurrency: invoice.priceCurrency,
                mode: invoice.mode,
              }
            : { mode: "not_confirmed" },
          occurredAt: new Date(),
        },
      });
    });
  } catch (recoveryError) {
    console.error("NOWPayments initialization recovery failed.", {
      name:
        recoveryError instanceof Error
          ? recoveryError.name
          : "UnknownError",
    });
  }
}

async function storeInvoice(
  payment: ClaimedPayment,
  invoice: NowPaymentsInvoice,
  initializationKey: string,
): Promise<InitializedNowPaymentsInvoice> {
  const db = getDb();
  const now = new Date();

  await db.$transaction(
    async (tx) => {
      const updated = await tx.payment.updateMany({
        where: {
          id: payment.paymentId,
          status: PaymentStatus.PROCESSING,
          providerStatus: "invoice_creating",
          providerInvoiceId: null,
          checkoutUrl: null,
        },
        data: {
          status: PaymentStatus.PENDING,
          providerStatus: "invoice_created",
          providerInvoiceId: invoice.providerInvoiceId,
          checkoutUrl: invoice.invoiceUrl,
          metadata: {
            ...metadataObject(payment.metadata),
            providerMode: invoice.mode,
            nowPaymentsInitializationKey: initializationKey,
            nowPaymentsInitializationOutcome: "created",
          },
        },
      });
      if (updated.count !== 1) {
        throw new ProviderInvoiceIntegrityError();
      }

      await tx.paymentEvent.create({
        data: {
          paymentId: payment.paymentId,
          providerEventId: invoiceEventId(invoice.providerInvoiceId),
          eventType: "nowpayments.invoice.created",
          statusBefore: PaymentStatus.PROCESSING,
          statusAfter: PaymentStatus.PENDING,
          amountMinor: payment.amountMinor,
          rawPayload: {
            providerInvoiceId: invoice.providerInvoiceId,
            priceAmount: invoice.priceAmount,
            priceCurrency: invoice.priceCurrency,
            payCurrency: invoice.payCurrency,
            mode: invoice.mode,
          },
          occurredAt: now,
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: "payment",
          aggregateId: payment.paymentPublicId,
          eventType: "payment.checkout_initialized",
          payload: {
            paymentPublicId: payment.paymentPublicId,
            orderPublicId: payment.orderPublicId,
            method: "NOWPAYMENTS",
            mode: invoice.mode,
          },
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  return {
    created: true,
    paymentPublicId: payment.paymentPublicId,
    orderPublicId: payment.orderPublicId,
    checkoutUrl: invoice.invoiceUrl,
    mode: invoice.mode,
  };
}

export async function initializeNowPaymentsInvoice(
  {
    userId,
    orderPublicId,
    paymentPublicId,
    initializationKey,
  }: {
    userId: string;
    orderPublicId: string;
    paymentPublicId: string;
    initializationKey: string;
  },
  dependencies?: { client?: NowPaymentsClient },
): Promise<InitializedNowPaymentsInvoice> {
  let config;
  let siteOrigin: string;
  let client: NowPaymentsClient;
  try {
    config = getNowPaymentsRuntimeConfig();
    siteOrigin = getAuthRuntimeEnv().siteOrigin;
    if (config.mode === "disabled") {
      throw new Error("disabled");
    }
    client = dependencies?.client ?? createNowPaymentsClient(config);
  } catch {
    throw new NowPaymentsInitializationError(
      "NOWPAYMENTS_UNAVAILABLE",
      "NOWPayments is not configured for checkout.",
      503,
    );
  }

  const claim = await claimPayment(
    userId,
    orderPublicId,
    paymentPublicId,
    initializationKey,
    config.mode,
    siteOrigin,
  );
  if (claim.kind === "existing") return claim.result;
  if (claim.kind === "rejected") throw claim.error;

  let invoice: NowPaymentsInvoice | undefined;
  try {
    invoice = await client.createInvoice({
      orderNumber: claim.payment.orderNumber,
      amountMinor: claim.payment.amountMinor,
      description: `Research-use order ${claim.payment.orderNumber}`,
      ipnCallbackUrl: `${siteOrigin}/api/payments/nowpayments/ipn`,
      successUrl: `${siteOrigin}/checkout/success?order=${encodeURIComponent(
        claim.payment.orderPublicId,
      )}`,
      cancelUrl: `${siteOrigin}/account/orders/${encodeURIComponent(
        claim.payment.orderPublicId,
      )}?payment=cancelled`,
      partiallyPaidUrl: `${siteOrigin}/account/orders/${encodeURIComponent(
        claim.payment.orderPublicId,
      )}?payment=partially-paid`,
    });
    assertMatchingInvoice(invoice, claim.payment, siteOrigin);
    return await storeInvoice(claim.payment, invoice, initializationKey);
  } catch (error) {
    const knownProviderRejection =
      error instanceof NowPaymentsApiError &&
      error.status !== null &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429;
    const outcome = knownProviderRejection ? "rejected" : "uncertain";
    await recordInitializationFailure(
      claim.payment,
      initializationKey,
      outcome,
      invoice,
    );

    if (knownProviderRejection) {
      throw new NowPaymentsInitializationError(
        "PAYMENT_PROVIDER_REJECTED",
        "NOWPayments rejected the checkout request. No payment was confirmed.",
        502,
      );
    }
    throw new NowPaymentsInitializationError(
      "PAYMENT_PROVIDER_UNCERTAIN",
      "The provider outcome could not be verified. Do not retry this payment until it is reviewed.",
      503,
    );
  }
}
