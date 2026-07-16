import "server-only";

import {
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import {
  createNowPaymentsClient,
  type NowPaymentsClient,
} from "@/server/payments/nowpayments/client";
import type { NowPaymentsRuntimeConfig } from "@/server/payments/nowpayments/config";
import { processNowPaymentsEvent } from "@/server/payments/nowpayments/process-event";
import { getNowPaymentsRuntimeConfig } from "@/server/payments/nowpayments/runtime-config";

const reconcilableStatuses = [
  PaymentStatus.PENDING,
  PaymentStatus.AWAITING_CONFIRMATION,
  PaymentStatus.PROCESSING,
  PaymentStatus.PARTIALLY_PAID,
  PaymentStatus.REVIEW_REQUIRED,
] as const;

export type NowPaymentsReconciliationReport = {
  selected: number;
  processed: number;
  duplicates: number;
  unresolvedInvoices: number;
  newReviewHolds: number;
  unresolved: Array<{
    paymentPublicId: string;
    orderPublicId: string;
    providerInvoiceId: string;
    newReviewHold: boolean;
  }>;
  failed: number;
  failures: Array<{
    paymentPublicId: string;
    errorName: string;
  }>;
};

export async function reconcileNowPaymentsPayments(
  {
    batchSize = 50,
    olderThanMinutes = 5,
    unlinkedInvoiceOlderThanMinutes = 60,
    now = new Date(),
  }: {
    batchSize?: number;
    olderThanMinutes?: number;
    unlinkedInvoiceOlderThanMinutes?: number;
    now?: Date;
  } = {},
  dependencies?: {
    client?: NowPaymentsClient;
    config?: NowPaymentsRuntimeConfig;
  },
): Promise<NowPaymentsReconciliationReport> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("batchSize must be an integer from 1 through 100.");
  }
  if (
    !Number.isInteger(olderThanMinutes) ||
    olderThanMinutes < 1 ||
    olderThanMinutes > 24 * 60
  ) {
    throw new Error(
      "olderThanMinutes must be an integer from 1 through 1440.",
    );
  }
  if (
    !Number.isInteger(unlinkedInvoiceOlderThanMinutes) ||
    unlinkedInvoiceOlderThanMinutes < 1 ||
    unlinkedInvoiceOlderThanMinutes > 7 * 24 * 60
  ) {
    throw new Error(
      "unlinkedInvoiceOlderThanMinutes must be an integer from 1 through 10080.",
    );
  }

  const config = dependencies?.config ?? getNowPaymentsRuntimeConfig();
  if (config.mode === "disabled") {
    throw new Error("NOWPayments reconciliation is disabled.");
  }
  const client = dependencies?.client ?? createNowPaymentsClient(config);
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000);
  const unlinkedInvoiceCutoff = new Date(
    now.getTime() - unlinkedInvoiceOlderThanMinutes * 60_000,
  );
  const db = getDb();
  const unlinkedInvoices = await db.payment.findMany({
    where: {
      method: PaymentMethod.NOWPAYMENTS,
      status: { in: [...reconcilableStatuses] },
      providerInvoiceId: { not: null },
      providerPaymentId: null,
      createdAt: { lt: unlinkedInvoiceCutoff },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: {
      id: true,
      publicId: true,
      status: true,
      amountMinor: true,
      providerInvoiceId: true,
      metadata: true,
      order: { select: { publicId: true } },
    },
  });
  const rows = await db.payment.findMany({
    where: {
      method: PaymentMethod.NOWPAYMENTS,
      status: { in: [...reconcilableStatuses] },
      providerPaymentId: { not: null },
      updatedAt: { lt: cutoff },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { publicId: true, providerPaymentId: true },
  });

  const report: NowPaymentsReconciliationReport = {
    selected: unlinkedInvoices.length + rows.length,
    processed: 0,
    duplicates: 0,
    unresolvedInvoices: 0,
    newReviewHolds: 0,
    unresolved: [],
    failed: 0,
    failures: [],
  };

  for (const row of unlinkedInvoices) {
    if (!row.providerInvoiceId) continue;
    try {
      const result = await db.$transaction(async (tx) => {
        const updated = await tx.payment.updateMany({
          where: {
            id: row.id,
            method: PaymentMethod.NOWPAYMENTS,
            status: { in: [...reconcilableStatuses] },
            providerInvoiceId: row.providerInvoiceId,
            providerPaymentId: null,
          },
          data: {
            status: PaymentStatus.REVIEW_REQUIRED,
            metadata: {
              ...(row.metadata &&
              typeof row.metadata === "object" &&
              !Array.isArray(row.metadata)
                ? (row.metadata as Prisma.InputJsonObject)
                : {}),
              reconciliationIssue: "PROVIDER_PAYMENT_ID_MISSING",
              reconciliationIssueDetectedAt: now.toISOString(),
            },
          },
        });
        if (updated.count !== 1) return { unresolved: false, held: false };

        const held = row.status !== PaymentStatus.REVIEW_REQUIRED;
        if (held) {
          const providerEventId = `nowpayments:invoice-unlinked:${row.publicId}`;
          await tx.paymentEvent.upsert({
            where: { providerEventId },
            update: {},
            create: {
              paymentId: row.id,
              providerEventId,
              eventType: "nowpayments.reconcile.provider_payment_id_missing",
              statusBefore: row.status,
              statusAfter: PaymentStatus.REVIEW_REQUIRED,
              amountMinor: row.amountMinor,
              rawPayload: {
                providerInvoiceId: row.providerInvoiceId,
                issue: "PROVIDER_PAYMENT_ID_MISSING",
              },
              occurredAt: now,
            },
          });
          await tx.outboxEvent.create({
            data: {
              aggregateType: "payment",
              aggregateId: row.publicId,
              eventType: "payment.provider_payment_id_missing",
              payload: {
                paymentPublicId: row.publicId,
                orderPublicId: row.order.publicId,
                providerInvoiceId: row.providerInvoiceId,
                requiresManualProviderReview: true,
              },
            },
          });
        }
        return { unresolved: true, held };
      });
      if (result.unresolved) {
        report.unresolvedInvoices += 1;
        report.unresolved.push({
          paymentPublicId: row.publicId,
          orderPublicId: row.order.publicId,
          providerInvoiceId: row.providerInvoiceId,
          newReviewHold: result.held,
        });
      }
      if (result.held) report.newReviewHolds += 1;
    } catch (error) {
      report.failed += 1;
      report.failures.push({
        paymentPublicId: row.publicId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  for (const row of rows) {
    if (!row.providerPaymentId) continue;
    try {
      const payload = await client.getPayment(row.providerPaymentId);
      if (payload.payment_id !== row.providerPaymentId) {
        throw new Error("ProviderPaymentIdMismatch");
      }
      const result = await processNowPaymentsEvent({
        source: "reconcile",
        payload,
        rawPayload: { ...payload },
      });
      if (result.duplicate) report.duplicates += 1;
      else report.processed += 1;
    } catch (error) {
      report.failed += 1;
      report.failures.push({
        paymentPublicId: row.publicId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  return report;
}
