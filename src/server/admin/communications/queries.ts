import "server-only";

import type { InquiryStatus, Prisma } from "@/generated/prisma/client";
import { buildPagination, type SearchParameter } from "@/lib/pagination";
import { publicIdSchema } from "@/server/admin/audit/validation";
import { summarizeWhatsAppSourceArea } from "@/server/admin/customers/summaries";
import { eligibleCommunicationAssigneeWhere } from "@/server/admin/communications/assignee-policy";
import {
  ADMIN_COMMUNICATIONS_PAGE_SIZE,
  parseAdminCommunicationsFilters,
} from "@/server/admin/communications/filters";
import { summarizeWhatsAppTemplateKey } from "@/server/admin/communications/summaries";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";

const safeIntentSelect = {
  publicId: true,
  sourcePath: true,
  messageTemplateKey: true,
  openedAt: true,
  createdAt: true,
  user: { select: { id: true, name: true } },
  cart: { select: { publicId: true } },
  order: {
    select: {
      publicId: true,
      orderNumber: true,
      userId: true,
      customerEmail: true,
      customerPhone: true,
    },
  },
  product: { select: { publicId: true, title: true, slug: true } },
  inquiry: {
    select: { publicId: true, inquiryNumber: true, status: true },
  },
} satisfies Prisma.WhatsAppContactIntentSelect;

type SafeIntentRow = Prisma.WhatsAppContactIntentGetPayload<{
  select: typeof safeIntentSelect;
}>;

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

function toSafeIntentDto(intent: SafeIntentRow) {
  return {
    publicId: intent.publicId,
    sourceArea: summarizeWhatsAppSourceArea(intent.sourcePath),
    templateKey: summarizeWhatsAppTemplateKey(intent.messageTemplateKey),
    wasOpened: intent.openedAt !== null,
    openedAt: iso(intent.openedAt),
    createdAt: intent.createdAt.toISOString(),
    customer: intent.user
      ? { publicId: intent.user.id, name: intent.user.name }
      : null,
    order: intent.order
      ? {
          publicId: intent.order.publicId,
          orderNumber: intent.order.orderNumber,
        }
      : null,
    product: intent.product,
    inquiry: intent.inquiry,
    hasCartContext: intent.cart !== null,
    canCreateFollowUp:
      intent.user !== null ||
      Boolean(intent.order?.customerEmail.trim()) ||
      Boolean(intent.order?.customerPhone?.trim()),
  };
}

function permissionAccess(permissions: ReadonlySet<string>) {
  return {
    canManage: permissions.has("communications.manage"),
    canReadCustomers: permissions.has("customers.read"),
    canReadOrders: permissions.has("orders.read"),
    canReadCatalog: permissions.has("catalog.read"),
  };
}

