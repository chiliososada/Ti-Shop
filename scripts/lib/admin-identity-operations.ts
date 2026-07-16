import {
  Prisma,
  type PrismaClient,
} from "../../src/generated/prisma/client";

export type AdminIdentityOperationInput = {
  userId: string;
  email: string;
};

export type AdminIdentityOperationErrorCode =
  | "identity_mismatch"
  | "email_unverified"
  | "account_disabled"
  | "owner_role_missing";

export class AdminIdentityOperationError extends Error {
  readonly code: AdminIdentityOperationErrorCode;

  constructor(code: AdminIdentityOperationErrorCode, message: string) {
    super(message);
    this.name = "AdminIdentityOperationError";
    this.code = code;
  }
}

type LockedUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  disabledAt: Date | null;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

async function lockExactUser(
  tx: Prisma.TransactionClient,
  input: AdminIdentityOperationInput,
): Promise<LockedUser> {
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT
      account."id",
      account."email",
      account."email_verified" AS "emailVerified",
      account."disabled_at" AS "disabledAt"
    FROM "app"."users" AS account
    WHERE account."id" = ${input.userId}::uuid
    FOR UPDATE OF account
  `;
  const user = rows[0];

  if (!user || normalizeEmail(user.email) !== normalizeEmail(input.email)) {
    throw new AdminIdentityOperationError(
      "identity_mismatch",
      "No registered user matches both the exact user ID and email address.",
    );
  }

  return user;
}

export async function verifyUserEmailOutOfBand(
  prisma: PrismaClient,
  input: AdminIdentityOperationInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const user = await lockExactUser(tx, input);
      const alreadyVerified = user.emailVerified;

      if (!alreadyVerified) {
        await tx.user.update({
          where: { id: user.id },
          data: { emailVerified: true },
          select: { id: true },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: null,
          action: alreadyVerified
            ? "security.user.email_verification_reconfirmed_out_of_band"
            : "security.user.email_verified_out_of_band",
          resourceType: "user",
          resourceId: user.id,
          before: { emailVerified: alreadyVerified },
          after: { emailVerified: true },
          metadata: {
            source: "scripts/verify-user-email.ts",
            confirmation: "out-of-band-identity-check",
          },
        },
        select: { id: true },
      });

      return {
        userId: user.id,
        email: user.email,
        duplicate: alreadyVerified,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function grantOwnerAccess(
  prisma: PrismaClient,
  input: AdminIdentityOperationInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const user = await lockExactUser(tx, input);
      if (user.disabledAt !== null) {
        throw new AdminIdentityOperationError(
          "account_disabled",
          "Restore the customer account before granting owner access.",
        );
      }
      if (!user.emailVerified) {
        throw new AdminIdentityOperationError(
          "email_unverified",
          "Owner access requires a verified email. Complete the out-of-band verification step first.",
        );
      }

      const roles = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT role."id"
        FROM "app"."roles" AS role
        WHERE role."slug" = 'owner'
          AND role."is_system" = TRUE
        FOR UPDATE OF role
      `;
      const ownerRole = roles[0];
      if (!ownerRole) {
        throw new AdminIdentityOperationError(
          "owner_role_missing",
          "The owner system role is missing. Run the database seed first.",
        );
      }

      const profile = await tx.adminProfile.findUnique({
        where: { userId: user.id },
        select: { isActive: true },
      });
      const assignment = await tx.userRole.findUnique({
        where: {
          userId_roleId: { userId: user.id, roleId: ownerRole.id },
        },
        select: { userId: true },
      });
      const duplicate = profile?.isActive === true && assignment !== null;

      await tx.adminProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, isActive: true },
        update: { isActive: true },
        select: { id: true },
      });
      await tx.userRole.upsert({
        where: {
          userId_roleId: { userId: user.id, roleId: ownerRole.id },
        },
        create: {
          userId: user.id,
          roleId: ownerRole.id,
          assignedByUserId: null,
        },
        update: {},
        select: { userId: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          action: duplicate
            ? "admin.owner_grant_confirmed_cli"
            : "admin.owner_granted_cli",
          resourceType: "user",
          resourceId: user.id,
          before: {
            emailVerified: true,
            administratorProfileExists: profile !== null,
            administratorActive: profile?.isActive === true,
            ownerRoleAssigned: assignment !== null,
          },
          after: {
            emailVerified: true,
            administratorProfileExists: true,
            administratorActive: true,
            ownerRoleAssigned: true,
          },
          metadata: {
            role: "owner",
            source: "scripts/grant-admin.ts",
            identityMatch: "user-id-and-email",
          },
        },
        select: { id: true },
      });

      return {
        userId: user.id,
        email: user.email,
        duplicate,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
