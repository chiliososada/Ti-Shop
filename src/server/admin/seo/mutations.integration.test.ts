import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["seo-integration"],
    permissions: new Set(["seo.read", "seo.manage"]),
  })),
}));

import { updateAdminSeo } from "@/server/admin/seo/mutations";
import { getAdminSeoTarget } from "@/server/admin/seo/queries";
import { seoFormSchema } from "@/server/admin/seo/validators";
import { getDb } from "@/server/db/client";
import { getPublicPageBySlug } from "@/server/content/public-pages";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("SEO Open Graph media administration", () => {
  const suffix = randomUUID().slice(0, 12);
  const pagePublicId = randomUUID();
  const pageSlug = `seo-og-${suffix}`;
  const roleSlug = `seo-it-${suffix}`;
  const storagePrefix = `integration/seo-og/${suffix}`;
  const selectedMediaPublicId = randomUUID();
  const privateMediaPublicId = randomUUID();
  const unsafeMediaPublicId = randomUUID();
  const videoMediaPublicId = randomUUID();
  const deletedMediaPublicId = randomUUID();
  let actorUserId = "";
  let deniedUserId = "";
  let roleId = BigInt(0);

  function formInput(openGraphMediaPublicId: string, title = "SEO override") {
    return seoFormSchema.parse({
      entityType: "page",
      targetPublicId: pagePublicId,
      title,
      description: "Open Graph integration coverage",
      canonicalUrl: `/pages/${pageSlug}`,
      openGraphMediaPublicId,
    });
  }

  async function changeCounts() {
    const db = getDb();
    const [audits, outbox] = await Promise.all([
      db.auditLog.count({
        where: {
          actorUserId,
          action: "seo.metadata.update",
          resourceId: pagePublicId,
        },
      }),
      db.outboxEvent.count({
        where: {
          aggregateType: "seo_metadata",
          aggregateId: pagePublicId,
          eventType: "seo.metadata.updated",
        },
      }),
    ]);
    return { audits, outbox };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const permission = await db.permission.upsert({
      where: { slug: "seo.manage" },
      update: {},
      create: {
        slug: "seo.manage",
        name: "Manage SEO",
        description: "Integration fixture permission",
      },
      select: { id: true },
    });
    const role = await db.role.create({
      data: {
        slug: roleSlug,
        name: `SEO integration ${suffix}`,
        isSystem: false,
        permissions: { create: { permissionId: permission.id } },
      },
      select: { id: true },
    });
    roleId = role.id;

    const actor = await db.user.create({
      data: {
        name: "SEO integration administrator",
        email: `seo-admin-${suffix}@example.invalid`,
        emailVerified: true,
        adminProfile: { create: { isActive: true } },
        roleAssignments: { create: { roleId: role.id } },
      },
      select: { id: true },
    });
    const denied = await db.user.create({
      data: {
        name: "SEO integration denied administrator",
        email: `seo-denied-${suffix}@example.invalid`,
        emailVerified: true,
        adminProfile: { create: { isActive: true } },
      },
      select: { id: true },
    });
    actorUserId = actor.id;
    deniedUserId = denied.id;
    authorization.actorUserId = actor.id;

    await db.page.create({
      data: {
        publicId: pagePublicId,
        slug: pageSlug,
        title: "SEO Open Graph integration page",
        body: "Published page body.",
        format: "MARKDOWN",
        status: "PUBLISHED",
        publishedAt: new Date(Date.now() - 60_000),
      },
    });
    await db.media.createMany({
      data: [
        {
          publicId: selectedMediaPublicId,
          kind: "IMAGE",
          storageProvider: "integration",
          storageKey: `${storagePrefix}/selected.jpg`,
          publicUrl: `/media/${suffix}/selected.jpg`,
          altText: "Selected SEO image",
          width: 1_200,
          height: 630,
          isPrivate: false,
        },
        {
          publicId: privateMediaPublicId,
          kind: "IMAGE",
          storageProvider: "integration",
          storageKey: `${storagePrefix}/private.jpg`,
          publicUrl: `https://cdn.example.invalid/${suffix}/private.jpg`,
          isPrivate: true,
        },
        {
          publicId: unsafeMediaPublicId,
          kind: "IMAGE",
          storageProvider: "integration",
          storageKey: `${storagePrefix}/unsafe.jpg`,
          publicUrl: `http://cdn.example.invalid/${suffix}/unsafe.jpg`,
          isPrivate: false,
        },
        {
          publicId: videoMediaPublicId,
          kind: "VIDEO",
          storageProvider: "integration",
          storageKey: `${storagePrefix}/video.mp4`,
          publicUrl: `https://cdn.example.invalid/${suffix}/video.mp4`,
          isPrivate: false,
        },
        {
          publicId: deletedMediaPublicId,
          kind: "IMAGE",
          storageProvider: "integration",
          storageKey: `${storagePrefix}/deleted.jpg`,
          publicUrl: `https://cdn.example.invalid/${suffix}/deleted.jpg`,
          isPrivate: false,
          deletedAt: new Date(),
        },
      ],
    });
  });

  afterAll(async () => {
    authorization.actorUserId = actorUserId;
    const db = getDb();
    await db.outboxEvent.deleteMany({
      where: { aggregateType: "seo_metadata", aggregateId: pagePublicId },
    });
    await db.auditLog.deleteMany({
      where: { actorUserId: { in: [actorUserId, deniedUserId] } },
    });
    await db.page.deleteMany({ where: { publicId: pagePublicId } });
    await db.media.deleteMany({
      where: { storageKey: { startsWith: storagePrefix } },
    });
    if (roleId !== BigInt(0)) {
      await db.role.deleteMany({ where: { id: roleId } });
    }
    await db.user.deleteMany({
      where: { id: { in: [actorUserId, deniedUserId] } },
    });
  });

  it("selects, exposes, audits, and clears only an eligible public image", async () => {
    const selected = await updateAdminSeo(formInput(selectedMediaPublicId));
    expect(selected).toMatchObject({ ok: true, duplicate: false });

    const stored = await getDb().page.findUniqueOrThrow({
      where: { publicId: pagePublicId },
      select: {
        seo: {
          select: {
            title: true,
            openGraphMedia: { select: { publicId: true } },
          },
        },
      },
    });
    expect(stored.seo?.openGraphMedia?.publicId).toBe(selectedMediaPublicId);

    const publicPage = await getPublicPageBySlug(pageSlug);
    expect(publicPage?.seo?.openGraphImage).toMatchObject({
      publicId: selectedMediaPublicId,
      url: `/media/${suffix}/selected.jpg`,
      alt: "Selected SEO image",
      width: 1_200,
      height: 630,
    });

    const [audit, event] = await Promise.all([
      getDb().auditLog.findFirstOrThrow({
        where: {
          actorUserId,
          action: "seo.metadata.update",
          resourceId: pagePublicId,
        },
        orderBy: { id: "desc" },
        select: { before: true, after: true },
      }),
      getDb().outboxEvent.findFirstOrThrow({
        where: {
          aggregateType: "seo_metadata",
          aggregateId: pagePublicId,
          eventType: "seo.metadata.updated",
        },
        orderBy: { id: "desc" },
        select: { payload: true },
      }),
    ]);
    const recordedJson = JSON.stringify({ audit, event });
    expect(recordedJson).toContain(selectedMediaPublicId);
    expect(recordedJson).not.toContain(`/media/${suffix}/selected.jpg`);
    expect(recordedJson).not.toContain("publicUrl");
    expect(event.payload).toMatchObject({
      entityType: "page",
      targetPublicId: pagePublicId,
      openGraphMediaPublicId: selectedMediaPublicId,
    });

    const newerMedia = Array.from({ length: 55 }, (_, index) => ({
      publicId: randomUUID(),
      kind: "IMAGE" as const,
      storageProvider: "integration",
      storageKey: `${storagePrefix}/newer-${index}.jpg`,
      publicUrl: `https://cdn.example.invalid/${suffix}/newer-${index}.jpg`,
      altText: `Newer image ${index}`,
      isPrivate: false,
      updatedAt: new Date(Date.now() + (index + 1) * 1_000),
    }));
    await getDb().media.createMany({ data: newerMedia });

    const adminTarget = await getAdminSeoTarget("page", pagePublicId);
    expect(adminTarget?.openGraphMediaCandidates).toHaveLength(50);
    expect(
      adminTarget?.openGraphMediaCandidates.some(
        (candidate) => candidate.publicId === selectedMediaPublicId,
      ),
    ).toBe(true);
    const candidateIds = new Set(
      adminTarget?.openGraphMediaCandidates.map((candidate) =>
        candidate.publicId,
      ),
    );
    for (const rejectedId of [
      privateMediaPublicId,
      unsafeMediaPublicId,
      videoMediaPublicId,
      deletedMediaPublicId,
    ]) {
      expect(candidateIds.has(rejectedId)).toBe(false);
    }
    expect(
      adminTarget?.openGraphMediaCandidates.every(
        (candidate) =>
          candidate.url.startsWith("/") || candidate.url.startsWith("https://"),
      ),
    ).toBe(true);

    for (const rejectedId of [
      privateMediaPublicId,
      unsafeMediaPublicId,
      videoMediaPublicId,
      deletedMediaPublicId,
      randomUUID(),
    ]) {
      await expect(
        updateAdminSeo(formInput(rejectedId, "Must not be written")),
      ).resolves.toEqual({ ok: false, reason: "media_not_eligible" });
    }
    expect(await changeCounts()).toEqual({ audits: 1, outbox: 1 });
    expect(
      await updateAdminSeo(formInput(selectedMediaPublicId)),
    ).toMatchObject({ ok: true, duplicate: true });
    expect(await changeCounts()).toEqual({ audits: 1, outbox: 1 });

    const cleared = await updateAdminSeo(formInput(""));
    expect(cleared).toMatchObject({ ok: true, duplicate: false });
    expect(await changeCounts()).toEqual({ audits: 2, outbox: 2 });
    const clearedRow = await getDb().page.findUniqueOrThrow({
      where: { publicId: pagePublicId },
      select: {
        seo: {
          select: { openGraphMediaId: true },
        },
      },
    });
    expect(clearedRow.seo?.openGraphMediaId).toBeNull();
    const clearEvent = await getDb().outboxEvent.findFirstOrThrow({
      where: {
        aggregateType: "seo_metadata",
        aggregateId: pagePublicId,
        eventType: "seo.metadata.updated",
      },
      orderBy: { id: "desc" },
      select: { payload: true },
    });
    expect(clearEvent.payload).toMatchObject({
      openGraphMediaPublicId: null,
    });
  });

  it("rejects a write when seo.manage is absent inside the transaction", async () => {
    const before = await changeCounts();
    authorization.actorUserId = deniedUserId;
    try {
      await expect(
        updateAdminSeo(formInput(selectedMediaPublicId, "Denied update")),
      ).resolves.toEqual({ ok: false, reason: "permission_changed" });
      expect(await changeCounts()).toEqual(before);
    } finally {
      authorization.actorUserId = actorUserId;
    }
  });
});