export async function getAdminCommunicationsIndex(
  searchParams: Record<string, SearchParameter> = {},
) {
  const authorization = await requirePermission(
    "communications.read",
    "/admin/communications",
  );
  const { filters, validationError } =
    parseAdminCommunicationsFilters(searchParams);
  const db = getDb();
  const inquiryWhere: Prisma.InquiryWhereInput = {
    ...(filters.inquiryStatus ? { status: filters.inquiryStatus } : {}),
    ...(filters.inquiryQuery
      ? {
          OR: [
            {
              inquiryNumber: {
                contains: filters.inquiryQuery,
                mode: "insensitive" as const,
              },
            },
            {
              subject: {
                contains: filters.inquiryQuery,
                mode: "insensitive" as const,
              },
            },
            {
              customerName: {
                contains: filters.inquiryQuery,
                mode: "insensitive" as const,
              },
            },
            {
              customerEmail: {
                contains: filters.inquiryQuery,
                mode: "insensitive" as const,
              },
            },
            {
              customer: {
                is: {
                  OR: [
                    {
                      name: {
                        contains: filters.inquiryQuery,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      email: {
                        contains: filters.inquiryQuery,
                        mode: "insensitive" as const,
                      },
                    },
                  ],
                },
              },
            },
            {
              order: {
                is: {
                  orderNumber: {
                    contains: filters.inquiryQuery,
                    mode: "insensitive" as const,
                  },
                },
              },
            },
            {
              product: {
                is: {
                  title: {
                    contains: filters.inquiryQuery,
                    mode: "insensitive" as const,
                  },
                },
              },
            },
          ],
        }
      : {}),
  };
  const intentWhere: Prisma.WhatsAppContactIntentWhereInput = {
    ...(filters.intentStatus === "OPENED"
      ? { openedAt: { not: null } }
      : filters.intentStatus === "RECORDED"
        ? { openedAt: null }
        : {}),
    ...(filters.intentQuery
      ? {
          OR: [
            {
              sourcePath: {
                contains: filters.intentQuery,
                mode: "insensitive" as const,
              },
            },
            {
              messageTemplateKey: {
                contains: filters.intentQuery,
                mode: "insensitive" as const,
              },
            },
            {
              user: {
                is: {
                  OR: [
                    {
                      name: {
                        contains: filters.intentQuery,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      email: {
                        contains: filters.intentQuery,
                        mode: "insensitive" as const,
                      },
                    },
                  ],
                },
              },
            },
            {
              order: {
                is: {
                  OR: [
                    {
                      orderNumber: {
                        contains: filters.intentQuery,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      customerEmail: {
                        contains: filters.intentQuery,
                        mode: "insensitive" as const,
                      },
                    },
                  ],
                },
              },
            },
            {
              product: {
                is: {
                  title: {
                    contains: filters.intentQuery,
                    mode: "insensitive" as const,
                  },
                },
              },
            },
            {
              inquiry: {
                is: {
                  inquiryNumber: {
                    contains: filters.intentQuery,
                    mode: "insensitive" as const,
                  },
                },
              },
            },
          ],
        }
      : {}),
  };
  const [inquiryTotal, intentTotal, statusGroups, intentCount] =
    await Promise.all([
      db.inquiry.count({ where: inquiryWhere }),
      db.whatsAppContactIntent.count({ where: intentWhere }),
      db.inquiry.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      db.whatsAppContactIntent.count(),
    ]);
  const inquiryPagination = buildPagination(
    inquiryTotal,
    filters.inquiryPage,
    ADMIN_COMMUNICATIONS_PAGE_SIZE,
  );
  const intentPagination = buildPagination(
    intentTotal,
    filters.intentPage,
    ADMIN_COMMUNICATIONS_PAGE_SIZE,
  );
  const [inquiries, intents] = await Promise.all([
    db.inquiry.findMany({
      where: inquiryWhere,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: inquiryPagination.skip,
      take: inquiryPagination.pageSize,
      select: {
        publicId: true,
        inquiryNumber: true,
        source: true,
        status: true,
        subject: true,
        customerName: true,
        customerEmail: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        closedAt: true,
        customer: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true } },
        order: { select: { publicId: true, orderNumber: true } },
        product: { select: { publicId: true, title: true, slug: true } },
        _count: { select: { whatsappIntents: true, internalNotes: true } },
      },
    }),
    db.whatsAppContactIntent.findMany({
      where: intentWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: intentPagination.skip,
      take: intentPagination.pageSize,
      select: safeIntentSelect,
    }),
  ]);

  const statusCounts: Record<InquiryStatus, number> = {
    OPEN: 0,
    IN_PROGRESS: 0,
    WAITING_CUSTOMER: 0,
    RESOLVED: 0,
    CLOSED: 0,
  };
  for (const group of statusGroups) {
    statusCounts[group.status] = group._count._all;
  }

  return {
    access: permissionAccess(authorization.permissions),
    filters: {
      ...filters,
      inquiryPage: inquiryPagination.page,
      intentPage: intentPagination.page,
    },
    validationError,
    inquiryPagination: {
      page: inquiryPagination.page,
      pageSize: inquiryPagination.pageSize,
      pageCount: inquiryPagination.pageCount,
      total: inquiryPagination.total,
    },
    intentPagination: {
      page: intentPagination.page,
      pageSize: intentPagination.pageSize,
      pageCount: intentPagination.pageCount,
      total: intentPagination.total,
    },
    counts: {
      inquiries: Object.values(statusCounts).reduce(
        (total, count) => total + count,
        0,
      ),
      intents: intentCount,
      byStatus: statusCounts,
    },
    inquiries: inquiries.map((inquiry) => ({
      publicId: inquiry.publicId,
      inquiryNumber: inquiry.inquiryNumber,
      source: inquiry.source,
      status: inquiry.status,
      subject: inquiry.subject,
      customer: inquiry.customer
        ? {
            publicId: inquiry.customer.id,
            name: inquiry.customer.name,
            email: inquiry.customer.email,
          }
        : null,
      recordedCustomerName: inquiry.customerName,
      recordedCustomerEmail: inquiry.customerEmail,
      assignedTo: inquiry.assignedTo,
      order: inquiry.order,
      product: inquiry.product,
      whatsappIntentCount: inquiry._count.whatsappIntents,
      internalNoteCount: inquiry._count.internalNotes,
      resolvedAt: iso(inquiry.resolvedAt),
      closedAt: iso(inquiry.closedAt),
      createdAt: inquiry.createdAt.toISOString(),
      updatedAt: inquiry.updatedAt.toISOString(),
    })),
    intents: intents.map(toSafeIntentDto),
  };
}

export async function getAdminCommunicationInquiry(candidatePublicId: string) {
  const parsedId = publicIdSchema.safeParse(candidatePublicId);
  const returnTo = parsedId.success
    ? `/admin/communications/${parsedId.data}`
    : "/admin/communications";
  const authorization = await requirePermission("communications.read", returnTo);
  if (!parsedId.success) return null;

  const db = getDb();
  const [inquiry, activeAdministrators] = await Promise.all([
    db.inquiry.findUnique({
      where: { publicId: parsedId.data },
      select: {
        publicId: true,
        inquiryNumber: true,
        source: true,
        status: true,
        subject: true,
        message: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        resolvedAt: true,
        closedAt: true,
        createdAt: true,
        updatedAt: true,
        customer: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        order: { select: { publicId: true, orderNumber: true } },
        product: { select: { publicId: true, title: true, slug: true } },
        whatsappIntents: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 100,
          select: safeIntentSelect,
        },
        internalNotes: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 200,
          select: {
            publicId: true,
            body: true,
            isPinned: true,
            createdAt: true,
            updatedAt: true,
            author: { select: { id: true, name: true, email: true } },
          },
        },
      },
    }),
    db.user.findMany({
      where: eligibleCommunicationAssigneeWhere,
      orderBy: [{ name: "asc" }, { email: "asc" }, { id: "asc" }],
      take: 500,
      select: { id: true, name: true, email: true },
    }),
  ]);
  if (!inquiry) return null;

  return {
    access: permissionAccess(authorization.permissions),
    publicId: inquiry.publicId,
    inquiryNumber: inquiry.inquiryNumber,
    source: inquiry.source,
    status: inquiry.status,
    subject: inquiry.subject,
    message: inquiry.message,
    recordedContact: {
      name: inquiry.customerName,
      email: inquiry.customerEmail,
      phone: inquiry.customerPhone,
    },
    customer: inquiry.customer
      ? {
          publicId: inquiry.customer.id,
          name: inquiry.customer.name,
          email: inquiry.customer.email,
        }
      : null,
    assignedTo: inquiry.assignedTo
      ? {
          publicId: inquiry.assignedTo.id,
          name: inquiry.assignedTo.name,
          email: inquiry.assignedTo.email,
        }
      : null,
    order: inquiry.order,
    product: inquiry.product,
    resolvedAt: iso(inquiry.resolvedAt),
    closedAt: iso(inquiry.closedAt),
    createdAt: inquiry.createdAt.toISOString(),
    updatedAt: inquiry.updatedAt.toISOString(),
    activeAdministrators: activeAdministrators.map((administrator) => ({
      publicId: administrator.id,
      name: administrator.name,
      email: administrator.email,
    })),
    intents: inquiry.whatsappIntents.map(toSafeIntentDto),
    notes: inquiry.internalNotes.map((note) => ({
      publicId: note.publicId,
      body: note.body,
      isPinned: note.isPinned,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      author: {
        publicId: note.author.id,
        name: note.author.name,
        email: note.author.email,
      },
    })),
  };
}
