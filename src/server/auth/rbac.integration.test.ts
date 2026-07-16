import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getDb } from "@/server/db/client";
import { readAdminAuthorization } from "@/server/auth/rbac";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("administrator authorization identity boundary", () => {
  const suffix = randomUUID();
  let verifiedOwnerId = "";
  let legacyUnverifiedOwnerId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const ownerRole = await db.role.findFirstOrThrow({
      where: { slug: "owner", isSystem: true },
      select: { id: true },
    });
    const [verifiedOwner, legacyUnverifiedOwner] = await Promise.all([
      db.user.create({
        data: {
          name: "Verified RBAC integration owner",
          email: `rbac-verified-${suffix}@example.invalid`,
          emailVerified: true,
        },
        select: { id: true },
      }),
      db.user.create({
        data: {
          name: "Legacy unverified RBAC integration owner",
          email: `rbac-unverified-${suffix}@example.invalid`,
          emailVerified: false,
        },
        select: { id: true },
      }),
    ]);
    verifiedOwnerId = verifiedOwner.id;
    legacyUnverifiedOwnerId = legacyUnverifiedOwner.id;

    await db.adminProfile.createMany({
      data: [
        { userId: verifiedOwner.id, isActive: true },
        { userId: legacyUnverifiedOwner.id, isActive: true },
      ],
    });
    await db.userRole.createMany({
      data: [
        { userId: verifiedOwner.id, roleId: ownerRole.id },
        { userId: legacyUnverifiedOwner.id, roleId: ownerRole.id },
      ],
    });
  });

  afterAll(async () => {
    if (!verifiedOwnerId) return;
    await getDb().user.deleteMany({
      where: {
        id: { in: [verifiedOwnerId, legacyUnverifiedOwnerId].filter(Boolean) },
      },
    });
  });

  it("denies historical unverified administrators and restores access only after verification", async () => {
    const verified = await readAdminAuthorization(verifiedOwnerId);
    const historicalUnverified = await readAdminAuthorization(
      legacyUnverifiedOwnerId,
    );

    expect(verified.isActiveAdmin).toBe(true);
    expect(verified.roles).toContain("owner");
    expect(verified.permissions).toContain("admin.access");
    expect(historicalUnverified.isActiveAdmin).toBe(false);
    expect(historicalUnverified.roles).toContain("owner");
    expect(historicalUnverified.permissions).toContain("admin.access");

    await getDb().user.update({
      where: { id: legacyUnverifiedOwnerId },
      data: { emailVerified: true },
      select: { id: true },
    });
    const afterVerification = await readAdminAuthorization(
      legacyUnverifiedOwnerId,
    );
    expect(afterVerification.isActiveAdmin).toBe(true);
  });
});
