import "server-only";

import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import { shouldClosePendingOrderAfterPaymentReview } from "@/server/admin/orders/payment-review-policy";
import type {
  NowPaymentsCancelUnlinkedInput,
  NowPaymentsLinkInput,
} from "@/server/admin/orders/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { releaseOrderInventoryReservations } from "@/server/orders/inventory";
import { withSerializableRetry } from "@/server/orders/retry";
import { createNowPaymentsClient } from "@/server/payments/nowpayments/client";
import { evaluateNowPaymentsPayload } from "@/server/payments/nowpayments/evaluate-ipn";
import { processNowPaymentsEvent } from "@/server/payments/nowpayments/process-event";
import { getNowPaymentsRuntimeConfig } from "@/server/payments/nowpayments/runtime-config";
import type { NowPaymentsPaymentPayload } from "@/server/payments/nowpayments/schemas";
import {
  aggregateOrderPaymentStatus,
  type LocalPaymentStatus,
} from "@/server/payments/nowpayments/status";

type ProviderLinkExpectation = {
  providerPaymentId: string;
  providerInvoiceId: string;
  orderNumber: string;
  currency: string;
  amountMinor: bigint;
};

export function validateNowPaymentsProviderLink(
  payload: NowPaymentsPaymentPayload,
  expected: ProviderLinkExpectation,
) {
  if (payload.payment_id !== expected.providerPaymentId) {
    return { ok: false as const, reason: "payment_id_mismatch" as const };
  }
  if (payload.invoice_id !== expected.providerInvoiceId) {
    return { ok: false as const, reason: "invoice_id_mismatch" as const };
  }

  const evaluation = evaluateNowPaymentsPayload(payload, {
    orderNumber: expected.orderNumber,
    currency: expected.currency,
    amountMinor: expected.amountMinor,
  });
  const blockingIntegrityIssues = evaluation.integrityIssues.filter(
    (issue) => issue !== "UNKNOWN_OR_REVIEW_STATUS",
  );
  if (blockingIntegrityIssues.length > 0) {
    return {
      ok: false as const,
      reason: "provider_integrity_mismatch" as const,
      integrityIssues: blockingIntegrityIssues,
    };
  }
  return { ok: true as const };
}

async function requireNowPaymentsReviewPermissions(returnTo: string) {
  const authorization = await requirePermission("payments.manage", returnTo);
  await requirePermission("orders.manage", returnTo);
  return authorization;
}

export async function linkAdminNowPaymentsProviderPayment(
  input: NowPaymentsLinkInput,
) {
  const authorization = await requireNowPaymentsReviewPermissions(
    "/admin/orders",
  );
  const db = getDb();
  const existing = await db.payment.findUnique({
    where: { publicId: input.paymentPublicId },
    select: {
      id: true,
      publicId: true,
      method: true,
      status: true,
      currency: true,
      amountMinor: true,
      providerInvoiceId: true,
      providerPaymentId: true,
      metadata: true,
      order: {
        select: {
          publicId: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
        },
      },
    },
  });
  if (!existing) return { ok: false as const, reason: "not_found" as const };
  if (existing.method !== PaymentMethod.NOWPAYMENTS) {
    return { ok: false as const, reason: "not_nowpayments" as const };
  }
  if (existing.providerPaymentId) {
    return { ok: false as const, reason: "already_linked" as const };
  }
  if (
    !existing.providerInvoiceId ||
    existing.status !== PaymentStatus.REVIEW_REQUIRED
  ) {
    return { ok: false as const, reason: "not_unlinked_review" as const };
  }

  const config = getNowPaymentsRuntimeConfig();
  if (config.mode === "disabled") {
    return { ok: false as const, reason: "provider_unavailable" as const };
  }
  const storedProviderMode =
    existing.metadata &&
    typeof existing.metadata === "object" &&
    !Array.isArray(existing.metadata) &&
    typeof (existing.metadata as Record<string, unknown>).providerMode ===
      "string"
      ? (existing.metadata as Record<string, unknown>).providerMode
      : null;
  if (storedProviderMode !== config.mode) {
    return { ok: false as const, reason: "provider_mode_mismatch" as const };
  }

  let payload: NowPaymentsPaymentPayload;
  try {
    payload = await createNowPaymentsClient(config).getPayment(
      input.providerPaymentId,
    );
  } catch {
    return { ok: false as const, reason: "provider_lookup_failed" as const };
  }

  const validation = validateNowPaymentsProviderLink(payload, {
    providerPaymentId: input.providerPaymentId,
    providerInvoiceId: existing.providerInvoiceId,
    orderNumber: existing.order.orderNumber,
    currency: existing.currency,
    amountMinor: existing.amountMinor,
  });
  if (!validation.ok) return validation;

  const processed = await processNowPaymentsEvent({
    source: "reconcile",
    payload,
    rawPayload: { ...payload },
    adminReconciliationAudit: {
      actorUserId: authorization.session.user.id,
      action: "payments.nowpayments.provider_payment_link",
      expectedPaymentPublicId: existing.publicId,
      expectedProviderMode: config.mode,
    },
  });

  return {
    ok: true as const,
    paymentPublicId: processed.paymentPublicId,
    orderPublicId: processed.orderPublicId,
    orderNumber: existing.order.orderNumber,
    paymentStatus: processed.status,
  };
}

function inputMetadata(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Prisma.InputJsonObject)
    : {};
}

