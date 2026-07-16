import "server-only";

import {
  InventoryMovementType,
  Prisma,
} from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import {
  calculateInventoryAdjustment,
  inventoryAdjustmentIdempotencyKey,
} from "@/server/admin/inventory/logic";
import type {
  AdjustInventoryInput,
  CreateLocationInput,
  UpdateLocationInput,
} from "@/server/admin/inventory/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

const locationAuditSelect = {
  publicId: true,
  code: true,
  name: true,
  countryCode: true,
  region: true,
  city: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type LockedTarget = {
  locationId: bigint;
  locationPublicId: string;
  locationCode: string;
  variantId: bigint;
  variantPublicId: string;
  variantTitle: string;
  productTitle: string;
};

type LockedLevel = {
  id: bigint;
  onHandQuantity: number;
  reservedQuantity: number;
  safetyStockQuantity: number;
  allowBackorder: boolean;
};

export async function createAdminInventoryLocation(
  input: CreateLocationInput,
) {
  const authorization = await requirePermission(
    "inventory.manage",
    "/admin/inventory",
  );

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const after = await tx.inventoryLocation.create({
          data: {
            code: input.code,
            name: input.name,
            countryCode: "US",
            region: input.region,
            city: input.city,
            isActive: input.isActive,
          },
          select: locationAuditSelect,
        });

        await writeAdminAuditLog(tx, {
          actorUserId: authorization.session.user.id,
          action: "inventory.location.create",
          resourceType: "inventory_location",
          resourceId: after.publicId,
          before: { exists: false },
          after,
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "inventory_location",
            aggregateId: after.publicId,
            eventType: "inventory.location.created",
            payload: {
              publicId: after.publicId,
              code: after.code,
              countryCode: "US",
              isActive: after.isActive,
            },
          },
          select: { id: true },
        });

        return { ok: true as const, publicId: after.publicId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function updateAdminInventoryLocation(
  input: UpdateLocationInput,
) {
  const returnTo = `/admin/inventory/locations/${input.publicId}`;
  const authorization = await requirePermission("inventory.manage", returnTo);

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
          SELECT location."id"
          FROM "app"."inventory_locations" AS location
          WHERE location."public_id" = ${input.publicId}::uuid
            AND location."country_code" = 'US'
          FOR UPDATE OF location
        `;
        if (!locked[0]) {
          return { ok: false as const, reason: "not_found" as const };
        }

        const existing = await tx.inventoryLocation.findUniqueOrThrow({
          where: { id: locked[0].id },
          select: locationAuditSelect,
        });
        const after = await tx.inventoryLocation.update({
          where: { id: locked[0].id },
          data: {
            code: input.code,
            name: input.name,
            countryCode: "US",
            region: input.region,
            city: input.city,
            isActive: input.isActive,
          },
          select: locationAuditSelect,
        });

        await writeAdminAuditLog(tx, {
          actorUserId: authorization.session.user.id,
          action: "inventory.location.update",
          resourceType: "inventory_location",
          resourceId: input.publicId,
          before: existing,
          after,
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "inventory_location",
            aggregateId: input.publicId,
            eventType: "inventory.location.updated",
            payload: {
              publicId: input.publicId,
              code: after.code,
              countryCode: "US",
              isActive: after.isActive,
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

export async function adjustAdminInventory(input: AdjustInventoryInput) {
  const authorization = await requirePermission(
    "inventory.manage",
    "/admin/inventory",
  );
  const actorUserId = authorization.session.user.id;
  const idempotencyKey = inventoryAdjustmentIdempotencyKey(
    actorUserId,
    input.idempotencyKey,
  );
  const referenceId = `${input.locationPublicId}:${input.variantPublicId}`;

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const prior = await tx.inventoryMovement.findUnique({
          where: { idempotencyKey },
          select: {
            publicId: true,
            createdByUserId: true,
            referenceType: true,
            referenceId: true,
            quantityDelta: true,
            onHandAfter: true,
            reason: true,
          },
        });
        if (prior) {
          const isSameSubmission =
            prior.createdByUserId === actorUserId &&
            prior.referenceType === "admin_inventory_adjustment" &&
            prior.referenceId === referenceId &&
            prior.quantityDelta === input.quantityDelta &&
            prior.reason === input.reason;
          return isSameSubmission
            ? {
                ok: true as const,
                duplicate: true,
                movementPublicId: prior.publicId,
                onHandAfter: prior.onHandAfter,
              }
            : {
                ok: false as const,
                reason: "idempotency_conflict" as const,
              };
        }

        // Lock both public resources before an inventory level is initialized.
        // This makes concurrent first adjustments serialize on the same pair.
        const targets = await tx.$queryRaw<LockedTarget[]>`
          SELECT
            location."id" AS "locationId",
            location."public_id" AS "locationPublicId",
            location."code" AS "locationCode",
            variant."id" AS "variantId",
            variant."public_id" AS "variantPublicId",
            variant."title" AS "variantTitle",
            product."title" AS "productTitle"
          FROM "app"."inventory_locations" AS location
          CROSS JOIN "app"."product_variants" AS variant
          INNER JOIN "app"."products" AS product
            ON product."id" = variant."product_id"
          WHERE location."public_id" = ${input.locationPublicId}::uuid
            AND location."country_code" = 'US'
            AND variant."public_id" = ${input.variantPublicId}::uuid
            AND variant."deleted_at" IS NULL
            AND product."deleted_at" IS NULL
          FOR UPDATE OF location, variant
        `;
        const target = targets[0];
        if (!target) {
          return { ok: false as const, reason: "not_found" as const };
        }

        const existingLevel = await tx.inventoryLevel.findUnique({
          where: {
            variantId_locationId: {
              variantId: target.variantId,
              locationId: target.locationId,
            },
          },
          select: { id: true },
        });
        if (!existingLevel && input.quantityDelta < 0) {
          return { ok: false as const, reason: "negative_on_hand" as const };
        }
        const initialized =
          existingLevel ??
          (await tx.inventoryLevel.create({
            data: {
              variantId: target.variantId,
              locationId: target.locationId,
              onHandQuantity: 0,
              reservedQuantity: 0,
              safetyStockQuantity: 0,
              allowBackorder: false,
            },
            select: { id: true },
          }));
        const levels = await tx.$queryRaw<LockedLevel[]>`
          SELECT
            level."id",
            level."on_hand_quantity" AS "onHandQuantity",
            level."reserved_quantity" AS "reservedQuantity",
            level."safety_stock_quantity" AS "safetyStockQuantity",
            level."allow_backorder" AS "allowBackorder"
          FROM "app"."inventory_levels" AS level
          WHERE level."id" = ${initialized.id}
          FOR UPDATE OF level
        `;
        const level = levels[0];
        if (!level) {
          throw new Error("Locked inventory level disappeared.");
        }

        const adjusted = calculateInventoryAdjustment({
          onHandQuantity: level.onHandQuantity,
          reservedQuantity: level.reservedQuantity,
          allowBackorder: level.allowBackorder,
          quantityDelta: input.quantityDelta,
        });
        if (!adjusted.ok) {
          return { ok: false as const, reason: adjusted.reason };
        }

        await tx.inventoryLevel.update({
          where: { id: level.id },
          data: { onHandQuantity: adjusted.onHandAfter },
          select: { id: true },
        });
        const movement = await tx.inventoryMovement.create({
          data: {
            inventoryLevelId: level.id,
            idempotencyKey,
            type: InventoryMovementType.ADJUSTMENT,
            quantityDelta: input.quantityDelta,
            onHandAfter: adjusted.onHandAfter,
            referenceType: "admin_inventory_adjustment",
            referenceId,
            reason: input.reason,
            createdByUserId: actorUserId,
          },
          select: { publicId: true },
        });

        const before = {
          locationPublicId: target.locationPublicId,
          locationCode: target.locationCode,
          variantPublicId: target.variantPublicId,
          productTitle: target.productTitle,
          variantTitle: target.variantTitle,
          onHandQuantity: level.onHandQuantity,
          reservedQuantity: level.reservedQuantity,
          safetyStockQuantity: level.safetyStockQuantity,
          allowBackorder: level.allowBackorder,
        };
        const after = {
          ...before,
          onHandQuantity: adjusted.onHandAfter,
          quantityDelta: input.quantityDelta,
          reason: input.reason,
          movementPublicId: movement.publicId,
        };
        await writeAdminAuditLog(tx, {
          actorUserId,
          action: "inventory.level.adjust",
          resourceType: "inventory_level",
          resourceId: referenceId,
          before,
          after,
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "inventory_level",
            aggregateId: referenceId,
            eventType: "inventory.level.adjusted",
            payload: {
              locationPublicId: target.locationPublicId,
              variantPublicId: target.variantPublicId,
              movementPublicId: movement.publicId,
              quantityDelta: input.quantityDelta,
              onHandAfter: adjusted.onHandAfter,
            },
          },
          select: { id: true },
        });

        return {
          ok: true as const,
          duplicate: false,
          movementPublicId: movement.publicId,
          onHandAfter: adjusted.onHandAfter,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
