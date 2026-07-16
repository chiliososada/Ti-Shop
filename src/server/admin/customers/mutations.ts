import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type {
  DisableCustomerAccountInput,
  RestoreCustomerAccountInput,
  UpdateCustomerProfileInput,
} from "@/server/admin/customers/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

const customerAuditSelect = {
  id: true,
  name: true,
  customerProfile: {
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      countryCode: true,
      preferredCurrency: true,
      locale: true,
      updatedAt: true,
    },
  },
} as const;

const customerAccountAccessSelect = {
  id: true,
  email: true,
  disabledAt: true,
  disabledReason: true,
  disabledByUserId: true,
  customerProfile: { select: { id: true } },
  adminProfile: { select: { id: true, isActive: true } },
  _count: { select: { roleAssignments: true } },
} as const;

type CustomerAccountControlReason =
  | "not_eligible"
  | "confirmation_mismatch"
  | "permission_changed";

type CustomerAccountControlResult =
  | {
      ok: true;
      duplicate: boolean;
      publicId: string;
      revokedSessionCount: number;
    }
  | { ok: false; reason: CustomerAccountControlReason };

async function acquireCustomerAccountControlLocks(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  customerUserId: string,
) {
  const users = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT account."id"
    FROM "app"."users" AS account
    WHERE account."id" = ${actorUserId}::uuid
       OR account."id" = ${customerUserId}::uuid
    ORDER BY account."id"
    FOR UPDATE OF account
  `;

  await tx.$queryRaw<Array<{ userId: string }>>`
    SELECT profile."user_id" AS "userId"
    FROM "app"."customer_profiles" AS profile
    WHERE profile."user_id" = ${customerUserId}::uuid
    FOR UPDATE OF profile
  `;

  return {
    actorExists: users.some(({ id }) => id === actorUserId),
    customerExists: users.some(({ id }) => id === customerUserId),
  };
}

async function actorCanControlCustomerAccounts(
  tx: Prisma.TransactionClient,
  actorUserId: string,
) {
  const rows = await tx.$queryRaw<Array<{ allowed: boolean }>>`
    SELECT (
      COUNT(DISTINCT permission."slug")::integer = 3
    ) AS "allowed"
    FROM "app"."users" AS account
    INNER JOIN "app"."admin_profiles" AS profile
      ON profile."user_id" = account."id"
    INNER JOIN "app"."user_roles" AS assignment
      ON assignment."user_id" = account."id"
    INNER JOIN "app"."role_permissions" AS role_permission
      ON role_permission."role_id" = assignment."role_id"
    INNER JOIN "app"."permissions" AS permission
      ON permission."id" = role_permission."permission_id"
    WHERE account."id" = ${actorUserId}::uuid
      AND account."email_verified" = TRUE
      AND account."disabled_at" IS NULL
      AND profile."is_active" = TRUE
      AND permission."slug" IN (
        'users.manage',
        'customers.read',
        'orders.read'
      )
  `;
  return rows[0]?.allowed === true;
}

async function readEligibleCustomerAccount(
  tx: Prisma.TransactionClient,
  customerUserId: string,
) {
  const account = await tx.user.findUnique({
    where: { id: customerUserId },
    select: customerAccountAccessSelect,
  });

  if (
    !account ||
    !account.customerProfile ||
    account.adminProfile !== null ||
    account._count.roleAssignments > 0
  ) {
    return null;
  }
  return account;
}

function customerAccessSnapshot(account: {
  disabledAt: Date | null;
  disabledReason: string | null;
  disabledByUserId: string | null;
}) {
  return {
    disabled: account.disabledAt !== null,
    disabledAt: account.disabledAt,
    disabledReason: account.disabledReason,
    disabledByUserId: account.disabledByUserId,
  };
}

async function recordCustomerAccountAccessChange(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    customerUserId: string;
    action: "customers.account.disable" | "customers.account.restore";
    eventType: "customer.account.disabled" | "customer.account.restored";
    before: ReturnType<typeof customerAccessSnapshot>;
    after: ReturnType<typeof customerAccessSnapshot>;
    revokedSessionCount: number;
  },
) {
  await writeAdminAuditLog(tx, {
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: "customer_account_access",
    resourceId: input.customerUserId,
    before: input.before,
    after: input.after,
  });
  await tx.outboxEvent.create({
    data: {
      aggregateType: "customer",
      aggregateId: input.customerUserId,
      eventType: input.eventType,
      payload: {
        customerPublicId: input.customerUserId,
        disabled: input.after.disabled,
        disabledAt: input.after.disabledAt?.toISOString() ?? null,
        revokedSessionCount: input.revokedSessionCount,
      },
    },
    select: { id: true },
  });
}

export async function updateAdminCustomerProfile(
  input: UpdateCustomerProfileInput,
) {
  const returnTo = `/admin/customers/${input.publicId}`;
  const authorization = await requirePermission("customers.manage", returnTo);

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT customer."id"
          FROM "app"."users" AS customer
          INNER JOIN "app"."customer_profiles" AS profile
            ON profile."user_id" = customer."id"
          WHERE customer."id" = ${input.publicId}::uuid
            AND NOT EXISTS (
              SELECT 1
              FROM "app"."admin_profiles" AS administrator
              WHERE administrator."user_id" = customer."id"
            )
          FOR UPDATE OF customer, profile
        `;
        if (!locked[0]) {
          return { ok: false as const, reason: "not_found" as const };
        }

        const existing = await tx.user.findUniqueOrThrow({
          where: { id: locked[0].id },
          select: customerAuditSelect,
        });
        await tx.user.update({
          where: { id: locked[0].id },
          data: { name: input.name },
          select: { id: true },
        });
        await tx.customerProfile.update({
          where: { userId: locked[0].id },
          data: {
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            countryCode: "US",
            preferredCurrency: "USD",
            locale: "en-US",
          },
          select: { id: true },
        });
        const after = await tx.user.findUniqueOrThrow({
          where: { id: locked[0].id },
          select: customerAuditSelect,
        });

        await writeAdminAuditLog(tx, {
          actorUserId: authorization.session.user.id,
          action: "customers.profile.update",
          resourceType: "customer",
          resourceId: input.publicId,
          before: existing,
          after,
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "customer",
            aggregateId: input.publicId,
            eventType: "customer.profile.updated",
            payload: {
              customerPublicId: input.publicId,
              changedFields: [
                "name",
                "firstName",
                "lastName",
                "phone",
                "countryCode",
                "preferredCurrency",
                "locale",
              ],
            },
          },
          select: { id: true },
        });

        return { ok: true as const, publicId: input.publicId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function disableAdminCustomerAccount(
  input: DisableCustomerAccountInput,
): Promise<CustomerAccountControlResult> {
  const returnTo = `/admin/customers/${input.publicId}`;
  const authorization = await requirePermission("users.manage", returnTo);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const locks = await acquireCustomerAccountControlLocks(
          tx,
          actorUserId,
          input.publicId,
        );
        if (!locks.actorExists || !locks.customerExists) {
          return { ok: false as const, reason: "not_eligible" as const };
        }
        if (!(await actorCanControlCustomerAccounts(tx, actorUserId))) {
          return { ok: false as const, reason: "permission_changed" as const };
        }

        const account = await readEligibleCustomerAccount(tx, input.publicId);
        if (!account) {
          return { ok: false as const, reason: "not_eligible" as const };
        }
        if (account.email.toLowerCase() !== input.confirmationEmail) {
          return {
            ok: false as const,
            reason: "confirmation_mismatch" as const,
          };
        }

        const revokedSessions = await tx.session.deleteMany({
          where: { userId: input.publicId },
        });
        if (account.disabledAt !== null) {
          return {
            ok: true as const,
            duplicate: true,
            publicId: input.publicId,
            revokedSessionCount: revokedSessions.count,
          };
        }

        const before = customerAccessSnapshot(account);
        const updated = await tx.user.update({
          where: { id: input.publicId },
          data: {
            disabledAt: new Date(),
            disabledReason: input.reason,
            disabledByUserId: actorUserId,
          },
          select: customerAccountAccessSelect,
        });
        const after = customerAccessSnapshot(updated);
        await recordCustomerAccountAccessChange(tx, {
          actorUserId,
          customerUserId: input.publicId,
          action: "customers.account.disable",
          eventType: "customer.account.disabled",
          before,
          after,
          revokedSessionCount: revokedSessions.count,
        });

        return {
          ok: true as const,
          duplicate: false,
          publicId: input.publicId,
          revokedSessionCount: revokedSessions.count,
        };
      },
      // Session INSERT uses the same user-row lock in the database trigger.
      // READ COMMITTED is intentional here: after waiting for a concurrent
      // insert, the subsequent session DELETE must take a fresh snapshot and
      // see that newly committed row. SERIALIZABLE would retain the older
      // snapshot and could leave that session behind.
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    ),
  );
}

