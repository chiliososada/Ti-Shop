import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type { CustomerProfileInput } from "@/server/account/profile-validators";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";

const profileSnapshotSelect = {
  id: true,
  name: true,
  disabledAt: true,
  customerProfile: {
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      preferredCurrency: true,
      countryCode: true,
      locale: true,
      marketingConsent: true,
    },
  },
} as const;

export async function updateCurrentCustomerProfile(input: CustomerProfileInput) {
  const session = await requireUser("/account");
  const actorUserId = session.user.id;

  return getDb().$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT account."id"
        FROM "app"."users" AS account
        INNER JOIN "app"."customer_profiles" AS profile
          ON profile."user_id" = account."id"
        WHERE account."id" = ${actorUserId}::uuid
        FOR UPDATE OF account, profile
      `;
      if (!locked[0]) return { ok: false as const, reason: "not_found" as const };

      const before = await tx.user.findUniqueOrThrow({
        where: { id: actorUserId },
        select: profileSnapshotSelect,
      });
      if (before.disabledAt !== null || before.customerProfile === null) {
        return { ok: false as const, reason: "inactive" as const };
      }

      await tx.user.update({
        where: { id: actorUserId },
        data: { name: input.name },
        select: { id: true },
      });
      await tx.customerProfile.update({
        where: { userId: actorUserId },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          preferredCurrency: "USD",
          countryCode: "US",
          locale: "en-US",
          marketingConsent: input.marketingConsent,
        },
        select: { id: true },
      });

      const after = await tx.user.findUniqueOrThrow({
        where: { id: actorUserId },
        select: profileSnapshotSelect,
      });
      await writeAdminAuditLog(tx, {
        actorUserId,
        action: "account.profile.update",
        resourceType: "customer_profile",
        resourceId: actorUserId,
        before,
        after,
        source: "customer-server-action",
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "customer",
          aggregateId: actorUserId,
          eventType: "customer.profile.updated_by_customer",
          payload: {
            customerPublicId: actorUserId,
            marketingConsent: input.marketingConsent,
          },
        },
        select: { id: true },
      });

      return { ok: true as const };
    },
    // The explicit user/profile row locks serialize this update with account
    // deactivation. Read Committed ensures a waiter sees the committed access
    // state instead of retaining an older transaction snapshot.
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
