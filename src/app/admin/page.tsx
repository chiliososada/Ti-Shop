import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { getAdminOverview } from "@/server/admin/overview";
import { DISPLAY_TIME_ZONE } from "@/lib/display-timezone";

export const metadata: Metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};

type AdminModule = {
  key: keyof Awaited<ReturnType<typeof getAdminOverview>>["access"]["modules"];
  name: string;
  description: string;
  href: string;
};

type AdminMetricCard = {
  key: string;
  title: string;
  value: number;
  description: string;
  href: string;
};

const modules: readonly AdminModule[] = [
  {
    key: "catalog",
    name: "Catalog",
    description:
      "Products, categories, variants, publishing, USD pricing, and media associations.",
    href: "/admin/catalog",
  },
  {
    key: "finance",
    name: "Finance",
    description:
      "Internal costs, order profit, procurement, after-sales economics, crypto conversions, and partner settlements.",
    href: "/admin/finance",
  },
  {
    key: "inventory",
    name: "Inventory",
    description:
      "Locations, on-hand stock, reservations, adjustments, and movement history.",
    href: "/admin/inventory",
  },
  {
    key: "orders",
    name: "Orders",
    description:
      "Customer orders, status, payment and fulfillment summaries, and operational review.",
    href: "/admin/orders",
  },
  {
    key: "payments",
    name: "Payments",
    description:
      "Fail-closed method settings, NOWPayments events, and manual payment review.",
    href: "/admin/payments",
  },
  {
    key: "fulfillment",
    name: "Fulfillment",
    description:
      "Carriers, shipments, packages, shipped quantities, and customer-visible tracking events.",
    href: "/admin/fulfillment",
  },
  {
    key: "customers",
    name: "Customers",
    description:
      "Customer profiles, US addresses, orders, and safe service history summaries.",
    href: "/admin/customers",
  },
  {
    key: "communications",
    name: "Communications",
    description:
      "Inquiries, assignments, lifecycle status, internal notes, and WhatsApp contact intents.",
    href: "/admin/communications",
  },
  {
    key: "content",
    name: "Content",
    description:
      "Blog posts, FAQ entries, standalone pages, authorship, and publishing controls.",
    href: "/admin/content",
  },
  {
    key: "seo",
    name: "SEO",
    description:
      "Search metadata, canonicals, indexing policy, structured data, and redirects.",
    href: "/admin/seo",
  },
  {
    key: "settings",
    name: "Storefront settings",
    description:
      "Fail-closed WhatsApp number, public presentation, and tracked click-to-chat templates.",
    href: "/admin/settings",
  },
  {
    key: "users",
    name: "Users and access",
    description:
      "Safe account views, administrator activation, custom roles, permissions, and role assignments.",
    href: "/admin/users",
  },
  {
    key: "audit",
    name: "Audit log",
    description:
      "Searchable administrative activity by actor, action, resource, and date.",
    href: "/admin/audit",
  },
];

function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(value);
}

