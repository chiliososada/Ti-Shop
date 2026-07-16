import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { buildPagination, type SearchParameter } from "@/lib/pagination";
import { publicIdSchema } from "@/server/admin/audit/validation";
import {
  ADMIN_CUSTOMER_PAGE_SIZE,
  parseAdminCustomerFilters,
} from "@/server/admin/customers/filters";
import { summarizeWhatsAppSourceArea } from "@/server/admin/customers/summaries";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

export async function getAdminCustomerIndex(
  searchParams: Record<string, SearchParameter> = {},
) {
  const authorization = await requirePermission(
    "customers.read",
    "/admin/customers",
  );
  const { filters, validationError } = parseAdminCustomerFilters(searchParams);
  const where: Prisma.UserWhereInput = {
    customerProfile: { isNot: null },
    // Customer-management permission must not become an alternate path for
    // modifying administrator identities.
    adminProfile: null,
    roleAssignments: { none: {} },
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" } },
            { email: { contains: filters.q, mode: "insensitive" } },
            {
              customerProfile: {
                is: {
                  OR: [
                    {
                      firstName: {
                        contains: filters.q,
                        mode: "insensitive",
                      },
                    },
                    {
                      lastName: {
                        contains: filters.q,
                        mode: "insensitive",
                      },
                    },
                    {
                      phone: {
                        contains: filters.q,
                        mode: "insensitive",
                      },
                    },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
  const db = getDb();
  const total = await db.user.count({ where });
  const pagination = buildPagination(
    total,
    filters.page,
    ADMIN_CUSTOMER_PAGE_SIZE,
  );
  const rows = await db.user.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.pageSize,
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      disabledAt: true,
      createdAt: true,
      updatedAt: true,
      customerProfile: {
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          countryCode: true,
        },
      },
      _count: {
        select: {
          addresses: { where: { deletedAt: null } },
          orders: true,
          inquiries: true,
          whatsappIntents: true,
        },
      },
    },
  });

  return {
    canManage: authorization.permissions.has("customers.manage"),
    filters: { ...filters, page: pagination.page },
    validationError,
    pagination,
    customers: rows.map((row) => ({
      publicId: row.id,
      name: row.name,
      email: row.email,
      emailVerified: row.emailVerified,
      isDisabled: row.disabledAt !== null,
      firstName: row.customerProfile?.firstName ?? null,
      lastName: row.customerProfile?.lastName ?? null,
      phone: row.customerProfile?.phone ?? null,
      countryCode: row.customerProfile?.countryCode ?? "US",
      addressCount: row._count.addresses,
      orderCount: row._count.orders,
      inquiryCount: row._count.inquiries,
      whatsappIntentCount: row._count.whatsappIntents,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

export async function getAdminCustomer(candidatePublicId: string) {
  const parsedId = publicIdSchema.safeParse(candidatePublicId);
  const returnTo = parsedId.success
    ? `/admin/customers/${parsedId.data}`
    : "/admin/customers";
  const authorization = await requirePermission("customers.read", returnTo);
  await requirePermission("orders.read", returnTo);
  if (!parsedId.success) return null;

  const row = await getDb().user.findFirst({
    where: {
      id: parsedId.data,
      customerProfile: { isNot: null },
      adminProfile: null,
      roleAssignments: { none: {} },
    },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      disabledAt: true,
      disabledReason: true,
      disabledBy: {
        select: { id: true, name: true, email: true },
      },
      createdAt: true,
      updatedAt: true,
      customerProfile: {
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          preferredCurrency: true,
          countryCode: true,
          locale: true,
          marketingConsent: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      addresses: {
        where: { deletedAt: null },
        orderBy: [
          { isDefaultShipping: "desc" },
          { isDefaultBilling: "desc" },
          { createdAt: "desc" },
        ],
        take: 100,
        select: {
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
        },
      },
      orders: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          publicId: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          currency: true,
          totalMinor: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { items: true, shipments: true } },
        },
      },
      whatsappIntents: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          publicId: true,
          sourcePath: true,
          messageTemplateKey: true,
          openedAt: true,
          createdAt: true,
          order: { select: { publicId: true, orderNumber: true } },
          product: { select: { publicId: true, title: true } },
          inquiry: { select: { publicId: true, inquiryNumber: true } },
        },
      },
      inquiries: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          publicId: true,
          inquiryNumber: true,
          source: true,
          status: true,
          resolvedAt: true,
          closedAt: true,
          createdAt: true,
          updatedAt: true,
          order: { select: { publicId: true, orderNumber: true } },
          product: { select: { publicId: true, title: true } },
        },
      },
      _count: {
        select: {
          addresses: { where: { deletedAt: null } },
          orders: true,
          inquiries: true,
          whatsappIntents: true,
        },
      },
    },
  });
  if (!row || !row.customerProfile) return null;

  return {
    canManage: authorization.permissions.has("customers.manage"),
    publicId: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    profile: {
      firstName: row.customerProfile.firstName,
      lastName: row.customerProfile.lastName,
      phone: row.customerProfile.phone,
      preferredCurrency: row.customerProfile.preferredCurrency,
      countryCode: row.customerProfile.countryCode,
      locale: row.customerProfile.locale,
      marketingConsent: row.customerProfile.marketingConsent,
      createdAt: row.customerProfile.createdAt.toISOString(),
      updatedAt: row.customerProfile.updatedAt.toISOString(),
    },
    counts: {
      addresses: row._count.addresses,
      orders: row._count.orders,
      inquiries: row._count.inquiries,
      whatsappIntents: row._count.whatsappIntents,
    },
    addresses: row.addresses.map((address) => ({
      ...address,
      createdAt: address.createdAt.toISOString(),
      updatedAt: address.updatedAt.toISOString(),
    })),
    orders: row.orders.map((order) => ({
      publicId: order.publicId,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      currency: order.currency,
      totalMinor: order.totalMinor.toString(),
      itemCount: order._count.items,
      shipmentCount: order._count.shipments,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    })),
    whatsappIntents: row.whatsappIntents.map((intent) => ({
      publicId: intent.publicId,
      sourceArea: summarizeWhatsAppSourceArea(intent.sourcePath),
      hasMessageTemplate: intent.messageTemplateKey !== null,
      wasOpened: intent.openedAt !== null,
      openedAt: iso(intent.openedAt),
      createdAt: intent.createdAt.toISOString(),
      order: intent.order,
      product: intent.product,
      inquiry: intent.inquiry,
    })),
    inquiries: row.inquiries.map((inquiry) => ({
      publicId: inquiry.publicId,
      inquiryNumber: inquiry.inquiryNumber,
      source: inquiry.source,
      status: inquiry.status,
      resolvedAt: iso(inquiry.resolvedAt),
      closedAt: iso(inquiry.closedAt),
      createdAt: inquiry.createdAt.toISOString(),
      updatedAt: inquiry.updatedAt.toISOString(),
      order: inquiry.order,
      product: inquiry.product,
    })),
    accountControls: {
      canManage:
        authorization.permissions.has("users.manage") &&
        authorization.permissions.has("orders.read"),
      isDisabled: row.disabledAt !== null,
      disabledAt: iso(row.disabledAt),
      disabledReason: row.disabledReason,
      disabledBy: row.disabledBy
        ? {
            publicId: row.disabledBy.id,
            name: row.disabledBy.name,
            email: row.disabledBy.email,
          }
        : null,
    },
  };
}
