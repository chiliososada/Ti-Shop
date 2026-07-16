import "server-only";

import { cache } from "react";

import { Prisma } from "@/generated/prisma/client";
import {
  defaultsForCreatedAddress,
  defaultsToTransferAfterDelete,
} from "@/server/account/address-default-policy";
import type {
  AddressFormInput,
  UpdateAddressInput,
} from "@/server/account/address-validators";
import { addressIdSchema } from "@/server/account/address-validators";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { withSerializableRetry } from "@/server/orders/retry";

export const MAX_ACTIVE_CUSTOMER_ADDRESSES = 20;

const addressSelect = {
  id: true,
  label: true,
  recipientName: true,
  company: true,
  line1: true,
  line2: true,
  city: true,
  region: true,
  postalCode: true,
  countryCode: true,
  phone: true,
  isDefaultShipping: true,
  isDefaultBilling: true,
  createdAt: true,
  updatedAt: true,
} as const;

function addressDto(address: {
  id: bigint;
  label: string | null;
  recipientName: string;
  company: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
  phone: string | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...address,
    id: address.id.toString(),
  };
}

export type CustomerAddressDto = ReturnType<typeof addressDto>;

export const getCurrentCustomerAddresses = cache(async () => {
  const session = await requireUser("/account/addresses");
  const addresses = await getDb().address.findMany({
    where: { userId: session.user.id, deletedAt: null },
    orderBy: [
      { isDefaultShipping: "desc" },
      { isDefaultBilling: "desc" },
      { updatedAt: "desc" },
      { id: "desc" },
    ],
    select: addressSelect,
  });

  return addresses.map(addressDto);
});

export async function getDefaultShippingAddressForUser(userId: string) {
  const address = await getDb().address.findFirst({
    where: { userId, deletedAt: null },
    orderBy: [
      { isDefaultShipping: "desc" },
      { updatedAt: "desc" },
      { id: "desc" },
    ],
    select: addressSelect,
  });
  return address ? addressDto(address) : null;
}

export const getCurrentCustomerAddress = cache(async (rawAddressId: string) => {
  const session = await requireUser(`/account/addresses/${rawAddressId}`);
  const parsedId = addressIdSchema.safeParse(rawAddressId);
  if (!parsedId.success) return null;

  const address = await getDb().address.findFirst({
    where: {
      id: parsedId.data,
      userId: session.user.id,
      deletedAt: null,
    },
    select: addressSelect,
  });

  return address ? addressDto(address) : null;
});

function addressData(input: AddressFormInput | UpdateAddressInput) {
  return {
    label: input.label,
    recipientName: input.recipientName,
    company: input.company,
    line1: input.line1,
    line2: input.line2,
    city: input.city,
    region: input.region,
    postalCode: input.postalCode,
    countryCode: "US",
    phone: input.phone,
  } as const;
}

export async function createCurrentCustomerAddress(input: AddressFormInput) {
  const session = await requireUser("/account/addresses");

  return withSerializableRetry(() =>
    getDb().$transaction(
      async (tx) => {
        const existingRequest = await tx.address.findUnique({
          where: {
            userId_createRequestId: {
              userId: session.user.id,
              createRequestId: input.submissionId,
            },
          },
          select: { id: true },
        });
        if (existingRequest) {
          return {
            ok: true as const,
            duplicate: true,
            addressId: existingRequest.id.toString(),
          };
        }

        const activeAddressCount = await tx.address.count({
          where: { userId: session.user.id, deletedAt: null },
        });
        if (activeAddressCount >= MAX_ACTIVE_CUSTOMER_ADDRESSES) {
          return { ok: false as const, reason: "limit" as const };
        }

        const defaults = defaultsForCreatedAddress(activeAddressCount, input);
        if (defaults.isDefaultShipping) {
          await tx.address.updateMany({
            where: {
              userId: session.user.id,
              deletedAt: null,
              isDefaultShipping: true,
            },
            data: { isDefaultShipping: false },
          });
        }
        if (defaults.isDefaultBilling) {
          await tx.address.updateMany({
            where: {
              userId: session.user.id,
              deletedAt: null,
              isDefaultBilling: true,
            },
            data: { isDefaultBilling: false },
          });
        }

        const created = await tx.address.create({
          data: {
            userId: session.user.id,
            createRequestId: input.submissionId,
            ...addressData(input),
            ...defaults,
          },
          select: { id: true },
        });

        return {
          ok: true as const,
          duplicate: false,
          addressId: created.id.toString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function updateCurrentCustomerAddress(input: UpdateAddressInput) {
  const session = await requireUser(`/account/addresses/${input.addressId}`);

  return getDb().$transaction(
    async (tx) => {
      const existing = await tx.address.findFirst({
        where: {
          id: input.addressId,
          userId: session.user.id,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!existing) return { ok: false as const, reason: "not_found" as const };

      if (input.isDefaultShipping) {
        await tx.address.updateMany({
          where: {
            userId: session.user.id,
            deletedAt: null,
            isDefaultShipping: true,
            id: { not: existing.id },
          },
          data: { isDefaultShipping: false },
        });
      }
      if (input.isDefaultBilling) {
        await tx.address.updateMany({
          where: {
            userId: session.user.id,
            deletedAt: null,
            isDefaultBilling: true,
            id: { not: existing.id },
          },
          data: { isDefaultBilling: false },
        });
      }

      const updated = await tx.address.updateMany({
        where: {
          id: existing.id,
          userId: session.user.id,
          deletedAt: null,
        },
        data: {
          ...addressData(input),
          isDefaultShipping: input.isDefaultShipping,
          isDefaultBilling: input.isDefaultBilling,
        },
      });
      if (updated.count !== 1) {
        return { ok: false as const, reason: "not_found" as const };
      }

      return { ok: true as const, addressId: existing.id.toString() };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function softDeleteCurrentCustomerAddress(addressId: bigint) {
  const session = await requireUser(`/account/addresses/${addressId}`);

  return getDb().$transaction(
    async (tx) => {
      const existing = await tx.address.findFirst({
        where: { id: addressId, userId: session.user.id, deletedAt: null },
        select: {
          id: true,
          isDefaultShipping: true,
          isDefaultBilling: true,
        },
      });
      if (!existing) return { ok: false as const, reason: "not_found" as const };

      const fallback = await tx.address.findFirst({
        where: {
          userId: session.user.id,
          deletedAt: null,
          id: { not: existing.id },
        },
        orderBy: [
          { isDefaultShipping: "desc" },
          { isDefaultBilling: "desc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        select: { id: true },
      });

      const removed = await tx.address.updateMany({
        where: {
          id: existing.id,
          userId: session.user.id,
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
          isDefaultShipping: false,
          isDefaultBilling: false,
        },
      });
      if (removed.count !== 1) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const transfer = defaultsToTransferAfterDelete(existing);
      if (
        fallback &&
        (transfer.isDefaultShipping || transfer.isDefaultBilling)
      ) {
        await tx.address.updateMany({
          where: {
            id: fallback.id,
            userId: session.user.id,
            deletedAt: null,
          },
          data: {
            ...(transfer.isDefaultShipping
              ? { isDefaultShipping: true }
              : {}),
            ...(transfer.isDefaultBilling ? { isDefaultBilling: true } : {}),
          },
        });
      }

      return { ok: true as const, addressId: existing.id.toString() };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