export async function cancelAdminUnlinkedNowPaymentsPayment(
  input: NowPaymentsCancelUnlinkedInput,
) {
  const authorization = await requireNowPaymentsReviewPermissions(
    "/admin/orders",
  );

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const existing = await tx.payment.findUnique({
          where: { publicId: input.paymentPublicId },
          select: {
            id: true,
            publicId: true,
            method: true,
            status: true,
            currency: true,
            amountMinor: true,
            providerInvoiceId: true,
            providerPaymentId: true,
            providerStatus: true,
            metadata: true,
            order: {
              select: {
                id: true,
                publicId: true,
                orderNumber: true,
                status: true,
                paymentStatus: true,
                canceledAt: true,
                cancellationReason: true,
              },
            },
          },
        });
        if (!existing) {
          return { ok: false as const, reason: "not_found" as const };
        }
        if (existing.method !== PaymentMethod.NOWPAYMENTS) {
          return { ok: false as const, reason: "not_nowpayments" as const };
        }
        if (existing.providerPaymentId) {
          return { ok: false as const, reason: "already_linked" as const };
        }
        if (existing.providerInvoiceId !== input.providerInvoiceId) {
          return { ok: false as const, reason: "invoice_mismatch" as const };
        }
        if (existing.status !== PaymentStatus.REVIEW_REQUIRED) {
          return { ok: false as const, reason: "not_unlinked_review" as const };
        }
        if (existing.order.status !== OrderStatus.PENDING_PAYMENT) {
          return { ok: false as const, reason: "order_not_payable" as const };
        }

        const now = new Date();
        const claimed = await tx.payment.updateMany({
          where: {
            id: existing.id,
            method: PaymentMethod.NOWPAYMENTS,
            status: PaymentStatus.REVIEW_REQUIRED,
            providerInvoiceId: input.providerInvoiceId,
            providerPaymentId: null,
          },
          data: {
            status: PaymentStatus.CANCELED,
            providerStatus: "manually_verified_unpaid",
            canceledAt: now,
            metadata: {
              ...inputMetadata(existing.metadata),
              reconciliationResolution: "PROVIDER_DASHBOARD_VERIFIED_UNPAID",
              reconciliationResolvedAt: now.toISOString(),
              reconciliationResolvedByUserId:
                authorization.session.user.id,
            },
          },
        });
        if (claimed.count !== 1) {
          return { ok: false as const, reason: "conflict" as const };
        }

        const afterPayment = await tx.payment.findUniqueOrThrow({
          where: { id: existing.id },
          select: {
            publicId: true,
            method: true,
            status: true,
            currency: true,
            amountMinor: true,
            providerInvoiceId: true,
            providerPaymentId: true,
            providerStatus: true,
            metadata: true,
            canceledAt: true,
          },
        });
        await tx.paymentEvent.create({
          data: {
            paymentId: existing.id,
            eventType: "admin.nowpayments.unlinked_invoice_canceled",
            statusBefore: existing.status,
            statusAfter: afterPayment.status,
            amountMinor: existing.amountMinor,
            rawPayload: {
              providerInvoiceId: input.providerInvoiceId,
              resolution: "PROVIDER_DASHBOARD_VERIFIED_UNPAID",
            },
            occurredAt: now,
          },
        });

        const attempts = await tx.payment.findMany({
          where: { orderId: existing.order.id },
          select: { status: true },
        });
        const nextOrderPaymentStatus = aggregateOrderPaymentStatus(
          attempts.map(({ status }) => status as LocalPaymentStatus),
        );
        const shouldCloseOrder = shouldClosePendingOrderAfterPaymentReview(
          existing.order.status,
          nextOrderPaymentStatus,
        );
        const inventoryRelease = shouldCloseOrder
          ? await releaseOrderInventoryReservations(
              tx,
              existing.order.id,
              now,
            )
          : { reservations: 0, quantity: 0 };
        const afterOrder = await tx.order.update({
          where: { id: existing.order.id },
          data: {
            paymentStatus: nextOrderPaymentStatus,
            ...(shouldCloseOrder
              ? {
                  status: OrderStatus.CANCELED,
                  canceledAt: now,
                  cancellationReason:
                    "The NOWPayments invoice was verified in the provider dashboard as having no payment.",
                }
              : {}),
          },
          select: {
            publicId: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            canceledAt: true,
            cancellationReason: true,
          },
        });

        await writeAdminAuditLog(tx, {
          actorUserId: authorization.session.user.id,
          action: "payments.nowpayments.unlinked_invoice_cancel",
          resourceType: "payment",
          resourceId: existing.publicId,
          before: { payment: existing, order: existing.order },
          after: { payment: afterPayment, order: afterOrder },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "payment",
            aggregateId: existing.publicId,
            eventType: "payment.nowpayments_unlinked_invoice_canceled",
            payload: {
              paymentPublicId: existing.publicId,
              orderPublicId: existing.order.publicId,
              providerInvoiceId: input.providerInvoiceId,
              orderStatus: afterOrder.status,
              orderPaymentStatus: afterOrder.paymentStatus,
              inventoryReservationsReleased: inventoryRelease.reservations,
              inventoryQuantityReleased: inventoryRelease.quantity,
            },
          },
        });

        return {
          ok: true as const,
          paymentPublicId: existing.publicId,
          orderPublicId: existing.order.publicId,
          orderNumber: existing.order.orderNumber,
          orderClosed: shouldCloseOrder,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    ),
  );
}
