import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set([
      "communications.read",
      "communications.manage",
    ]),
  })),
}));

import {
  addAdminInquiryNote,
  assignAdminInquiry,
  createAdminInquiryFromWhatsAppIntent,
  updateAdminInquiryStatus,
} from "@/server/admin/communications/mutations";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("communication admin database invariants", () => {
  const suffix = randomUUID();
  let actorUserId = "";
  let activeAssigneeUserId = "";
  let inactiveAssigneeUserId = "";
  let customerUserId = "";
  let intentPublicId = "";
  let anonymousIntentPublicId = "";
  let inquiryPublicId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const [actor, activeAssignee, inactiveAssignee, customer] =
      await Promise.all([
        db.user.create({
          data: {
            name: "Communication integration admin",
            email: `communications-admin-${suffix}@example.invalid`,
          },
          select: { id: true },
        }),
        db.user.create({
          data: {
            name: "Active communication assignee",
            email: `communications-active-${suffix}@example.invalid`,
            emailVerified: true,
          },
          select: { id: true },
        }),
        db.user.create({
          data: {
            name: "Inactive communication assignee",
            email: `communications-inactive-${suffix}@example.invalid`,
            emailVerified: true,
          },
          select: { id: true },
        }),
        db.user.create({
          data: {
            name: "Communication test customer",
            email: `communications-customer-${suffix}@example.invalid`,
          },
          select: { id: true },
        }),
      ]);

    actorUserId = actor.id;
    activeAssigneeUserId = activeAssignee.id;
    inactiveAssigneeUserId = inactiveAssignee.id;
    customerUserId = customer.id;
    authorization.actorUserId = actor.id;

    await db.adminProfile.createMany({
      data: [
        { userId: actor.id, jobTitle: "Integration test", isActive: true },
        {
          userId: activeAssignee.id,
          jobTitle: "Integration test assignee",
          isActive: true,
        },
        {
          userId: inactiveAssignee.id,
          jobTitle: "Inactive integration test assignee",
          isActive: false,
        },
      ],
    });
    const communicationRole = await db.role.findUniqueOrThrow({
      where: { slug: "customer_support" },
      select: { id: true },
    });
    await db.userRole.createMany({
      data: [
        {
          userId: activeAssignee.id,
          roleId: communicationRole.id,
          assignedByUserId: actor.id,
        },
        {
          userId: inactiveAssignee.id,
          roleId: communicationRole.id,
          assignedByUserId: actor.id,
        },
      ],
    });
    const intent = await db.whatsAppContactIntent.create({
      data: {
        userId: customer.id,
        sourcePath: "/contact?private=value",
        messageTemplateKey: "contact",
        prefilledMessage: null,
        contextSnapshot: { category: "general", requirementLength: 42 },
        openedAt: new Date(),
      },
      select: { publicId: true },
    });
    intentPublicId = intent.publicId;
    const anonymousIntent = await db.whatsAppContactIntent.create({
      data: {
        sourcePath: "/products/example",
        messageTemplateKey: "product",
        prefilledMessage: null,
        contextSnapshot: { productName: "Redacted integration product" },
        openedAt: new Date(),
      },
      select: { publicId: true },
    });
    anonymousIntentPublicId = anonymousIntent.publicId;
  });

  afterAll(async () => {
    if (!actorUserId) return;
    const db = getDb();
    if (intentPublicId || anonymousIntentPublicId) {
      await db.whatsAppContactIntent.deleteMany({
        where: {
          publicId: {
            in: [intentPublicId, anonymousIntentPublicId].filter(Boolean),
          },
        },
      });
    }
    if (inquiryPublicId) {
      await db.inquiry.deleteMany({ where: { publicId: inquiryPublicId } });
      await db.outboxEvent.deleteMany({
        where: { aggregateType: "inquiry", aggregateId: inquiryPublicId },
      });
    }
    await db.auditLog.deleteMany({ where: { actorUserId } });
    await db.adminProfile.deleteMany({
      where: {
        userId: {
          in: [actorUserId, activeAssigneeUserId, inactiveAssigneeUserId],
        },
      },
    });
    await db.user.deleteMany({
      where: {
        id: {
          in: [
            actorUserId,
            activeAssigneeUserId,
            inactiveAssigneeUserId,
            customerUserId,
          ],
        },
      },
    });
  });

  it("links an intent idempotently and enforces lifecycle, assignment, notes, audit, and outbox", async () => {
    expect(
      await createAdminInquiryFromWhatsAppIntent({
        intentPublicId: anonymousIntentPublicId,
      }),
    ).toEqual({ ok: false, reason: "missing_contact" });

    const created = await createAdminInquiryFromWhatsAppIntent({
      intentPublicId,
    });
    expect(created).toMatchObject({ ok: true, duplicate: false });
    if (!created.ok) throw new Error("Follow-up creation failed.");
    inquiryPublicId = created.inquiryPublicId;

    const replay = await createAdminInquiryFromWhatsAppIntent({
      intentPublicId,
    });
    expect(replay).toEqual({
      ok: true,
      duplicate: true,
      inquiryPublicId: created.inquiryPublicId,
      inquiryNumber: created.inquiryNumber,
    });

    const db = getDb();
    const initial = await db.inquiry.findUniqueOrThrow({
      where: { publicId: inquiryPublicId },
      select: { status: true, updatedAt: true, message: true },
    });
    expect(initial).toMatchObject({ status: "OPEN" });
    expect(initial.message).toContain("Administrative follow-up");
    expect(initial.message).toContain("did not retain");

    const unchanged = await updateAdminInquiryStatus({
      inquiryPublicId,
      status: "OPEN",
      expectedUpdatedAt: initial.updatedAt,
    });
    expect(unchanged).toMatchObject({ ok: true, unchanged: true });

    const started = await updateAdminInquiryStatus({
      inquiryPublicId,
      status: "IN_PROGRESS",
      expectedUpdatedAt: initial.updatedAt,
    });
    expect(started).toMatchObject({
      ok: true,
      unchanged: false,
      status: "IN_PROGRESS",
    });

    let current = await db.inquiry.findUniqueOrThrow({
      where: { publicId: inquiryPublicId },
      select: { status: true, assignedToUserId: true, updatedAt: true },
    });
    expect(current.updatedAt.getTime()).toBeGreaterThan(
      initial.updatedAt.getTime(),
    );
    expect(
      await updateAdminInquiryStatus({
        inquiryPublicId,
        status: "OPEN",
        expectedUpdatedAt: current.updatedAt,
      }),
    ).toEqual({ ok: false, reason: "invalid_transition" });

    expect(
      await assignAdminInquiry({
        inquiryPublicId,
        assignedToUserId: activeAssigneeUserId,
        expectedUpdatedAt: initial.updatedAt,
      }),
    ).toEqual({ ok: false, reason: "conflict" });
    expect(
      await assignAdminInquiry({
        inquiryPublicId,
        assignedToUserId: inactiveAssigneeUserId,
        expectedUpdatedAt: current.updatedAt,
      }),
    ).toEqual({ ok: false, reason: "ineligible_admin" });
    expect(
      await assignAdminInquiry({
        inquiryPublicId,
        assignedToUserId: actorUserId,
        expectedUpdatedAt: current.updatedAt,
      }),
    ).toEqual({ ok: false, reason: "ineligible_admin" });

    const assigned = await assignAdminInquiry({
      inquiryPublicId,
      assignedToUserId: activeAssigneeUserId,
      expectedUpdatedAt: current.updatedAt,
    });
    expect(assigned).toMatchObject({ ok: true, unchanged: false });
    current = await db.inquiry.findUniqueOrThrow({
      where: { publicId: inquiryPublicId },
      select: { status: true, assignedToUserId: true, updatedAt: true },
    });
    expect(current.assignedToUserId).toBe(activeAssigneeUserId);

    const noteBody = `Internal-only integration note ${suffix}`;
    const noted = await addAdminInquiryNote({ inquiryPublicId, body: noteBody });
    expect(noted).toMatchObject({ ok: true, inquiryPublicId });

    for (const status of ["RESOLVED", "CLOSED", "OPEN"] as const) {
      const transitioned = await updateAdminInquiryStatus({
        inquiryPublicId,
        status,
        expectedUpdatedAt: current.updatedAt,
      });
      expect(transitioned).toMatchObject({
        ok: true,
        unchanged: false,
        status,
      });
      current = await db.inquiry.findUniqueOrThrow({
        where: { publicId: inquiryPublicId },
        select: { status: true, assignedToUserId: true, updatedAt: true },
      });
    }

    const [finalInquiry, intent, inquiryCount, auditLogs, outboxEvents] =
      await Promise.all([
        db.inquiry.findUniqueOrThrow({
          where: { publicId: inquiryPublicId },
          select: {
            status: true,
            resolvedAt: true,
            closedAt: true,
            internalNotes: { select: { body: true } },
          },
        }),
        db.whatsAppContactIntent.findUniqueOrThrow({
          where: { publicId: intentPublicId },
          select: { inquiry: { select: { publicId: true } } },
        }),
        db.inquiry.count({
          where: { whatsappIntents: { some: { publicId: intentPublicId } } },
        }),
        db.auditLog.findMany({
          where: { actorUserId },
          orderBy: { id: "asc" },
          select: { action: true, before: true, after: true },
        }),
        db.outboxEvent.findMany({
          where: { aggregateType: "inquiry", aggregateId: inquiryPublicId },
          orderBy: { id: "asc" },
          select: { eventType: true, payload: true },
        }),
      ]);

    expect(finalInquiry).toMatchObject({
      status: "OPEN",
      resolvedAt: null,
      closedAt: null,
      internalNotes: [{ body: noteBody }],
    });
    expect(intent.inquiry?.publicId).toBe(inquiryPublicId);
    expect(inquiryCount).toBe(1);
    expect(auditLogs).toHaveLength(7);
    expect(outboxEvents).toHaveLength(7);
    expect(JSON.stringify(auditLogs)).not.toContain(noteBody);
    expect(JSON.stringify(outboxEvents)).not.toContain(noteBody);
    expect(
      outboxEvents.map((event) => event.eventType),
    ).toContain("inquiry.whatsapp_follow_up_created");
  });
});
