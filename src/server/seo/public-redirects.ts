import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import {
  isRedirectablePublicPath,
  isSafeRootRelativePath,
} from "@/server/seo/redirect-policy";

export type ActivePublicRedirect = {
  id: bigint;
  destinationPath: string;
  statusCode: 301 | 308;
  preserveQuery: boolean;
};

function activeWindow(now: Date): Prisma.RedirectWhereInput {
  return {
    isActive: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ],
  };
}

export async function findActivePublicRedirect(
  pathname: string,
): Promise<ActivePublicRedirect | null> {
  if (!isRedirectablePublicPath(pathname)) return null;

  const db = getDb();
  const now = new Date();
  const redirect = await db.redirect.findFirst({
    where: { sourcePath: pathname, ...activeWindow(now) },
    select: {
      id: true,
      destinationPath: true,
      statusCode: true,
      preserveQuery: true,
    },
  });
  if (
    !redirect ||
    !isSafeRootRelativePath(redirect.destinationPath) ||
    (redirect.statusCode !== 301 && redirect.statusCode !== 308) ||
    redirect.destinationPath === pathname
  ) {
    return null;
  }

  // Admin writes reject cycles. This bounded read also fails open if legacy or
  // manually inserted rows form an active cycle or an excessive redirect chain.
  const seen = new Set([pathname]);
  let nextPath = redirect.destinationPath;
  for (let depth = 0; depth < 32; depth += 1) {
    if (seen.has(nextPath)) return null;
    seen.add(nextPath);
    const next = await db.redirect.findFirst({
      where: { sourcePath: nextPath, ...activeWindow(now) },
      select: { destinationPath: true, statusCode: true },
    });
    if (!next) {
      return {
        id: redirect.id,
        destinationPath: redirect.destinationPath,
        statusCode: redirect.statusCode,
        preserveQuery: redirect.preserveQuery,
      };
    }
    if (
      !isSafeRootRelativePath(next.destinationPath) ||
      (next.statusCode !== 301 && next.statusCode !== 308)
    ) {
      return null;
    }
    nextPath = next.destinationPath;
  }
  return null;
}

export async function recordPublicRedirectHit(id: bigint): Promise<void> {
  try {
    await getDb().redirect.update({
      where: { id },
      data: { hitCount: { increment: BigInt(1) }, lastHitAt: new Date() },
      select: { id: true },
    });
  } catch (error) {
    console.error("Redirect hit counter update failed.", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
  }
}
