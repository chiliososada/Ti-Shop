import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["content.read", "content.manage"]),
  })),
}));

import { createAdminBlogPost } from "@/server/admin/content/mutations";
import { blogCreateFormSchema } from "@/server/admin/content/validators";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("content admin database invariants", () => {
  const suffix = randomUUID();
  const slug = `content-it-${suffix.slice(0, 12)}`;
  let actorUserId = "";
  let blogPublicId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const actor = await getDb().user.create({
      data: {
        name: "Content integration admin",
        email: `content-admin-${suffix}@example.invalid`,
        emailVerified: true,
      },
      select: { id: true },
    });
    actorUserId = actor.id;
    authorization.actorUserId = actor.id;
  });

  afterAll(async () => {
    const db = getDb();
    if (blogPublicId) {
      await db.outboxEvent.deleteMany({
        where: {
          aggregateType: "blog_post",
          aggregateId: blogPublicId,
        },
      });
      await db.auditLog.deleteMany({
        where: {
          resourceType: "blog_post",
          resourceId: blogPublicId,
        },
      });
    }
    await db.blogPost.deleteMany({ where: { slug } });
    if (actorUserId) {
      await db.auditLog.deleteMany({ where: { actorUserId } });
      await db.user.deleteMany({ where: { id: actorUserId } });
    }
  });

  it("creates one audited draft under concurrent use of the same slug", async () => {
    const input = blogCreateFormSchema.parse({
      slug,
      title: "Content integration article",
      category: "Research",
      authorDisplayName: "Research Team",
      readingMinutes: "6",
      excerpt: "Integration summary",
      body: "# Integration article",
      format: "MARKDOWN",
      status: "DRAFT",
      publishedAt: "",
    });

    const results = await Promise.all([
      createAdminBlogPost(input),
      createAdminBlogPost(input),
    ]);
    const created = results.filter((result) => result.ok);
    const conflicts = results.filter(
      (result) => !result.ok && result.reason === "slug_conflict",
    );

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    if (!created[0]?.ok) return;
    blogPublicId = created[0].publicId;

    const [post, auditCount, outboxCount] = await Promise.all([
      getDb().blogPost.findUnique({
        where: { publicId: blogPublicId },
        select: {
          slug: true,
          status: true,
          publishedAt: true,
          authorUserId: true,
        },
      }),
      getDb().auditLog.count({
        where: {
          actorUserId,
          action: "content.blog.create",
          resourceId: blogPublicId,
        },
      }),
      getDb().outboxEvent.count({
        where: {
          aggregateType: "blog_post",
          aggregateId: blogPublicId,
          eventType: "content.blog.created",
        },
      }),
    ]);

    expect(post).toEqual({
      slug,
      status: "DRAFT",
      publishedAt: null,
      authorUserId: actorUserId,
    });
    expect(auditCount).toBe(1);
    expect(outboxCount).toBe(1);
  });
});
