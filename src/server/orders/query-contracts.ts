import type { Prisma } from "@/generated/prisma/client";

export function buildOwnedOrderWhere(
  userId: string,
  publicId?: string,
): Prisma.OrderWhereInput {
  return publicId ? { userId, publicId } : { userId };
}

