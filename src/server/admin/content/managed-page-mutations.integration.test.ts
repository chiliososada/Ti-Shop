import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["managed-page-integration"],
    permissions: new Set(["content.read", "content.manage"]),
  })),
}));

import { ManagedPageRoute } from "@/generated/prisma/client";
import { getManagedPageDefinition } from "@/lib/managed-page-routes";
import { upsertAdminManagedPage } from "@/server/admin/content/managed-page-mutations";
import { managedPageFormSchema } from "@/server/admin/content/validators";
import { updateAdminSeo } from "@/server/admin/seo/mutations";
import { seoFormSchema } from "@/server/admin/seo/validators";
import {
  getPublicManagedPage,
  getPublishedManagedPageSitemapStates,
} from "@/server/content/public-managed-pages";
import {
  getPublicPageBySlug,
  getPublicPageSitemapEntries,
} from "@/server/content/public-pages";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("managed storefront page invariants", () => {
  const suffix = randomUUID().slice(0, 12);
  const roleSlug = `managed-page-it-${suffix}`;
  let actorUserId = "";
  let deniedUserId = "";
  let roleId = BigInt(0);

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    await db.page.deleteMany({
      where: {
        managedRoute: {
          in: [
            ManagedPageRoute.ABOUT,
            ManagedPageRoute.SHIPPING,
            ManagedPageRoute.RESEARCH_USE_POLICY,
          ],
        },
      },
    });
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
    const seoPermission = await db.permission.upsert({
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
        name: `Managed page integration ${suffix}`,
        isSystem: false,
        permissions: {
          create: [
            { permissionId: permission.id },
            { permissionId: seoPermission.id },
          ],
        },
      },
      select: { id: true },
    });
    roleId = role.id;

    const actor = await db.user.create({
      data: {
        name: "Managed page administrator",
        email: `managed-page-${suffix}@example.invalid`,
        emailVerified: true,
        adminProfile: { create: { isActive: true } },
        roleAssignments: { create: { roleId: role.id } },
      },
      select: { id: true },
    });
    const denied = await db.user.create({
      data: {
        name: "Managed page denied administrator",
        email: `managed-page-denied-${suffix}@example.invalid`,
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
    const pages = await db.page.findMany({
      where: { managedRoute: { not: null } },
      select: { publicId: true },
    });
    const publicIds = pages.map((page) => page.publicId);
    await db.outboxEvent.deleteMany({
      where: { aggregateId: { in: publicIds } },
    });
    const userIds = [actorUserId, deniedUserId].filter(Boolean);
    if (userIds.length > 0) {
      await db.auditLog.deleteMany({
        where: { actorUserId: { in: userIds } },
      });
    }
    await db.page.deleteMany({ where: { managedRoute: { not: null } } });
    if (roleId !== BigInt(0)) {
      await db.role.deleteMany({ where: { id: roleId } });
    }
    if (userIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  it("creates one audited draft under concurrent retries and never exposes /pages/internal-slug", async () => {
    authorization.actorUserId = actorUserId;
    const input = managedPageFormSchema.parse({
      routeKey: "SHIPPING",
      title: "Reviewed shipping policy",
      body: "## Destinations\n\nEligible United States destinations are reviewed for each order.",
      status: "DRAFT",
      publishedAt: "",
    });
    const results = await Promise.all([
      upsertAdminManagedPage(input),
      upsertAdminManagedPage(input),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      results.filter((result) => result.ok && !result.duplicate),
    ).toHaveLength(1);

    const page = await getDb().page.findUniqueOrThrow({
      where: { managedRoute: ManagedPageRoute.SHIPPING },
      select: { publicId: true, slug: true, format: true, status: true },
    });
    expect(page).toMatchObject({
      slug: "managed-route-shipping",
      format: "MARKDOWN",
      status: "DRAFT",
    });
    await expect(getPublicPageBySlug(page.slug)).resolves.toBeNull();
    await expect(
      getDb().auditLog.count({
        where: { resourceType: "managed_page", resourceId: page.publicId },
      }),
    ).resolves.toBe(1);
    await expect(
      getDb().outboxEvent.count({
        where: { aggregateType: "managed_page", aggregateId: page.publicId },
      }),
    ).resolves.toBe(1);
  });

  it("publishes safe content at only the fixed route and reflects noindex in sitemap state", async () => {
    authorization.actorUserId = actorUserId;
    const result = await upsertAdminManagedPage(
      managedPageFormSchema.parse({
        routeKey: "ABOUT",
        title: "Reviewed company information",
        body: "## How ordering works\n\nAvailability and documentation are confirmed for the actual request.",
        status: "PUBLISHED",
        publishedAt: "2026-07-13T00:00:00Z",
      }),
    );
    expect(result).toMatchObject({ ok: true, publicPath: "/about" });
    if (!result.ok) return;

    const stored = await getDb().page.findUniqueOrThrow({
      where: { managedRoute: ManagedPageRoute.ABOUT },
      select: { id: true, slug: true },
    });
    await expect(
      updateAdminSeo(
        seoFormSchema.parse({
          entityType: "page",
          targetPublicId: result.publicId,
          title: "Reviewed About",
          description: "Bank account number: 1234567890",
          canonicalUrl: "/about",
          openGraphMediaPublicId: "",
          noIndex: "on",
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: "sensitive_content" });
    await expect(
      updateAdminSeo(
        seoFormSchema.parse({
          entityType: "page",
          targetPublicId: result.publicId,
          title: "Reviewed About",
          description: "Reviewed company and ordering information.",
          canonicalUrl: "/pages/managed-route-about",
          openGraphMediaPublicId: "",
          noIndex: "on",
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: "canonical_mismatch" });
    await expect(
      updateAdminSeo(
        seoFormSchema.parse({
          entityType: "page",
          targetPublicId: result.publicId,
          title: "Reviewed About",
          description: "Reviewed company and ordering information.",
          canonicalUrl: "/about",
          openGraphMediaPublicId: "",
          noIndex: "on",
        }),
      ),
    ).resolves.toMatchObject({
      ok: true,
      publicPath: "/about",
    });
    await getDb().seoMetadata.update({
      where: { pageId: stored.id },
      data: { description: "Bank account number: 1234567890" },
    });

    await expect(getPublicManagedPage("ABOUT")).resolves.toMatchObject({
      title: "Reviewed company information",
      routeKey: "ABOUT",
      seo: { title: "Reviewed About", description: null, noIndex: true },
    });
    await expect(getPublicPageBySlug(stored.slug)).resolves.toBeNull();
    await expect(getPublicPageSitemapEntries()).resolves.not.toContainEqual(
      expect.objectContaining({ slug: stored.slug }),
    );
    await expect(getPublishedManagedPageSitemapStates()).resolves.toContainEqual(
      expect.objectContaining({ path: "/about", noIndex: true }),
    );
  });

  it("fails closed for unsafe content inserted outside the admin validator", async () => {
    const definition = getManagedPageDefinition("RESEARCH_USE_POLICY");
    if (!definition) throw new Error("Missing research-use definition.");
    await getDb().page.create({
      data: {
        slug: definition.internalSlug,
        managedRoute: ManagedPageRoute.RESEARCH_USE_POLICY,
        title: "Unsafe direct record",
        body: "<script>alert(1)</script>",
        format: "MARKDOWN",
        status: "PUBLISHED",
        publishedAt: new Date("2026-07-13T00:00:00Z"),
      },
    });
    await expect(getPublicManagedPage("RESEARCH_USE_POLICY")).resolves.toBeNull();
  });

  it("rechecks content.manage inside the transaction", async () => {
    authorization.actorUserId = deniedUserId;
    await expect(
      upsertAdminManagedPage(
        managedPageFormSchema.parse({
          routeKey: "SHIPPING",
          title: "Denied update",
          body: "This update must not be stored.",
          status: "DRAFT",
          publishedAt: "",
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: "permission_changed" });
    authorization.actorUserId = actorUserId;
  });
});
