import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  PaymentMethod,
  PrismaClient,
} from "../src/generated/prisma/client";
import { validatePostgresConnectionUrl } from "../src/lib/postgres-connection-url";

const rawDirectUrl = process.env.DIRECT_URL;

if (!rawDirectUrl) {
  throw new Error("DIRECT_URL is required to seed the database.");
}
const directUrl = validatePostgresConnectionUrl(rawDirectUrl, {
  label: "DIRECT_URL",
  requiredSchema: "app",
});

const adapter = new PrismaPg({ connectionString: directUrl });
const prisma = new PrismaClient({ adapter });

const permissions = [
  { slug: "admin.access", name: "Access administration", description: "Sign in to and view the administration area." },
  { slug: "users.read", name: "View users", description: "View customer and administrator accounts." },
  { slug: "users.manage", name: "Manage users", description: "Manage eligible customer and administrator account access." },
  { slug: "roles.read", name: "View roles", description: "View roles and permission assignments." },
  { slug: "roles.manage", name: "Manage roles", description: "Create and maintain custom roles, and assign or revoke eligible administrator roles without exceeding the actor's own permissions." },
  { slug: "audit.read", name: "View audit log", description: "View immutable administrative activity records." },
  { slug: "settings.read", name: "View settings", description: "View operational site settings." },
  { slug: "settings.manage", name: "Manage settings", description: "Change operational site settings." },
  { slug: "catalog.read", name: "View catalog", description: "View products, variants, categories, and pricing." },
  { slug: "catalog.manage", name: "Manage catalog", description: "Create and update products, variants, categories, and pricing." },
  { slug: "inventory.read", name: "View inventory", description: "View stock and inventory movements." },
  { slug: "inventory.manage", name: "Manage inventory", description: "Adjust stock and inventory movements." },
  { slug: "orders.read", name: "View orders", description: "View orders and order histories." },
  { slug: "orders.manage", name: "Manage orders", description: "Update order status and customer order details." },
  { slug: "fulfillment.read", name: "View fulfillment", description: "View shipments, carriers, and tracking events." },
  { slug: "fulfillment.manage", name: "Manage fulfillment", description: "Create shipments and update tracking information." },
  { slug: "payments.read", name: "View payments", description: "View payment attempts and manual payment evidence." },
  { slug: "payments.manage", name: "Manage payments", description: "Reconcile and update payment records." },
  { slug: "customers.read", name: "View customers", description: "View customer profiles, addresses, and communications." },
  { slug: "customers.manage", name: "Manage customers", description: "Update customer profiles and service records." },
  { slug: "content.read", name: "View content", description: "View pages, articles, and frequently asked questions." },
  { slug: "content.manage", name: "Manage content", description: "Create, update, publish, and archive pages, articles, and frequently asked questions." },
  { slug: "seo.read", name: "View SEO", description: "View metadata, canonicals, indexing directives, redirects, and SEO health." },
  { slug: "seo.manage", name: "Manage SEO", description: "Update metadata, canonicals, indexing directives, and redirects." },
  { slug: "communications.read", name: "View communications", description: "View customer communication threads and notes." },
  { slug: "communications.manage", name: "Manage communications", description: "Create and update customer communication threads and notes." },
  // Finance permissions are deliberately excluded from the operational system
  // roles below; only the owner (all permissions) and the read-only auditor
  // (every *.read) receive them by default. Grant others via custom roles.
  { slug: "finance.read", name: "View finance", description: "View internal costs, profit, and finance dashboards." },
  { slug: "finance.costs.manage", name: "Manage costs", description: "Record shipment, packaging, and other direct costs." },
  { slug: "finance.adjustments.manage", name: "Manage financial adjustments", description: "Create and reverse append-only profit adjustments." },
  { slug: "finance.procurement.manage", name: "Manage procurement", description: "Create purchase orders, receive stock, and record CNY costs and exchange rates." },
  { slug: "finance.returns.manage", name: "Manage after-sales economics", description: "Record refunds, returns, replacements, and compensation gifts." },
  { slug: "finance.crypto-settlements.manage", name: "Manage crypto conversions", description: "Create and complete USD-to-crypto conversion batches." },
  { slug: "finance.partner-settlements.read", name: "View partner settlements", description: "View partner profit-sharing settlements." },
  { slug: "finance.partner-settlements.manage", name: "Manage partner settlements", description: "Create and confirm partner profit-sharing settlements." },
  { slug: "finance.partner-settlements.lock", name: "Lock partner settlements", description: "Lock, void, and mark partner settlements as paid." },
  { slug: "finance.export", name: "Export finance data", description: "Export finance reports as CSV files." },
] as const;

