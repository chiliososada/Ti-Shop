import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { toAuditJson } from "@/server/admin/audit/serialize";

type AuditInput = {
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  before: unknown;
  after: unknown;
  source?: "admin-server-action" | "customer-server-action";
};

export async function writeAdminAuditLog(
  tx: Prisma.TransactionClient,
  input: AuditInput,
) {
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      before: toAuditJson(input.before),
      after: toAuditJson(input.after),
      metadata: { source: input.source ?? "admin-server-action" },
    },
    select: { id: true },
  });
}
