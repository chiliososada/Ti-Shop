import "server-only";

import type { AdminManualOrderInput } from "@/server/admin/orders/manual-order-input";
import { requirePermission } from "@/server/auth/rbac";
import { createAdminManualCustomerOrder } from "@/server/orders/create-order";

export async function createAdminManualOrder(input: AdminManualOrderInput) {
  const returnTo = "/admin/orders/new";
  const authorization = await requirePermission("orders.manage", returnTo);
  await requirePermission("payments.manage", returnTo);
  await requirePermission("customers.read", returnTo);

  return createAdminManualCustomerOrder(
    authorization.session.user.id,
    input,
  );
}
