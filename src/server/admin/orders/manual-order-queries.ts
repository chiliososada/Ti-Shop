import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { minimumOrderQuantityFromOptionValues } from "@/domain/minimum-order-quantity";
import { PAYMENT_METHOD_LABELS } from "@/domain/order";
import {
  buildCurrentUsdPriceWhere,
  buildPublishedProductWhere,
  buildPublishedVariantWhere,
} from "@/server/catalog/query-contracts";
import { normalizeSearchText, type SearchParameter } from "@/lib/pagination";
import { requirePermission } from "@/server/auth/rbac";
import { getDb } from "@/server/db/client";
import { parseConfiguredCheckoutCharges } from "@/server/orders/charges";
import { usOrderAddressSchema } from "@/server/orders/input";
import { selectCheckoutUsdPrice } from "@/server/orders/pricing";
import { isCheckoutPaymentMethodAvailable } from "@/server/payments/checkout-availability";

const CUSTOMER_RESULT_LIMIT = 100;
const VARIANT_RESULT_LIMIT = 250;
const customerIdSchema = z.uuid();

const eligibleCustomerWhere = {
  emailVerified: true,
  disabledAt: null,
  customerProfile: {
    is: { countryCode: "US", preferredCurrency: "USD" },
  },
  adminProfile: { is: null },
  roleAssignments: { none: {} },
} as const satisfies Prisma.UserWhereInput;

function customerSearchWhere(query: string): Prisma.UserWhereInput {
  if (!query) return eligibleCustomerWhere;
  const contains = { contains: query, mode: "insensitive" as const };
  return {
    AND: [
      eligibleCustomerWhere,
      {
        OR: [
          { email: contains },
          { name: contains },
          { customerProfile: { is: { firstName: contains } } },
          { customerProfile: { is: { lastName: contains } } },
        ],
      },
    ],
  };
}

function variantSearchWhere(
  query: string,
  now: Date,
): Prisma.ProductVariantWhereInput {
  const filters: Prisma.ProductVariantWhereInput[] = [
    buildPublishedVariantWhere(now),
    { priceMode: "FIXED" },
    { prices: { some: buildCurrentUsdPriceWhere(now) } },
    { product: { is: buildPublishedProductWhere(now) } },
  ];
  if (query) {
    const contains = { contains: query, mode: "insensitive" as const };
    filters.push({
      OR: [
        { title: contains },
        { sku: contains },
        { product: { is: { title: contains } } },
      ],
    });
  }
  return { AND: filters };
}

function normalizeCustomerId(value: SearchParameter) {
  const parsed = customerIdSchema.safeParse(
    typeof value === "string" ? value : "",
  );
  return parsed.success ? parsed.data : null;
}

