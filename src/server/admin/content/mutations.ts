import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type {
  BlogCreateFormInput,
  BlogFormInput,
  FaqCreateFormInput,
  FaqUpdateFormInput,
  PageCreateFormInput,
  PageUpdateFormInput,
} from "@/server/admin/content/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

/**
 * Runs a slug-guarded content write under SERIALIZABLE isolation with retry,
 * and maps the unique-index violation to a clean `slug_conflict` result. The
 * in-transaction findUnique check-then-act races under weaker isolation, and
 * concurrent inserts of the same slug would otherwise surface the raw Prisma
 * P2002 as a generic "try again" error instead of "that slug is in use".
 */
async function runSlugGuardedContentWrite<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | { ok: false; reason: "slug_conflict" }> {
  try {
    return await withSerializableRetry(() =>
      getDb().$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return { ok: false as const, reason: "slug_conflict" as const };
    }
    throw error;
  }
}

const blogAuditSelect = {
  publicId: true,
  slug: true,
  title: true,
  category: true,
  authorDisplayName: true,
  readingMinutes: true,
  excerpt: true,
  body: true,
  format: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
} as const;

const pageAuditSelect = {
  publicId: true,
  slug: true,
  title: true,
  body: true,
  format: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
} as const;

const faqAuditSelect = {
  publicId: true,
  slug: true,
  question: true,
  answer: true,
  category: true,
  position: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
} as const;

export async function createAdminBlogPost(input: BlogCreateFormInput) {
  const authorization = await requirePermission(
    "content.manage",
    "/admin/content/blog/new",
  );

  return runSlugGuardedContentWrite(async (tx) => {
        const conflict = await tx.blogPost.findUnique({
          where: { slug: input.slug },
          select: { publicId: true },
        });
        if (conflict) {
          return { ok: false as const, reason: "slug_conflict" as const };
        }

        const after = await tx.blogPost.create({
          data: {
            slug: input.slug,
            title: input.title,
            category: input.category,
            authorDisplayName: input.authorDisplayName,
            readingMinutes: input.readingMinutes,
            excerpt: input.excerpt,
            body: input.body,
            format: input.format,
            status: input.status,
            publishedAt: input.publishedAt,
            authorUserId: authorization.session.user.id,
          },
          select: blogAuditSelect,
        });

        await writeAdminAuditLog(tx, {
          actorUserId: authorization.session.user.id,
          action: "content.blog.create",
          resourceType: "blog_post",
          resourceId: after.publicId,
          before: null,
          after,
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "blog_post",
            aggregateId: after.publicId,
            eventType: "content.blog.created",
            payload: {
              publicId: after.publicId,
              slug: after.slug,
              status: after.status,
            },
          },
          select: { id: true },
        });

        return {
          ok: true as const,
          publicId: after.publicId,
          slug: after.slug,
        };
  });
}

export async function updateAdminBlogPost(input: BlogFormInput) {
  const authorization = await requirePermission(
    "content.manage",
    `/admin/content/blog/${input.publicId}`,
  );

  return runSlugGuardedContentWrite(async (tx) => {
    const existing = await tx.blogPost.findFirst({
      where: { publicId: input.publicId, deletedAt: null },
      select: { id: true, ...blogAuditSelect },
    });
    if (!existing) return { ok: false as const, reason: "not_found" as const };

    const after = await tx.blogPost.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        category: input.category,
        authorDisplayName: input.authorDisplayName,
        readingMinutes: input.readingMinutes,
        excerpt: input.excerpt,
        body: input.body,
        format: input.format,
        status: input.status,
        publishedAt: input.publishedAt,
      },
      select: blogAuditSelect,
    });

    await writeAdminAuditLog(tx, {
      actorUserId: authorization.session.user.id,
      action: "content.blog.update",
      resourceType: "blog_post",
      resourceId: input.publicId,
      before: existing,
      after,
    });

    await tx.outboxEvent.create({
      data: {
        aggregateType: "blog_post",
        aggregateId: input.publicId,
        eventType: "content.blog.updated",
        payload: {
          publicId: input.publicId,
          slug: existing.slug,
          status: after.status,
        },
      },
      select: { id: true },
    });

    return {
      ok: true as const,
      publicId: input.publicId,
      slug: existing.slug,
    };
  });
}

export async function createAdminPage(input: PageCreateFormInput) {
  const authorization = await requirePermission(
    "content.manage",
    "/admin/content/pages/new",
  );

  return runSlugGuardedContentWrite(async (tx) => {
    const conflict = await tx.page.findUnique({
      where: { slug: input.slug },
      select: { publicId: true },
    });
    if (conflict) return { ok: false as const, reason: "slug_conflict" as const };

    const after = await tx.page.create({
      data: {
        slug: input.slug,
        title: input.title,
        body: input.body,
        format: input.format,
        status: input.status,
        publishedAt: input.publishedAt,
        authorUserId: authorization.session.user.id,
      },
      select: pageAuditSelect,
    });

    await writeAdminAuditLog(tx, {
      actorUserId: authorization.session.user.id,
      action: "content.page.create",
      resourceType: "page",
      resourceId: after.publicId,
      before: null,
      after,
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: "page",
        aggregateId: after.publicId,
        eventType: "content.page.created",
        payload: {
          publicId: after.publicId,
          slug: after.slug,
          status: after.status,
        },
      },
      select: { id: true },
    });

    return {
      ok: true as const,
      publicId: after.publicId,
      slug: after.slug,
    };
  });
}

