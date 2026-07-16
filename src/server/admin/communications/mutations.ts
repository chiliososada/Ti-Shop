import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import { eligibleCommunicationAssigneeWhere } from "@/server/admin/communications/assignee-policy";
import {
  canTransitionInquiry,
  inquiryLifecycleTimestampPatch,
} from "@/server/admin/communications/lifecycle";
import {
  buildWhatsAppFollowUpSubject,
  WHATSAPP_FOLLOW_UP_NOTICE,
} from "@/server/admin/communications/summaries";
import type {
  AddInquiryNoteInput,
  AssignInquiryInput,
  CreateWhatsAppFollowUpInput,
  UpdateInquiryStatusInput,
} from "@/server/admin/communications/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 10_000,
} as const;

const inquiryAuditSelect = {
  publicId: true,
  inquiryNumber: true,
  source: true,
  status: true,
  assignedToUserId: true,
  resolvedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function lockInquiry(
  tx: Prisma.TransactionClient,
  inquiryPublicId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT inquiry."id"
    FROM "app"."inquiries" AS inquiry
    WHERE inquiry."public_id" = ${inquiryPublicId}::uuid
    FOR UPDATE
  `;
  return rows[0]?.id ?? null;
}

async function lockWhatsAppIntent(
  tx: Prisma.TransactionClient,
  intentPublicId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT intent."id"
    FROM "app"."whatsapp_contact_intents" AS intent
    WHERE intent."public_id" = ${intentPublicId}::uuid
    FOR UPDATE
  `;
  return rows[0]?.id ?? null;
}

function isExpectedVersion(actual: Date, expected: Date) {
  return actual.getTime() === expected.getTime();
}

function nextMutationTime(currentUpdatedAt: Date) {
  return new Date(Math.max(Date.now(), currentUpdatedAt.getTime() + 1));
}

function makeInquiryNumber(now = new Date()) {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `INQ-${day}-${suffix}`;
}

export async function updateAdminInquiryStatus(
  input: UpdateInquiryStatusInput,
) {
  const returnTo = `/admin/communications/${input.inquiryPublicId}`;
  const authorization = await requirePermission(
    "communications.manage",
    returnTo,
  );

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const inquiryId = await lockInquiry(tx, input.inquiryPublicId);
      if (inquiryId === null) {
        return { ok: false as const, reason: "not_found" as const };
      }
      const existing = await tx.inquiry.findUniqueOrThrow({
        where: { id: inquiryId },
        select: inquiryAuditSelect,
      });
      if (!isExpectedVersion(existing.updatedAt, input.expectedUpdatedAt)) {
        return { ok: false as const, reason: "conflict" as const };
      }
      if (existing.status === input.status) {
        return {
          ok: true as const,
          unchanged: true as const,
          inquiryPublicId: existing.publicId,
          inquiryNumber: existing.inquiryNumber,
          status: existing.status,
        };
      }
      if (!canTransitionInquiry(existing.status, input.status)) {
        return { ok: false as const, reason: "invalid_transition" as const };
      }

      // The column has millisecond precision. Advance it explicitly so two
      // serialized writes in the same clock millisecond still produce a new
      // optimistic-concurrency token.
      const now = nextMutationTime(existing.updatedAt);
      const after = await tx.inquiry.update({
        where: { id: inquiryId },
        data: {
          status: input.status,
          updatedAt: now,
          ...inquiryLifecycleTimestampPatch(existing, input.status, now),
        },
        select: inquiryAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "communications.inquiry.status_update",
        resourceType: "inquiry",
        resourceId: existing.publicId,
        before: existing,
        after,
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "inquiry",
          aggregateId: existing.publicId,
          eventType: "inquiry.status_updated",
          payload: {
            inquiryPublicId: existing.publicId,
            inquiryNumber: existing.inquiryNumber,
            statusBefore: existing.status,
            statusAfter: after.status,
            changedByUserId: authorization.session.user.id,
          },
        },
        select: { id: true },
      });

      return {
        ok: true as const,
        unchanged: false as const,
        inquiryPublicId: after.publicId,
        inquiryNumber: after.inquiryNumber,
        status: after.status,
      };
    }, TRANSACTION_OPTIONS),
  );
}

