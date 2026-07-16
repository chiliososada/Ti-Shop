import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/server/auth/auth";
import { safeCallbackPath } from "@/server/auth/callback-url";
import { getDb } from "@/server/db/client";

export async function getActiveSession(requestHeaders: Headers) {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const account = await getDb().user.findUnique({
    where: { id: session.user.id },
    select: { disabledAt: true },
  });
  if (!account || account.disabledAt !== null) {
    // The disabling transaction normally removes every session. This cleanup
    // also rejects an anomalous/stale row instead of trusting cookie state.
    await getDb().session.deleteMany({
      where: { id: session.session.id, userId: session.user.id },
    });
    return null;
  }
  return session;
}

export const getCurrentSession = cache(async () => {
  return getActiveSession(await headers());
});

export async function requireUser(returnTo = "/account") {
  const session = await getCurrentSession();

  if (!session) {
    const callbackUrl = safeCallbackPath(returnTo);
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  return session;
}
