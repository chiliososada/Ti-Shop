import type { Prisma } from "@/generated/prisma/client";

/**
 * An inquiry may only be assigned to an administrator who can actually open
 * the communications module. Keeping this as one shared filter prevents the
 * select control and the mutation guard from drifting apart.
 */
export const eligibleCommunicationAssigneeWhere = {
  emailVerified: true,
  adminProfile: { is: { isActive: true } },
  roleAssignments: {
    some: {
      role: {
        permissions: {
          some: { permission: { slug: "communications.read" } },
        },
      },
    },
  },
} satisfies Prisma.UserWhereInput;