export async function assignAdminInquiry(input: AssignInquiryInput) {
  const returnTo = `/admin/communications/${input.inquiryPublicId}`;
  const authorization = await requirePermission(
    "communications.manage",
    returnTo,
  );

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const inquiryId = await lockInquiry(tx, input.inquiryPublicId);
      if (inquiryId === null) {
        return { ok: false as const, reason: "not_found" as const };
      }
      const existing = await tx.inquiry.findUniqueOrThrow({
        where: { id: inquiryId },
        select: inquiryAuditSelect,
      });
      if (!isExpectedVersion(existing.updatedAt, input.expectedUpdatedAt)) {
        return { ok: false as const, reason: "conflict" as const };
      }

      let assignee: { id: string; name: string } | null = null;
      if (input.assignedToUserId !== null) {
        assignee = await tx.user.findFirst({
          where: {
            id: input.assignedToUserId,
            ...eligibleCommunicationAssigneeWhere,
          },
          select: { id: true, name: true },
        });
        if (!assignee) {
          return { ok: false as const, reason: "ineligible_admin" as const };
        }
      }

      if (existing.assignedToUserId === input.assignedToUserId) {
        return {
          ok: true as const,
          unchanged: true as const,
          inquiryPublicId: existing.publicId,
          inquiryNumber: existing.inquiryNumber,
          assigneeName: assignee?.name ?? null,
        };
      }

      const after = await tx.inquiry.update({
        where: { id: inquiryId },
        data: {
          assignedToUserId: input.assignedToUserId,
          updatedAt: nextMutationTime(existing.updatedAt),
        },
        select: inquiryAuditSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "communications.inquiry.assignment_update",
        resourceType: "inquiry",
        resourceId: existing.publicId,
        before: existing,
        after,
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "inquiry",
          aggregateId: existing.publicId,
          eventType: "inquiry.assignment_updated",
          payload: {
            inquiryPublicId: existing.publicId,
            inquiryNumber: existing.inquiryNumber,
            assignedToUserId: input.assignedToUserId,
            changedByUserId: authorization.session.user.id,
          },
        },
        select: { id: true },
      });

      return {
        ok: true as const,
        unchanged: false as const,
        inquiryPublicId: after.publicId,
        inquiryNumber: after.inquiryNumber,
        assigneeName: assignee?.name ?? null,
      };
    }, TRANSACTION_OPTIONS),
  );
}

export async function addAdminInquiryNote(input: AddInquiryNoteInput) {
  const returnTo = `/admin/communications/${input.inquiryPublicId}`;
  const authorization = await requirePermission(
    "communications.manage",
    returnTo,
  );

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const inquiryId = await lockInquiry(tx, input.inquiryPublicId);
      if (inquiryId === null) {
        return { ok: false as const, reason: "not_found" as const };
      }
      const inquiry = await tx.inquiry.findUniqueOrThrow({
        where: { id: inquiryId },
        select: { publicId: true, inquiryNumber: true },
      });
      const note = await tx.internalNote.create({
        data: {
          authorUserId: authorization.session.user.id,
          inquiryId,
          body: input.body,
          isPinned: false,
        },
        select: { publicId: true, createdAt: true },
      });

      const auditSnapshot = {
        publicId: note.publicId,
        inquiryPublicId: inquiry.publicId,
        authorUserId: authorization.session.user.id,
        bodyLength: input.body.length,
        isPinned: false,
        createdAt: note.createdAt,
      };
      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "communications.inquiry.internal_note_add",
        resourceType: "internal_note",
        resourceId: note.publicId,
        before: null,
        after: auditSnapshot,
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "inquiry",
          aggregateId: inquiry.publicId,
          eventType: "inquiry.internal_note_added",
          payload: {
            inquiryPublicId: inquiry.publicId,
            inquiryNumber: inquiry.inquiryNumber,
            notePublicId: note.publicId,
            authorUserId: authorization.session.user.id,
            bodyLength: input.body.length,
          },
        },
        select: { id: true },
      });

      return {
        ok: true as const,
        inquiryPublicId: inquiry.publicId,
        inquiryNumber: inquiry.inquiryNumber,
        notePublicId: note.publicId,
      };
    }, TRANSACTION_OPTIONS),
  );
}