export async function updateAdminPage(input: PageUpdateFormInput) {
  const authorization = await requirePermission(
    "content.manage",
    `/admin/content/pages/${input.publicId}`,
  );

  return runSlugGuardedContentWrite(async (tx) => {
    const existing = await tx.page.findFirst({
      where: {
        publicId: input.publicId,
        deletedAt: null,
        managedRoute: null,
      },
      select: { id: true, ...pageAuditSelect },
    });
    if (!existing) return { ok: false as const, reason: "not_found" as const };

    const conflict = await tx.page.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (conflict && conflict.id !== existing.id) {
      return { ok: false as const, reason: "slug_conflict" as const };
    }

    const after = await tx.page.update({
      where: { id: existing.id },
      data: {
        slug: input.slug,
        title: input.title,
        body: input.body,
        format: input.format,
        status: input.status,
        publishedAt: input.publishedAt,
      },
      select: pageAuditSelect,
    });

    await writeAdminAuditLog(tx, {
      actorUserId: authorization.session.user.id,
      action: "content.page.update",
      resourceType: "page",
      resourceId: input.publicId,
      before: existing,
      after,
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: "page",
        aggregateId: input.publicId,
        eventType: "content.page.updated",
        payload: {
          publicId: input.publicId,
          previousSlug: existing.slug,
          slug: after.slug,
          status: after.status,
        },
      },
      select: { id: true },
    });

    return {
      ok: true as const,
      publicId: input.publicId,
      slug: after.slug,
      previousSlug: existing.slug,
    };
  });
}

export async function createAdminFaq(input: FaqCreateFormInput) {
  const authorization = await requirePermission(
    "content.manage",
    "/admin/content/faq/new",
  );

  return runSlugGuardedContentWrite(async (tx) => {
    const conflict = await tx.faq.findUnique({
      where: { slug: input.slug },
      select: { publicId: true },
    });
    if (conflict) return { ok: false as const, reason: "slug_conflict" as const };

    const after = await tx.faq.create({
      data: {
        slug: input.slug,
        question: input.question,
        answer: input.answer,
        category: input.category,
        position: input.position,
        status: input.status,
        publishedAt: input.publishedAt,
        authorUserId: authorization.session.user.id,
      },
      select: faqAuditSelect,
    });

    await writeAdminAuditLog(tx, {
      actorUserId: authorization.session.user.id,
      action: "content.faq.create",
      resourceType: "faq",
      resourceId: after.publicId,
      before: null,
      after,
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: "faq",
        aggregateId: after.publicId,
        eventType: "content.faq.created",
        payload: {
          publicId: after.publicId,
          slug: after.slug,
          status: after.status,
        },
      },
      select: { id: true },
    });

    return {
      ok: true as const,
      publicId: after.publicId,
      slug: after.slug,
    };
  });
}

export async function updateAdminFaq(input: FaqUpdateFormInput) {
  const authorization = await requirePermission(
    "content.manage",
    `/admin/content/faq/${input.publicId}`,
  );

  return runSlugGuardedContentWrite(async (tx) => {
    const existing = await tx.faq.findFirst({
      where: { publicId: input.publicId, deletedAt: null },
      select: { id: true, ...faqAuditSelect },
    });
    if (!existing) return { ok: false as const, reason: "not_found" as const };

    const conflict = await tx.faq.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (conflict && conflict.id !== existing.id) {
      return { ok: false as const, reason: "slug_conflict" as const };
    }

    const after = await tx.faq.update({
      where: { id: existing.id },
      data: {
        slug: input.slug,
        question: input.question,
        answer: input.answer,
        category: input.category,
        position: input.position,
        status: input.status,
        publishedAt: input.publishedAt,
      },
      select: faqAuditSelect,
    });

    await writeAdminAuditLog(tx, {
      actorUserId: authorization.session.user.id,
      action: "content.faq.update",
      resourceType: "faq",
      resourceId: input.publicId,
      before: existing,
      after,
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: "faq",
        aggregateId: input.publicId,
        eventType: "content.faq.updated",
        payload: {
          publicId: input.publicId,
          previousSlug: existing.slug,
          slug: after.slug,
          status: after.status,
        },
      },
      select: { id: true },
    });

    return {
      ok: true as const,
      publicId: input.publicId,
      slug: after.slug,
      previousSlug: existing.slug,
    };
  });
}
