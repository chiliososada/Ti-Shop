import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["navigation-integration"],
    permissions: new Set(["content.read", "content.manage"]),
  })),
}));

import {
  createAdminNavigation,
  createAdminNavigationItem,
  updateAdminNavigationItem,
} from "@/server/admin/navigation/mutations";
import {
  navigationCreateFormSchema,
  navigationItemCreateFormSchema,
  navigationItemUpdateFormSchema,
} from "@/server/admin/navigation/validators";
import { getDb } from "@/server/db/client";
import { getPublicNavigation } from "@/server/navigation/public";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("navigation administration and public-read invariants", () => {
  const suffix = randomUUID().slice(0, 12);
  const navigationKey = `header-test-${suffix}`;
  const invalidNavigationKey = `footer-test-${suffix}`;
  const draftNavigationKey = `draft-test-${suffix}`;
  const roleSlug = `navigation-it-${suffix}`;
  const navigationSubmissionId = randomUUID();
  const navigationPublicIds: string[] = [];
  let actorUserId = "";
  let deniedUserId = "";
  let roleId = BigInt(0);

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const permission = await db.permission.upsert({
      where: { slug: "content.manage" },
      update: {},
      create: {
        slug: "content.manage",
        name: "Manage content",
        description: "Integration fixture permission",
      },
      select: { id: true },
    });
    const role = await db.role.create({
      data: {
        slug: roleSlug,
        name: `Navigation integration ${suffix}`,
        isSystem: false,
        permissions: { create: { permissionId: permission.id } },
      },
      select: { id: true },
    });
    roleId = role.id;

    const actor = await db.user.create({
      data: {
        name: "Navigation integration administrator",
        email: `navigation-admin-${suffix}@example.invalid`,
        emailVerified: true,
        adminProfile: { create: { isActive: true } },
        roleAssignments: { create: { roleId: role.id } },
      },
      select: { id: true },
    });
    const denied = await db.user.create({
      data: {
        name: "Navigation integration denied administrator",
        email: `navigation-denied-${suffix}@example.invalid`,
        emailVerified: true,
        adminProfile: { create: { isActive: true } },
      },
      select: { id: true },
    });
    actorUserId = actor.id;
    deniedUserId = denied.id;
    authorization.actorUserId = actor.id;
  });

  afterAll(async () => {
    authorization.actorUserId = actorUserId;
    const db = getDb();
    await db.outboxEvent.deleteMany({
      where: {
        aggregateType: "navigation",
        aggregateId: { in: navigationPublicIds },
      },
    });
    await db.auditLog.deleteMany({
      where: { actorUserId: { in: [actorUserId, deniedUserId] } },
    });
    await db.navigation.deleteMany({
      where: {
        key: {
          in: [navigationKey, invalidNavigationKey, draftNavigationKey],
        },
      },
    });
    if (roleId !== BigInt(0)) {
      await db.role.deleteMany({ where: { id: roleId } });
    }
    await db.user.deleteMany({
      where: { id: { in: [actorUserId, deniedUserId] } },
    });
  });

  it("creates a named menu idempotently with exactly one audit and outbox event", async () => {
    const input = navigationCreateFormSchema.parse({
      submissionId: navigationSubmissionId,
      key: navigationKey,
      name: "Integration header navigation",
      status: "PUBLISHED",
    });
    const results = await Promise.all([
      createAdminNavigation(input),
      createAdminNavigation(input),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      results.filter((result) => result.ok && !result.duplicate),
    ).toHaveLength(1);
    navigationPublicIds.push(navigationSubmissionId);

    const [navigationCount, auditCount, outboxCount] = await Promise.all([
      getDb().navigation.count({ where: { publicId: navigationSubmissionId } }),
      getDb().auditLog.count({
        where: {
          actorUserId,
          action: "content.navigation.create",
          resourceId: navigationSubmissionId,
        },
      }),
      getDb().outboxEvent.count({
        where: {
          aggregateType: "navigation",
          aggregateId: navigationSubmissionId,
          eventType: "content.navigation.created",
        },
      }),
    ]);
    expect({ navigationCount, auditCount, outboxCount }).toEqual({
      navigationCount: 1,
      auditCount: 1,
      outboxCount: 1,
    });
  });

  it("publishes only visible, safe, first-level links in stable order", async () => {
    const firstPublicId = randomUUID();
    const externalPublicId = randomUUID();
    const hiddenPublicId = randomUUID();
    const first = navigationItemCreateFormSchema.parse({
      submissionId: firstPublicId,
      navigationPublicId: navigationSubmissionId,
      label: "Products",
      url: "/products",
      position: "20",
      isVisible: "on",
    });
    const [created, duplicate] = await Promise.all([
      createAdminNavigationItem(first),
      createAdminNavigationItem(first),
    ]);
    expect(created.ok && duplicate.ok).toBe(true);
    expect(
      [created, duplicate].filter((result) => result.ok && !result.duplicate),
    ).toHaveLength(1);

    await createAdminNavigationItem(
      navigationItemCreateFormSchema.parse({
        submissionId: externalPublicId,
        navigationPublicId: navigationSubmissionId,
        label: "Documentation",
        url: "https://docs.example.com/guide",
        position: "10",
        isVisible: "on",
        openInNewTab: "on",
      }),
    );
    await createAdminNavigationItem(
      navigationItemCreateFormSchema.parse({
        submissionId: hiddenPublicId,
        navigationPublicId: navigationSubmissionId,
        label: "Hidden",
        url: "/hidden",
        position: "0",
      }),
    );

    const navigation = await getDb().navigation.findUniqueOrThrow({
      where: { publicId: navigationSubmissionId },
      select: { id: true },
    });
    const parent = await getDb().navigationItem.findUniqueOrThrow({
      where: { publicId: firstPublicId },
      select: { id: true },
    });
    await getDb().navigationItem.create({
      data: {
        navigationId: navigation.id,
        parentId: null,
        label: "Unsafe direct row",
        url: "javascript:alert(1)",
        position: 1,
        isVisible: true,
      },
    });
    await getDb().navigationItem.create({
      data: {
        navigationId: navigation.id,
        parentId: parent.id,
        label: "Nested safe row",
        url: "/nested",
        position: 0,
        isVisible: true,
      },
    });

    expect(await getPublicNavigation(navigationKey)).toEqual([
      {
        id: externalPublicId,
        label: "Documentation",
        href: "https://docs.example.com/guide",
        external: true,
        openInNewTab: true,
      },
      {
        id: firstPublicId,
        label: "Products",
        href: "/products",
        external: false,
        openInNewTab: false,
      },
    ]);

    const changedInput = navigationItemUpdateFormSchema.parse({
      publicId: firstPublicId,
      navigationPublicId: navigationSubmissionId,
      label: "Products and pricing",
      url: "/products",
      position: "5",
      isVisible: "on",
    });
    const changed = await updateAdminNavigationItem(changedInput);
    const repeated = await updateAdminNavigationItem(changedInput);
    expect(changed).toMatchObject({ ok: true, duplicate: false });
    expect(repeated).toMatchObject({ ok: true, duplicate: true });
    expect(
      await getDb().auditLog.count({
        where: {
          action: "content.navigation_item.update",
          resourceId: firstPublicId,
        },
      }),
    ).toBe(1);
  });

  it("returns null for draft, empty, or wholly invalid published configurations", async () => {
    const invalid = await getDb().navigation.create({
      data: {
        key: invalidNavigationKey,
        name: "Invalid published navigation",
        status: "PUBLISHED",
        items: {
          create: {
            label: "Unsafe",
            url: "data:text/html,unsafe",
            isVisible: true,
          },
        },
      },
      select: { publicId: true },
    });
    const draft = await getDb().navigation.create({
      data: {
        key: draftNavigationKey,
        name: "Draft navigation",
        status: "DRAFT",
        items: {
          create: { label: "Safe but unpublished", url: "/draft" },
        },
      },
      select: { publicId: true },
    });
    navigationPublicIds.push(invalid.publicId, draft.publicId);

    expect(await getPublicNavigation(invalidNavigationKey)).toBeNull();
    expect(await getPublicNavigation(draftNavigationKey)).toBeNull();
  });

  it("rejects the write when content.manage is absent inside the transaction", async () => {
    authorization.actorUserId = deniedUserId;
    const submissionId = randomUUID();
    try {
      const result = await createAdminNavigation(
        navigationCreateFormSchema.parse({
          submissionId,
          key: `denied-test-${suffix}`,
          name: "Must not be created",
          status: "DRAFT",
        }),
      );
      expect(result).toEqual({ ok: false, reason: "permission_changed" });
      expect(
        await getDb().navigation.findUnique({ where: { publicId: submissionId } }),
      ).toBeNull();
    } finally {
      authorization.actorUserId = actorUserId;
    }
  });
});
