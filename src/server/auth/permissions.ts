export const PERMISSION_SLUGS = [
  "admin.access",
  "users.read",
  "users.manage",
  "roles.read",
  "roles.manage",
  "audit.read",
  "settings.read",
  "settings.manage",
  "catalog.read",
  "catalog.manage",
  "inventory.read",
  "inventory.manage",
  "orders.read",
  "orders.manage",
  "fulfillment.read",
  "fulfillment.manage",
  "payments.read",
  "payments.manage",
  "customers.read",
  "customers.manage",
  "content.read",
  "content.manage",
  "seo.read",
  "seo.manage",
  "communications.read",
  "communications.manage",
  "finance.read",
  "finance.costs.manage",
  "finance.adjustments.manage",
  "finance.procurement.manage",
  "finance.returns.manage",
  "finance.crypto-settlements.manage",
  "finance.partner-settlements.read",
  "finance.partner-settlements.manage",
  "finance.partner-settlements.lock",
  "finance.export",
] as const;

export type PermissionSlug = (typeof PERMISSION_SLUGS)[number];

export function isPermissionGranted(
  isActiveAdmin: boolean,
  permissions: ReadonlySet<string>,
  required: PermissionSlug,
) {
  return isActiveAdmin && permissions.has(required);
}
