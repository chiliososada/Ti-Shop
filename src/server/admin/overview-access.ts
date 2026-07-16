export function getAdminOverviewAccess(permissions: ReadonlySet<string>) {
  const canReadOrders = permissions.has("orders.read");
  const canReadPayments = permissions.has("payments.read");
  const canReadFulfillment = permissions.has("fulfillment.read");
  const canReadInventory = permissions.has("inventory.read");
  const canReadCustomers = permissions.has("customers.read");
  const canReadUsers = permissions.has("users.read");

  return {
    metrics: {
      canReadRecentOrders: canReadOrders,
      canReadAwaitingPayment: canReadOrders,
      // Payment-review state belongs to payment attempts, while its review
      // queue is the combined orders/payments surface.
      canReadPaymentReview: canReadOrders && canReadPayments,
      canReadPendingFulfillment: canReadFulfillment,
      canReadShipmentHealth: canReadFulfillment,
      canReadLowInventory: canReadInventory,
      canReadCustomerCount: canReadCustomers,
      canReadAdministratorCount: canReadUsers,
    },
    canReadAuditLog: permissions.has("audit.read"),
    modules: {
      catalog: {
        canRead: permissions.has("catalog.read"),
        canManage: permissions.has("catalog.manage"),
      },
      finance: {
        canRead: permissions.has("finance.read"),
        canManage:
          permissions.has("finance.procurement.manage") ||
          permissions.has("finance.returns.manage") ||
          permissions.has("finance.partner-settlements.manage"),
      },
      inventory: {
        canRead: canReadInventory,
        canManage: permissions.has("inventory.manage"),
      },
      orders: {
        canRead: canReadOrders,
        canManage: permissions.has("orders.manage"),
      },
      payments: {
        canRead: canReadPayments,
        canManage: permissions.has("payments.manage"),
      },
      fulfillment: {
        canRead: canReadFulfillment,
        canManage: permissions.has("fulfillment.manage"),
      },
      customers: {
        canRead: canReadCustomers,
        canManage: permissions.has("customers.manage"),
      },
      communications: {
        canRead: permissions.has("communications.read"),
        canManage: permissions.has("communications.manage"),
      },
      content: {
        canRead: permissions.has("content.read"),
        canManage: permissions.has("content.manage"),
      },
      seo: {
        canRead: permissions.has("seo.read"),
        canManage: permissions.has("seo.manage"),
      },
      settings: {
        canRead: permissions.has("settings.read"),
        canManage: permissions.has("settings.manage"),
      },
      users: {
        canRead: canReadUsers,
        canManage:
          permissions.has("users.manage") || permissions.has("roles.manage"),
      },
      audit: {
        canRead: permissions.has("audit.read"),
        canManage: false,
      },
    },
  };
}
