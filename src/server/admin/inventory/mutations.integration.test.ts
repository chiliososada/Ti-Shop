import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ actorUserId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/rbac", () => ({
  requirePermission: vi.fn(async () => ({
    session: { user: { id: authorization.actorUserId } },
    roles: ["integration-test"],
    permissions: new Set(["inventory.read", "inventory.manage"]),
  })),
}));

import { getDb } from "@/server/db/client";
import {
  adjustAdminInventory,
  createAdminInventoryLocation,
  updateAdminInventoryLocation,
} from "@/server/admin/inventory/mutations";

const databaseUrl = process.env.ADMIN_DB_INTEGRATION_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("inventory admin database invariants", () => {
  const suffix = randomUUID();
  const actorEmail = `inventory-admin-${suffix}@example.invalid`;
  let actorUserId = "";
  let locationPublicId = "";
  let productPublicId = "";
  let variantPublicId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = getDb();
    const [actor, product] = await Promise.all([
      db.user.create({
        data: { name: "Inventory integration admin", email: actorEmail },
        select: { id: true },
      }),
      db.product.create({
        data: {
          slug: `inventory-integration-${suffix}`,
          title: "Inventory integration product",
          variants: {
            create: {
              title: "Inventory integration variant",
            },
          },
        },
        select: {
          publicId: true,
          variants: { select: { publicId: true } },
        },
      }),
    ]);
    actorUserId = actor.id;
    authorization.actorUserId = actor.id;
    productPublicId = product.publicId;
    variantPublicId = product.variants[0].publicId;
  });

  afterAll(async () => {
    if (!actorUserId) return;
    const db = getDb();
    await db.auditLog.deleteMany({ where: { actorUserId } });
    if (locationPublicId) {
      await db.outboxEvent.deleteMany({
        where: {
          aggregateId: {
            in: [
              locationPublicId,
              `${locationPublicId}:${variantPublicId}`,
            ],
          },
        },
      });
    }
    await db.inventoryMovement.deleteMany({
      where: { createdByUserId: actorUserId },
    });
    if (locationPublicId) {
      const location = await db.inventoryLocation.findUnique({
        where: { publicId: locationPublicId },
        select: { id: true },
      });
      if (location) {
        await db.inventoryLevel.deleteMany({
          where: { locationId: location.id },
        });
        await db.inventoryLocation.delete({ where: { id: location.id } });
      }
    }
    if (variantPublicId) {
      await db.productVariant.deleteMany({
        where: { publicId: variantPublicId },
      });
    }
    if (productPublicId) {
      await db.product.deleteMany({
        where: { publicId: productPublicId },
      });
    }
    await db.user.deleteMany({ where: { id: actorUserId } });
  });

  it("audits location writes and makes stock adjustment submission idempotent", async () => {
    const created = await createAdminInventoryLocation({
      code: `IT-${suffix.slice(0, 8).toUpperCase()}`,
      name: "Integration test location",
      countryCode: "US",
      region: "California",
      city: "Los Angeles",
      isActive: true,
    });
    locationPublicId = created.publicId;

    const submissionId = randomUUID();
    const input = {
      idempotencyKey: submissionId,
      locationPublicId,
      variantPublicId,
      quantityDelta: 5,
      reason: "Integration-test receiving count.",
    } as const;
    const first = await adjustAdminInventory(input);
    const replay = await adjustAdminInventory(input);
    const rejected = await adjustAdminInventory({
      ...input,
      idempotencyKey: randomUUID(),
      quantityDelta: -6,
      reason: "Integration-test invalid reduction.",
    });
    const updated = await updateAdminInventoryLocation({
      publicId: locationPublicId,
      code: `IT-${suffix.slice(0, 8).toUpperCase()}`,
      name: "Renamed integration location",
      countryCode: "US",
      region: "California",
      city: "Los Angeles",
      isActive: false,
    });

    expect(first).toMatchObject({ ok: true, duplicate: false, onHandAfter: 5 });
    expect(replay).toMatchObject({ ok: true, duplicate: true, onHandAfter: 5 });
    expect(rejected).toEqual({ ok: false, reason: "negative_on_hand" });
    expect(updated).toEqual({ ok: true, publicId: locationPublicId });

    const db = getDb();
    const [level, movementCount, auditCount, outboxCount] = await Promise.all([
      db.inventoryLevel.findFirstOrThrow({
        where: {
          location: { publicId: locationPublicId },
          variant: { publicId: variantPublicId },
        },
        select: { onHandQuantity: true },
      }),
      db.inventoryMovement.count({ where: { createdByUserId: actorUserId } }),
      db.auditLog.count({ where: { actorUserId } }),
      // Scoped to this test's aggregates: the location emits created+updated,
      // the stock adjustment emits one event keyed by location:variant.
      db.outboxEvent.count({
        where: {
          aggregateId: {
            in: [locationPublicId, `${locationPublicId}:${variantPublicId}`],
          },
        },
      }),
    ]);
    expect(level.onHandQuantity).toBe(5);
    expect(movementCount).toBe(1);
    expect(auditCount).toBe(3);
    expect(outboxCount).toBe(3);
  });
});