type PermissionSlug = (typeof permissions)[number]["slug"];

const readOnlyPermissions = permissions
  .map(({ slug }) => slug)
  .filter((slug): slug is PermissionSlug => slug.endsWith(".read"));

const roles: ReadonlyArray<{
  slug: string;
  name: string;
  description: string;
  permissions: readonly PermissionSlug[];
}> = [
  {
    slug: "owner",
    name: "Owner",
    description: "Full site and administration access. Assignment is always explicit.",
    permissions: permissions.map(({ slug }) => slug),
  },
  {
    slug: "catalog_manager",
    name: "Catalog manager",
    description: "Manages products, inventory visibility, and product SEO.",
    permissions: [
      "admin.access",
      "catalog.read",
      "catalog.manage",
      "inventory.read",
      "content.read",
      "seo.read",
      "seo.manage",
    ],
  },
  {
    slug: "operations_manager",
    name: "Operations manager",
    description: "Manages orders, inventory, fulfillment, payments, and customer operations.",
    permissions: [
      "admin.access",
      "orders.read",
      "orders.manage",
      "inventory.read",
      "inventory.manage",
      "fulfillment.read",
      "fulfillment.manage",
      "payments.read",
      "payments.manage",
      "customers.read",
      "communications.read",
      "communications.manage",
    ],
  },
  {
    slug: "content_editor",
    name: "Content editor",
    description: "Manages storefront content and search optimization.",
    permissions: [
      "admin.access",
      "catalog.read",
      "content.read",
      "content.manage",
      "seo.read",
      "seo.manage",
    ],
  },
  {
    slug: "customer_support",
    name: "Customer support",
    description: "Supports customers and reviews orders, shipments, and payments.",
    permissions: [
      "admin.access",
      "users.read",
      "customers.read",
      "customers.manage",
      "orders.read",
      "fulfillment.read",
      "payments.read",
      "communications.read",
      "communications.manage",
    ],
  },
  {
    slug: "auditor",
    name: "Auditor",
    description: "Read-only operational and audit access.",
    permissions: ["admin.access", ...readOnlyPermissions],
  },
];

const settings = [
  {
    key: "commerce.default_currency",
    value: "USD",
    description: "ISO 4217 currency used for storefront prices and new orders.",
    isPublic: true,
  },
  {
    key: "finance.crypto_conversion_fee_bps",
    value: { bps: 50 },
    description:
      "Default fee, in basis points, applied when converting received USD into cryptocurrency. Direct crypto payments never use this fee.",
    isPublic: false,
  },
  {
    key: "commerce.supported_countries",
    value: ["US"],
    description: "ISO 3166-1 alpha-2 countries currently supported at checkout.",
    isPublic: true,
  },
  {
    key: "commerce.online_payments_enabled",
    value: false,
    description: "Global kill switch for direct online payment initiation.",
    isPublic: true,
  },
  {
    key: "commerce.checkout_charges",
    value: {
      configured: false,
      shippingFirstBlockMinor: null,
      shippingBlockUnits: null,
      shippingAdditionalBlockMinor: null,
      taxRateBps: null,
    },
    description:
      "Explicit checkout shipping and tax configuration. No charge is applied while configured is false.",
    isPublic: false,
  },
  {
    key: "security.admin_mfa_required",
    value: false,
    description: "Whether administrators must enroll a second authentication factor.",
    isPublic: false,
  },
  {
    key: "storefront.contact_channels",
    value: [],
    description: "Customer contact channels presented by the storefront.",
    isPublic: true,
  },
  {
    key: "storefront.whatsapp",
    value: {
      configured: false,
      phoneE164: null,
      displayValue: null,
      welcomeMessage: "How can we help with a product or order question?",
      businessHours: null,
      templates: {
        global:
          "Hello, I'd like to discuss a research-product or order requirement.",
        product:
          "Hello, I'd like to ask about this product.\nProduct: {{productName}}\nSlug: {{productSlug}}\nSKU: {{sku}}\nCAS: {{casNumber}}\nURL: {{productUrl}}",
        cart:
          "Hello, I'd like to ask about this cart.\n{{cartLines}}\nDisplayed product subtotal: {{displayedSubtotal}} USD\nPlease confirm current availability, shipping, and payment options.",
        order:
          "Hello, I need help with order reference {{orderReference}}.",
        contact:
          "Hello, I'd like to discuss a research-product requirement.\nResearch area: {{category}}\nRequirement: {{requirement}}",
      },
    },
    description:
      "Public WhatsApp click-to-chat configuration and server-controlled message templates. Disabled until explicitly configured.",
    isPublic: true,
  },
];

