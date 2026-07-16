import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type {
  CheckoutChargesInput,
  OnlinePaymentSwitchInput,
  PaymentMethodConfigInput,
} from "@/server/admin/payments/validators";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

const ONLINE_PAYMENT_SWITCH_KEY = "commerce.online_payments_enabled";
const CHECKOUT_CHARGES_KEY = "commerce.checkout_charges";

const paymentMethodAuditSelect = {
  method: true,
  displayName: true,
  isEnabled: true,
  publicInstructions: true,
  updatedByUserId: true,
  updatedAt: true,
} as const;

type PaymentMethodAuditRecord = {
  method: string;
  displayName: string;
  isEnabled: boolean;
  publicInstructions: string | null;
  updatedByUserId: string | null;
  updatedAt: Date;
};

function paymentMethodAuditSnapshot(value: PaymentMethodAuditRecord) {
  return {
    method: value.method,
    displayName: value.displayName,
    isEnabled: value.isEnabled,
    hasPublicInstructions: Boolean(value.publicInstructions?.trim()),
    updatedByUserId: value.updatedByUserId,
    updatedAt: value.updatedAt,
  };
}

const settingAuditSelect = {
  key: true,
  value: true,
  description: true,
  isPublic: true,
  updatedByUserId: true,
  updatedAt: true,
} as const;

export async function updateAdminPaymentMethodConfig(
  input: PaymentMethodConfigInput,
) {
  const authorization = await requirePermission(
    "payments.manage",
    "/admin/payments",
  );

  return getDb().$transaction(
    async (tx) => {
      const existing = await tx.paymentMethodConfig.findUnique({
        where: { method: input.method },
        select: { id: true, ...paymentMethodAuditSelect },
      });
      if (!existing) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const after = await tx.paymentMethodConfig.update({
        where: { id: existing.id },
        data: {
          displayName: input.displayName,
          isEnabled: input.isEnabled,
          publicInstructions: input.publicInstructions,
          updatedByUserId: authorization.session.user.id,
        },
        select: paymentMethodAuditSelect,
      });

      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "payments.method_config.update",
        resourceType: "payment_method_config",
        resourceId: input.method,
        before: paymentMethodAuditSnapshot(existing),
        after: paymentMethodAuditSnapshot(after),
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "payment_method_config",
          aggregateId: input.method,
          eventType: "payment_method_config.updated",
          payload: {
            method: input.method,
            isEnabled: after.isEnabled,
          },
        },
        select: { id: true },
      });

      return { ok: true as const, method: input.method };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function updateAdminOnlinePaymentSwitch(
  input: OnlinePaymentSwitchInput,
) {
  const authorization = await requirePermission(
    "settings.manage",
    "/admin/payments",
  );

  return getDb().$transaction(
    async (tx) => {
      const existing = await tx.siteSetting.findUnique({
        where: { key: ONLINE_PAYMENT_SWITCH_KEY },
        select: settingAuditSelect,
      });
      if (!existing) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const after = await tx.siteSetting.update({
        where: { key: ONLINE_PAYMENT_SWITCH_KEY },
        data: {
          value: input.isEnabled,
          updatedByUserId: authorization.session.user.id,
        },
        select: settingAuditSelect,
      });

      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "settings.online_payments.update",
        resourceType: "site_setting",
        resourceId: ONLINE_PAYMENT_SWITCH_KEY,
        before: existing,
        after,
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "site_setting",
          aggregateId: ONLINE_PAYMENT_SWITCH_KEY,
          eventType: "commerce.online_payments.updated",
          payload: { isEnabled: input.isEnabled },
        },
        select: { id: true },
      });

      return { ok: true as const, isEnabled: input.isEnabled };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function updateAdminCheckoutCharges(input: CheckoutChargesInput) {
  const authorization = await requirePermission(
    "settings.manage",
    "/admin/payments",
  );

  return getDb().$transaction(
    async (tx) => {
      const existing = await tx.siteSetting.findUnique({
        where: { key: CHECKOUT_CHARGES_KEY },
        select: settingAuditSelect,
      });
      if (!existing) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const value = {
        configured: input.configured,
        shippingFlatMinor: input.shippingFlatMinor,
        taxRateBps: input.taxRateBps,
      };
      const after = await tx.siteSetting.update({
        where: { key: CHECKOUT_CHARGES_KEY },
        data: {
          value,
          updatedByUserId: authorization.session.user.id,
        },
        select: settingAuditSelect,
      });

      await writeAdminAuditLog(tx, {
        actorUserId: authorization.session.user.id,
        action: "settings.checkout_charges.update",
        resourceType: "site_setting",
        resourceId: CHECKOUT_CHARGES_KEY,
        before: existing,
        after,
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "site_setting",
          aggregateId: CHECKOUT_CHARGES_KEY,
          eventType: "commerce.checkout_charges.updated",
          payload: value,
        },
        select: { id: true },
      });

      return { ok: true as const };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