export default async function AdminPage() {
  // Authorization is intentionally performed in this page-level data request,
  // not in the root layout or client-side navigation.
  await connection();
  const overview = await getAdminOverview();
  const visibleModules = modules.filter(
    (module) => overview.access.modules[module.key].canRead,
  );
  const metricCards: AdminMetricCard[] = [];

  if (overview.metrics.recentOrderCount !== null) {
    metricCards.push({
      key: "recent-orders",
      title: "Orders in the last 30 days",
      value: overview.metrics.recentOrderCount,
      description:
        "Non-draft orders created in the rolling 30-day window.",
      href: "/admin/orders",
    });
  }
  if (overview.metrics.awaitingPaymentOrderCount !== null) {
    metricCards.push({
      key: "awaiting-payment",
      title: "Awaiting payment",
      value: overview.metrics.awaitingPaymentOrderCount,
      description:
        "Pending-payment orders recorded as unpaid, pending, or partially paid.",
      href: "/admin/orders?orderStatus=PENDING_PAYMENT",
    });
  }
  if (overview.metrics.paymentReviewOrderCount !== null) {
    metricCards.push({
      key: "payment-review",
      title: "Payment review required",
      value: overview.metrics.paymentReviewOrderCount,
      description:
        "Unique orders with a review-required payment or a pending manual payment attempt.",
      href: "/admin/orders?review=required",
    });
  }
  if (overview.metrics.pendingFulfillmentOrderCount !== null) {
    metricCards.push({
      key: "pending-fulfillment",
      title: "Pending fulfillment",
      value: overview.metrics.pendingFulfillmentOrderCount,
      description:
        "Paid confirmed or processing orders that are unfulfilled or partially fulfilled.",
      href: "/admin/fulfillment",
    });
  }
  if (overview.metrics.inTransitShipmentCount !== null) {
    metricCards.push({
      key: "in-transit-shipments",
      title: "Shipments in transit",
      value: overview.metrics.inTransitShipmentCount,
      description: "Shipments whose current recorded status is in transit.",
      href: "/admin/fulfillment?shipmentStatus=IN_TRANSIT",
    });
  }
  if (overview.metrics.exceptionShipmentCount !== null) {
    metricCards.push({
      key: "shipment-exceptions",
      title: "Shipment exceptions",
      value: overview.metrics.exceptionShipmentCount,
      description: "Shipments whose current recorded status is exception.",
      href: "/admin/fulfillment?shipmentStatus=EXCEPTION",
    });
  }
  if (overview.metrics.lowStockVariantCount !== null) {
    metricCards.push({
      key: "low-inventory",
      title: "Low-stock variants",
      value: overview.metrics.lowStockVariantCount,
      description:
        "Tracked active variants with 5 or fewer sellable units across active US locations, after reservations and safety stock.",
      href: "/admin/inventory",
    });
  }
  if (overview.metrics.customerCount !== null) {
    metricCards.push({
      key: "customers",
      title: "Customers",
      value: overview.metrics.customerCount,
      description:
        "Customer-profile accounts; administrator and role-bearing identities are excluded.",
      href: "/admin/customers",
    });
  }
  if (overview.metrics.activeAdminCount !== null) {
    metricCards.push({
      key: "administrators",
      title: "Active administrators",
      value: overview.metrics.activeAdminCount,
      description:
        "Enabled profiles with a verified, non-disabled account and a role that grants administration access.",
      href: "/admin/users",
    });
  }

  return (
    <section className="section-y bg-surface-warm">
      <div className="container-x">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-eyebrow uppercase text-sage-600">
              Administration
            </p>
            <h1 className="mt-4 text-h2 text-strong">Operations overview</h1>
            <p className="mt-3 text-body">
              Signed in as {overview.currentUser.name} · {overview.currentUser.email}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/account"
              className="rounded-full border border-ink-900/15 px-5 py-2.5 text-sm font-semibold text-strong transition hover:bg-ink-900/[0.04]"
            >
              My account
            </Link>
            <SignOutButton />
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          {overview.roles.map((role) => (
            <span
              key={role}
              className="rounded-full bg-sage-100 px-3 py-1 text-caption font-semibold text-sage-700"
            >
              {role.replaceAll("_", " ")}
            </span>
          ))}
        </div>

        {metricCards.length ? (
          <section className="mt-10" aria-labelledby="operational-metrics">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
              <div>
                <h2 id="operational-metrics" className="text-h4 text-strong">
                  Current workload
                </h2>
                <p className="mt-2 text-sm text-muted">
                  Permission-scoped counts from the current database state. No
                  customer identity details or accounting revenue are included.
                </p>
              </div>
              <p className="text-caption text-muted">USD / United States store</p>
            </div>
            <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {metricCards.map((metric) => (
                <article
                  key={metric.key}
                  className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6"
                >
                  <p className="text-caption font-semibold uppercase tracking-wider text-muted">
                    {metric.title}
                  </p>
                  <p className="mt-3 text-h3 text-strong">{metric.value}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {metric.description}
                  </p>
                  <Link
                    href={metric.href}
                    className="mt-4 inline-flex text-sm font-semibold text-sage-700"
                    aria-label={`Open ${metric.title.toLowerCase()} module`}
                  >
                    Open related records →
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <p className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 text-body">
            No workload metrics are available for this administrator role.
          </p>
        )}

        {visibleModules.length ? (
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {visibleModules.map((module) => (
              <article
                key={module.name}
                className="rounded-2xl border border-ink-900/[0.08] bg-surface p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-h5 text-strong">{module.name}</h2>
                  <span className="shrink-0 rounded-full bg-clay-50 px-3 py-1 text-caption font-semibold text-clay-600">
                    {overview.access.modules[module.key].canManage
                      ? "Manage"
                      : "Read only"}
                  </span>
                </div>
                <p className="mt-3 leading-relaxed text-body">
                  {module.description}
                </p>
                <Link
                  href={module.href}
                  className="mt-5 inline-flex text-sm font-semibold text-sage-700"
                >
                  Open module →
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-6 text-body">
            No operational modules are assigned to this administrator role.
          </p>
        )}

        {overview.access.canReadAuditLog && overview.recentAuditLogs ? (
          <article className="mt-10 rounded-2xl border border-ink-900/[0.08] bg-surface p-7">
            <h2 className="text-h4 text-strong">Recent audit activity</h2>
            {overview.recentAuditLogs.length ? (
              <ul className="mt-5 divide-y divide-line">
                {overview.recentAuditLogs.map((entry) => (
                  <li
                    key={entry.id.toString()}
                    className="flex flex-col justify-between gap-2 py-4 sm:flex-row sm:items-center"
                  >
                    <div>
                      <p className="font-semibold text-strong">
                        {entry.action}
                      </p>
                      <p className="mt-1 text-caption text-muted">
                        {entry.resourceType} · audit #{entry.id.toString()}
                      </p>
                    </div>
                    <time
                      className="text-caption text-muted"
                      dateTime={entry.createdAt.toISOString()}
                    >
                      {formatTimestamp(entry.createdAt)} UTC
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-body">
                No audited administration activity yet.
              </p>
            )}
          </article>
        ) : null}
      </div>
    </section>
  );
}
