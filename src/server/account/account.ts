import "server-only";

import { cache } from "react";

import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";

export const getAccountOverview = cache(async () => {
  const session = await requireUser("/account");
  const db = getDb();

  const account = await db.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
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
      addresses: {
        where: { deletedAt: null },
        select: { id: true },
      },
    },
  });

  return {
    id: account.id,
    name: account.name,
    email: account.email,
    createdAt: account.createdAt,
    profile: account.customerProfile,
    addressCount: account.addresses.length,
  };
});