export async function getAdminManualOrderForm(
  searchParams: Record<string, SearchParameter> = {},
) {
  const returnTo = "/admin/orders/new";
  await requirePermission("orders.manage", returnTo);
  await requirePermission("payments.manage", returnTo);
  await requirePermission("customers.read", returnTo);

  const customerQuery = normalizeSearchText(searchParams.customerQ);
  const variantQuery = normalizeSearchText(searchParams.variantQ);
  const selectedCustomerId = normalizeCustomerId(searchParams.customer);
  const now = new Date();
  const db = getDb();

  const [customerRows, selectedCustomer, variantRows, configRows, chargesRow] =
    await Promise.all([
      db.user.findMany({
        where: customerSearchWhere(customerQuery),
        orderBy: [{ email: "asc" }, { id: "asc" }],
        take: CUSTOMER_RESULT_LIMIT + 1,
        select: {
          id: true,
          email: true,
          name: true,
          customerProfile: {
            select: { firstName: true, lastName: true },
          },
        },
      }),
      selectedCustomerId
        ? db.user.findFirst({
            where: { AND: [eligibleCustomerWhere, { id: selectedCustomerId }] },
            select: {
              id: true,
              email: true,
              name: true,
              customerProfile: {
                select: { firstName: true, lastName: true },
              },
              addresses: {
                where: { deletedAt: null, countryCode: "US" },
                orderBy: [
                  { isDefaultShipping: "desc" },
                  { updatedAt: "desc" },
                  { id: "desc" },
                ],
                select: {
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
                },
              },
            },
          })
        : Promise.resolve(null),
      db.productVariant.findMany({
        where: variantSearchWhere(variantQuery, now),
        orderBy: [
          { product: { title: "asc" } },
          { position: "asc" },
          { id: "asc" },
        ],
        take: VARIANT_RESULT_LIMIT + 1,
        select: {
          publicId: true,
          title: true,
          sku: true,
          optionValues: true,
          trackInventory: true,
          product: { select: { title: true } },
          prices: {
            where: buildCurrentUsdPriceWhere(now),
            select: {
              amountMinor: true,
              currency: true,
              kind: true,
              countryCode: true,
              isActive: true,
              startsAt: true,
              endsAt: true,
              createdAt: true,
              deletedAt: true,
            },
          },
        },
      }),
      db.paymentMethodConfig.findMany({
        where: { method: { in: ["WIRE_TRANSFER", "ZELLE"] } },
        select: {
          method: true,
          isEnabled: true,
          settingKey: true,
          setting: { select: { value: true } },
        },
      }),
      db.siteSetting.findUnique({
        where: { key: "commerce.checkout_charges" },
        select: { value: true },
      }),
    ]);

  const customers = customerRows.slice(0, CUSTOMER_RESULT_LIMIT).map((row) => ({
    id: row.id,
    email: row.email,
    name:
      [row.customerProfile?.firstName, row.customerProfile?.lastName]
        .filter(Boolean)
        .join(" ") || row.name,
  }));

  const addresses = (selectedCustomer?.addresses ?? []).flatMap((row) => {
    const parsed = usOrderAddressSchema.safeParse({
      recipientName: row.recipientName,
      ...(row.company ? { company: row.company } : {}),
      line1: row.line1,
      ...(row.line2 ? { line2: row.line2 } : {}),
      city: row.city,
      region: row.region,
      postalCode: row.postalCode,
      countryCode: row.countryCode,
      ...(row.phone ? { phone: row.phone } : {}),
    });
    return parsed.success
      ? [
          {
            id: row.id.toString(),
            label: row.label,
            isDefaultShipping: row.isDefaultShipping,
            ...parsed.data,
          },
        ]
      : [];
  });

  const variants = variantRows
    .slice(0, VARIANT_RESULT_LIMIT)
    .flatMap((row) => {
      const price = selectCheckoutUsdPrice(row.prices, now);
      const minimumOrderQuantity = minimumOrderQuantityFromOptionValues(
        row.optionValues,
      );
      return price && minimumOrderQuantity !== null
        ? [
            {
              publicId: row.publicId,
              productTitle: row.product.title,
              variantTitle: row.title,
              sku: row.sku,
              unitPriceMinor: price.amountMinor.toString(),
              minimumOrderQuantity,
              trackInventory: row.trackInventory,
            },
          ]
        : [];
    });

  const configByMethod = new Map(configRows.map((row) => [row.method, row]));
  const paymentMethods = (["WIRE_TRANSFER", "ZELLE"] as const).flatMap(
    (method) => {
      const config = configByMethod.get(method);
      return config &&
        isCheckoutPaymentMethodAvailable(method, config, false)
        ? [{ method, label: PAYMENT_METHOD_LABELS[method] }]
        : [];
    },
  );

  return {
    filters: { customerQuery, variantQuery },
    customers,
    customersTruncated: customerRows.length > CUSTOMER_RESULT_LIMIT,
    selectedCustomer: selectedCustomer
      ? {
          id: selectedCustomer.id,
          email: selectedCustomer.email,
          name:
            [
              selectedCustomer.customerProfile?.firstName,
              selectedCustomer.customerProfile?.lastName,
            ]
              .filter(Boolean)
              .join(" ") || selectedCustomer.name,
          addresses,
        }
      : null,
    variants,
    variantsTruncated: variantRows.length > VARIANT_RESULT_LIMIT,
    paymentMethods,
    checkoutChargesConfigured:
      parseConfiguredCheckoutCharges(chargesRow?.value) !== null,
  };
}