const paymentMethods = [
  {
    method: PaymentMethod.NOWPAYMENTS,
    displayName: "NOWPayments",
    isEnabled: false,
    publicInstructions: null,
    credentialEnvPrefix: "NOWPAYMENTS",
    settingKey: "commerce.online_payments_enabled",
  },
  {
    method: PaymentMethod.WIRE_TRANSFER,
    displayName: "Wire transfer",
    isEnabled: false,
    publicInstructions:
      "Contact us through WhatsApp to confirm the order before sending a wire transfer. Settlement details are provided through the approved arrangement and are not stored in this public field.",
    credentialEnvPrefix: null,
    settingKey: null,
  },
  {
    method: PaymentMethod.ZELLE,
    displayName: "Zelle",
    isEnabled: false,
    publicInstructions:
      "Contact us through WhatsApp to confirm the order before sending Zelle. Recipient details are provided through the approved arrangement and are not stored in this public field.",
    credentialEnvPrefix: null,
    settingKey: null,
  },
  {
    method: PaymentMethod.OTHER_MANUAL,
    displayName: "Other arranged payment",
    isEnabled: false,
    publicInstructions:
      "Use only payment instructions confirmed for this order through our official WhatsApp channel.",
    credentialEnvPrefix: null,
    settingKey: null,
  },
] as const;

async function main() {
  await prisma.$transaction(async (tx) => {
    const permissionIds = new Map<PermissionSlug, bigint>();

    for (const permission of permissions) {
      const record = await tx.permission.upsert({
        where: { slug: permission.slug },
        create: permission,
        update: {
          name: permission.name,
          description: permission.description,
        },
      });

      permissionIds.set(permission.slug, record.id);
    }

    for (const role of roles) {
      const roleRecord = await tx.role.upsert({
        where: { slug: role.slug },
        create: {
          slug: role.slug,
          name: role.name,
          description: role.description,
          isSystem: true,
        },
        update: {
          name: role.name,
          description: role.description,
          isSystem: true,
        },
      });

      const desiredPermissionIds = role.permissions.map((slug) => {
        const permissionId = permissionIds.get(slug);
        if (!permissionId) {
          throw new Error(`Unknown permission in role ${role.slug}: ${slug}`);
        }
        return permissionId;
      });

      await tx.rolePermission.deleteMany({
        where: {
          roleId: roleRecord.id,
          permissionId: { notIn: desiredPermissionIds },
        },
      });

      for (const permissionId of desiredPermissionIds) {
        await tx.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: roleRecord.id,
              permissionId,
            },
          },
          create: {
            roleId: roleRecord.id,
            permissionId,
          },
          update: {},
        });
      }
    }

    for (const setting of settings) {
      await tx.siteSetting.upsert({
        where: { key: setting.key },
        create: setting,
        update: {
          description: setting.description,
          isPublic: setting.isPublic,
        },
      });
    }

    for (const paymentMethod of paymentMethods) {
      await tx.paymentMethodConfig.upsert({
        where: { method: paymentMethod.method },
        create: paymentMethod,
        // Operational values and customer-facing instructions are managed in
        // the admin system. Re-running a seed must never silently re-enable,
        // disable, or replace them.
        update: {},
      });
    }
  }, {
    // Seeding runs one upsert round-trip at a time; on a remote database the
    // accumulated latency exceeds the 5s default. Match the legacy importer's
    // transaction budget.
    maxWait: 10_000,
    timeout: 120_000,
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.info(
      "Seeded system roles, permissions, baseline settings, and disabled payment-method defaults.",
    );
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