export async function restoreAdminCustomerAccount(
  input: RestoreCustomerAccountInput,
): Promise<CustomerAccountControlResult> {
  const returnTo = `/admin/customers/${input.publicId}`;
  const authorization = await requirePermission("users.manage", returnTo);
  const actorUserId = authorization.session.user.id;

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const locks = await acquireCustomerAccountControlLocks(
          tx,
          actorUserId,
          input.publicId,
        );
        if (!locks.actorExists || !locks.customerExists) {
          return { ok: false as const, reason: "not_eligible" as const };
        }
        if (!(await actorCanControlCustomerAccounts(tx, actorUserId))) {
          return { ok: false as const, reason: "permission_changed" as const };
        }

        const account = await readEligibleCustomerAccount(tx, input.publicId);
        if (!account) {
          return { ok: false as const, reason: "not_eligible" as const };
        }
        if (account.email.toLowerCase() !== input.confirmationEmail) {
          return {
            ok: false as const,
            reason: "confirmation_mismatch" as const,
          };
        }

        // Restoring never revives a previous cookie. Remove any anomalous rows
        // while the account is still disabled, then clear only the durable flag.
        const revokedSessions = await tx.session.deleteMany({
          where: { userId: input.publicId },
        });
        if (account.disabledAt === null) {
          return {
            ok: true as const,
            duplicate: true,
            publicId: input.publicId,
            revokedSessionCount: revokedSessions.count,
          };
        }

        const before = customerAccessSnapshot(account);
        const updated = await tx.user.update({
          where: { id: input.publicId },
          data: {
            disabledAt: null,
            disabledReason: null,
            disabledByUserId: null,
          },
          select: customerAccountAccessSelect,
        });
        const after = customerAccessSnapshot(updated);
        await recordCustomerAccountAccessChange(tx, {
          actorUserId,
          customerUserId: input.publicId,
          action: "customers.account.restore",
          eventType: "customer.account.restored",
          before,
          after,
          revokedSessionCount: revokedSessions.count,
        });

        return {
          ok: true as const,
          duplicate: false,
          publicId: input.publicId,
          revokedSessionCount: revokedSessions.count,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    ),
  );
}