export async function createAdminInquiryFromWhatsAppIntent(
  input: CreateWhatsAppFollowUpInput,
) {
  const authorization = await requirePermission(
    "communications.manage",
    "/admin/communications",
  );

  return withSerializableRetry(() =>
    getDb().$transaction(async (tx) => {
      const intentId = await lockWhatsAppIntent(tx, input.intentPublicId);
      if (intentId === null) {
        return { ok: false as const, reason: "not_found" as const };
      }
      const intent = await tx.whatsAppContactIntent.findUniqueOrThrow({
        where: { id: intentId },
        select: {
          id: true,
          publicId: true,
          userId: true,
          orderId: true,
          productId: true,
          inquiryId: true,
        },
      });
      if (intent.inquiryId !== null) {
        const existingInquiry = await tx.inquiry.findUniqueOrThrow({
          where: { id: intent.inquiryId },
          select: { publicId: true, inquiryNumber: true },
        });
        return {
          ok: true as const,
          duplicate: true as const,
          inquiryPublicId: existingInquiry.publicId,
          inquiryNumber: existingInquiry.inquiryNumber,
        };
      }

      // Keep transaction-client access sequential. Besides making lock order
      // explicit, this avoids concurrent pg queries on one transaction client.
      const user = intent.userId
        ? await tx.user.findUnique({
            where: { id: intent.userId },
            select: { id: true, name: true, email: true },
          })
        : null;
      const order = intent.orderId
        ? await tx.order.findUnique({
            where: { id: intent.orderId },
            select: {
              userId: true,
              customerEmail: true,
              customerPhone: true,
              orderNumber: true,
            },
          })
        : null;
      const product = intent.productId
        ? await tx.product.findUnique({
            where: { id: intent.productId },
            select: { title: true },
          })
        : null;

      const customerUserId = user?.id ?? order?.userId ?? null;
      const customerName = user?.name ?? null;
      const customerEmail =
        user?.email.trim() || order?.customerEmail.trim() || null;
      const customerPhone = order?.customerPhone?.trim() || null;
      if (!customerUserId && !customerEmail && !customerPhone) {
        return { ok: false as const, reason: "missing_contact" as const };
      }

      const now = new Date();
      const inquiry = await tx.inquiry.create({
        data: {
          inquiryNumber: makeInquiryNumber(now),
          customerUserId,
          orderId: intent.orderId,
          productId: intent.productId,
          source: "WHATSAPP",
          status: "OPEN",
          customerName,
          customerEmail,
          customerPhone,
          subject: buildWhatsAppFollowUpSubject({
            orderNumber: order?.orderNumber ?? null,
            productTitle: product?.title ?? null,
          }),
          message: WHATSAPP_FOLLOW_UP_NOTICE,
        },
        select: {
          id: true,
          ...inquiryAuditSelect,
        },
      });
      await tx.whatsAppContactIntent.update({
        where: { id: intent.id },
        data: { inquiryId: inquiry.id },
        select: { id: true },
      });

      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "communications.whatsapp_follow_up.create",
        resourceType: "inquiry",
        resourceId: inquiry.publicId,
        before: {
          intentPublicId: intent.publicId,
          linkedInquiryPublicId: null,
        },
        after: {
          ...inquiry,
          intentPublicId: intent.publicId,
          hasCustomerAccount: customerUserId !== null,
          hasOrder: intent.orderId !== null,
          hasProduct: intent.productId !== null,
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "inquiry",
          aggregateId: inquiry.publicId,
          eventType: "inquiry.whatsapp_follow_up_created",
          payload: {
            inquiryPublicId: inquiry.publicId,
            inquiryNumber: inquiry.inquiryNumber,
            intentPublicId: intent.publicId,
            source: "WHATSAPP",
            createdByUserId: authorization.session.user.id,
            storesWhatsAppConversation: false,
          },
        },
        select: { id: true },
      });

      return {
        ok: true as const,
        duplicate: false as const,
        inquiryPublicId: inquiry.publicId,
        inquiryNumber: inquiry.inquiryNumber,
      };
    }, TRANSACTION_OPTIONS),
  );
}
