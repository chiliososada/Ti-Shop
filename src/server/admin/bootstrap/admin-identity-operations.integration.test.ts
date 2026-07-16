import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  grantOwnerAccess,
  verifyUserEmailOutOfBand,
} from "../../../../scripts/lib/admin-identity-operations";
import { getDb } from "@/server/db/client";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("administrator identity bootstrap operations", () => {
  const suffix = randomUUID();
  const email = `bootstrap-${suffix}@example.invalid`;
  let userId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const user = await getDb().user.create({
      data: {
        name: "Bootstrap integration user",
        email,
        emailVerified: false,
      },
      select: { id: true },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (!userId) return;
    const db = getDb();
    await db.auditLog.deleteMany({
      where: { resourceType: "user", resourceId: userId },
    });
    await db.user.deleteMany({ where: { id: userId } });
  });

  it("requires exact verified identity, audits out-of-band verification, and grants owner idempotently", async () => {
    const db = getDb();

    await expect(
      grantOwnerAccess(db, { userId, email }),
    ).rejects.toMatchObject({ code: "email_unverified" });
    await expect(
      verifyUserEmailOutOfBand(db, {
        userId,
        email: `wrong-${email}`,
      }),
    ).rejects.toMatchObject({ code: "identity_mismatch" });

    const verified = await verifyUserEmailOutOfBand(db, { userId, email });
    const reconfirmed = await verifyUserEmailOutOfBand(db, { userId, email });
    const granted = await grantOwnerAccess(db, { userId, email });
    const replayed = await grantOwnerAccess(db, { userId, email });

    expect(verified).toMatchObject({ userId, duplicate: false });
    expect(reconfirmed).toMatchObject({ userId, duplicate: true });
    expect(granted).toMatchObject({ userId, duplicate: false });
    expect(replayed).toMatchObject({ userId, duplicate: true });

    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        emailVerified: true,
        adminProfile: { select: { isActive: true } },
        roleAssignments: {
          where: { role: { slug: "owner", isSystem: true } },
          select: { role: { select: { slug: true } } },
        },
      },
    });
    const auditRows = await db.auditLog.findMany({
      where: { resourceType: "user", resourceId: userId },
      orderBy: { id: "asc" },
      select: {
        action: true,
        before: true,
        after: true,
        metadata: true,
      },
    });

    expect(user).toEqual({
      emailVerified: true,
      adminProfile: { isActive: true },
      roleAssignments: [{ role: { slug: "owner" } }],
    });
    expect(auditRows.map(({ action }) => action)).toEqual([
      "security.user.email_verified_out_of_band",
      "security.user.email_verification_reconfirmed_out_of_band",
      "admin.owner_granted_cli",
      "admin.owner_grant_confirmed_cli",
    ]);
    const serializedAudit = JSON.stringify(auditRows);
    expect(serializedAudit).not.toContain(email);
    expect(serializedAudit).not.toMatch(/password|session|token/iu);
  });
});
