import "server-only";

import { randomUUID } from "node:crypto";

import {
  FulfillmentStatus,
  OrderAddressKind,
  OrderPaymentStatus,
  OrderStatus,
  PaymentStatus,
  PriceMode,
  Prisma,
} from "@/generated/prisma/client";
import {
  addMinorAmounts,
  multiplyMinorAmount,
  USD_CURRENCY,
} from "@/domain/money";
import { evaluateMinimumOrderQuantity } from "@/domain/minimum-order-quantity";
import type { CheckoutPaymentMethod } from "@/domain/order";
import { writeAdminAuditLog } from "@/server/admin/audit/log";
import type { AdminManualOrderInput } from "@/server/admin/orders/manual-order-input";
import { getDb } from "@/server/db/client";
import {
  buildCurrentUsdPriceWhere,
  buildPublishedProductWhere,
  buildPublishedVariantWhere,
} from "@/server/catalog/query-contracts";
import {
  allocateCheckoutTax,
  calculateConfiguredCheckoutCharges,
  parseConfiguredCheckoutCharges,
} from "@/server/orders/charges";
import { orderError } from "@/server/orders/errors";
import { reserveOrderItemInventory } from "@/server/orders/inventory";
import { isCheckoutPaymentMethodAvailable } from "@/server/payments/checkout-availability";
import { isNowPaymentsRuntimeOperational } from "@/server/payments/nowpayments/runtime-config";
import {
  adminManualOrderRequestFingerprint,
  checkoutRequestFingerprint,
  metadataHasCheckoutFingerprint,
  scopedAdminManualOrderIdempotencyKey,
  scopedCheckoutIdempotencyKey,
} from "@/server/orders/idempotency";
import type {
  NormalizedCheckoutInput,
  UsOrderAddressInput,
} from "@/server/orders/input";
import { usOrderAddressSchema } from "@/server/orders/input";
import { selectCheckoutUsdPrice } from "@/server/orders/pricing";
import { assertCustomerCheckoutQuota } from "@/server/orders/quota";
import { withSerializableRetry } from "@/server/orders/retry";

const INVENTORY_RESERVATION_MILLISECONDS = 24 * 60 * 60 * 1_000;

type CheckoutLine = {
  variantId: bigint;
  variantPublicId: string;
  productId: bigint;
  productName: string;
  productSlug: string;
  variantName: string;
  sku: string | null;
  optionValues: Prisma.JsonValue;
  weightGrams: number | null;
  trackInventory: boolean;
  quantity: number;
  unitPriceMinor: bigint;
  lineTotalMinor: bigint;
};

type OrderAddressSelection =
  | {
      mode: "PROVIDED";
      shippingAddress: UsOrderAddressInput;
      billingAddress?: UsOrderAddressInput;
    }
  | { mode: "SAVED"; addressId: string };

type OrderCreationInput = {
  items: NormalizedCheckoutInput["items"];
  paymentMethod: CheckoutPaymentMethod;
  address: OrderAddressSelection;
};

type OrderCreationContext =
  | { source: "CUSTOMER_CHECKOUT" }
  | { source: "ADMIN_WHATSAPP_MANUAL"; actorUserId: string };

const ADMIN_MANUAL_ORDER_PERMISSIONS = [
  "orders.manage",
  "payments.manage",
  "customers.read",
] as const;

export type CreatedCustomerOrder = {
  created: boolean;
  order: {
    publicId: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    totalMinor: string;
    currency: "USD";
  };
  payment: {
    publicId: string;
    method: CheckoutPaymentMethod;
    status: string;
  };
  nextAction: {
    kind: "NOWPAYMENTS_NOT_INITIALIZED" | "VIEW_MANUAL_INSTRUCTIONS";
    message: string;
    orderUrl: string;
  };
};

function createOrderNumber(now: Date) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const entropy = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `SA-${date}-${entropy}`;
}

function paymentStatusFor(method: CheckoutPaymentMethod) {
  return method === "NOWPAYMENTS" ? PaymentStatus.CREATED : PaymentStatus.PENDING;
}

function mapCreatedOrder(
  row: {
    publicId: string;
    method: CheckoutPaymentMethod;
    status: string;
    order: {
      publicId: string;
      orderNumber: string;
      status: string;
      paymentStatus: string;
      totalMinor: bigint;
      currency: string;
    };
  },
  created: boolean,
): CreatedCustomerOrder {
  const isNowPayments = row.method === "NOWPAYMENTS";

  return {
    created,
    order: {
      publicId: row.order.publicId,
      orderNumber: row.order.orderNumber,
      status: row.order.status,
      paymentStatus: row.order.paymentStatus,
      totalMinor: row.order.totalMinor.toString(),
      currency: "USD",
    },
    payment: {
      publicId: row.publicId,
      method: row.method,
      status: row.status,
    },
    nextAction: {
      kind: isNowPayments
        ? "NOWPAYMENTS_NOT_INITIALIZED"
        : "VIEW_MANUAL_INSTRUCTIONS",
      message: isNowPayments
        ? "The order is pending payment setup. No cryptocurrency payment has been requested or confirmed."
        : "Open the authenticated order page to view the currently enabled manual-payment instructions.",
      orderUrl: `/account/orders/${row.order.publicId}`,
    },
  };
}

function addressCreateInput(
  kind: typeof OrderAddressKind.SHIPPING | typeof OrderAddressKind.BILLING,
  address: UsOrderAddressInput,
) {
  return {
    kind,
    recipientName: address.recipientName,
    company: address.company ?? null,
    line1: address.line1,
    line2: address.line2 ?? null,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    countryCode: "US",
    phone: address.phone ?? null,
  } as const;
}

type LockedSavedAddress = {
  id: bigint;
  recipientName: string;
  company: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
  phone: string | null;
};

async function assertAdminManualOrderAuthorization(
  tx: Prisma.TransactionClient,
  actorUserId: string,
) {
  const actorRows = await tx.$queryRaw<
    Array<{
      id: string;
      emailVerified: boolean;
      disabledAt: Date | null;
    }>
  >`
    SELECT
      actor."id",
      actor."email_verified" AS "emailVerified",
      actor."disabled_at" AS "disabledAt"
    FROM "app"."users" AS actor
    WHERE actor."id" = ${actorUserId}::uuid
    FOR SHARE OF actor
  `;
  const profileRows = await tx.$queryRaw<Array<{ isActive: boolean }>>`
    SELECT profile."is_active" AS "isActive"
    FROM "app"."admin_profiles" AS profile
    WHERE profile."user_id" = ${actorUserId}::uuid
    FOR SHARE OF profile
  `;
  const permissionRows = await tx.$queryRaw<Array<{ slug: string }>>`
    SELECT permission."slug"
    FROM "app"."user_roles" AS assignment
    INNER JOIN "app"."roles" AS assigned_role
      ON assigned_role."id" = assignment."role_id"
    INNER JOIN "app"."role_permissions" AS role_grant
      ON role_grant."role_id" = assigned_role."id"
    INNER JOIN "app"."permissions" AS permission
      ON permission."id" = role_grant."permission_id"
    WHERE assignment."user_id" = ${actorUserId}::uuid
      AND permission."slug" IN (
        'orders.manage',
        'payments.manage',
        'customers.read'
      )
    ORDER BY assignment."role_id", permission."id"
    FOR SHARE OF assignment, assigned_role, role_grant, permission
  `;
  const actor = actorRows[0];
  const profile = profileRows[0];
  const permissions = new Set(permissionRows.map(({ slug }) => slug));
  if (
    !actor?.emailVerified ||
    actor.disabledAt !== null ||
    !profile?.isActive ||
    ADMIN_MANUAL_ORDER_PERMISSIONS.some(
      (permission) => !permissions.has(permission),
    )
  ) {
    throw orderError(
      "ADMIN_AUTHORIZATION_CHANGED",
      "Administrator access changed before the order could be created.",
      403,
    );
  }
}

async function resolveOrderAddresses(
  tx: Prisma.TransactionClient,
  userId: string,
  selection: OrderAddressSelection,
) {
  if (selection.mode === "PROVIDED") {
    return {
      shippingAddress: selection.shippingAddress,
      billingAddress: selection.billingAddress ?? selection.shippingAddress,
    };
  }

  const rows = await tx.$queryRaw<LockedSavedAddress[]>`
    SELECT
      address."id",
      address."recipient_name" AS "recipientName",
      address."company",
      address."line1",
      address."line2",
      address."city",
      address."region",
      address."postal_code" AS "postalCode",
      address."country_code" AS "countryCode",
      address."phone"
    FROM "app"."addresses" AS address
    WHERE address."id" = ${BigInt(selection.addressId)}
      AND address."user_id" = ${userId}::uuid
      AND address."deleted_at" IS NULL
      AND address."country_code" = 'US'
    FOR SHARE OF address
  `;
  const address = rows[0];
  const parsed = address
    ? usOrderAddressSchema.safeParse({
        recipientName: address.recipientName,
        ...(address.company ? { company: address.company } : {}),
        line1: address.line1,
        ...(address.line2 ? { line2: address.line2 } : {}),
        city: address.city,
        region: address.region,
        postalCode: address.postalCode,
        countryCode: address.countryCode,
        ...(address.phone ? { phone: address.phone } : {}),
      })
    : null;
  if (!parsed?.success) {
    throw orderError(
      "ADDRESS_UNAVAILABLE",
      "The selected customer address is no longer available as a valid US address.",
      409,
    );
  }
  return {
    shippingAddress: parsed.data,
    billingAddress: parsed.data,
  };
}

async function createInsideTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  input: OrderCreationInput,
  now: Date,
  idempotencyKey: string,
  requestFingerprint: string,
  context: OrderCreationContext,
): Promise<CreatedCustomerOrder> {
  if (context.source === "ADMIN_WHATSAPP_MANUAL") {
    await assertAdminManualOrderAuthorization(tx, context.actorUserId);
  }

  const existing = await tx.payment.findUnique({
    where: { idempotencyKey },
    select: {
      publicId: true,
      method: true,
      status: true,
      metadata: true,
      order: {
        select: {
          userId: true,
          publicId: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          totalMinor: true,
          currency: true,
        },
      },
    },
  });

  if (existing) {
    if (
      existing.order.userId !== userId ||
      !metadataHasCheckoutFingerprint(existing.metadata, requestFingerprint)
    ) {
      throw orderError(
        "IDEMPOTENCY_CONFLICT",
        "This checkout retry key was already used for a different request.",
        409,
      );
    }
    return mapCreatedOrder(existing, false);
  }

  if (context.source === "ADMIN_WHATSAPP_MANUAL") {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT customer."id"
      FROM "app"."users" AS customer
      WHERE customer."id" = ${userId}::uuid
      FOR UPDATE OF customer
    `;
  }
  const customer = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      disabledAt: true,
      customerProfile: {
        select: { countryCode: true, preferredCurrency: true },
      },
      adminProfile: { select: { id: true } },
      _count: { select: { roleAssignments: true } },
    },
  });
  const paymentMethodConfig = await tx.paymentMethodConfig.findUnique({
      where: { method: input.paymentMethod },
      select: {
        method: true,
        isEnabled: true,
        settingKey: true,
        setting: { select: { value: true } },
      },
    });
  const checkoutChargesSetting = await tx.siteSetting.findUnique({
      where: { key: "commerce.checkout_charges" },
      select: { value: true },
    });

  if (!customer) {
    if (context.source === "ADMIN_WHATSAPP_MANUAL") {
      throw orderError(
        "CUSTOMER_INELIGIBLE",
        "The selected account is no longer an eligible verified US customer.",
        409,
      );
    }
    throw orderError(
      "AUTH_REQUIRED",
      "Sign in with your email and password before checking out.",
      401,
    );
  }
  if (
    context.source === "ADMIN_WHATSAPP_MANUAL" &&
    (!customer.emailVerified ||
      customer.disabledAt !== null ||
      !customer.customerProfile ||
      customer.customerProfile.countryCode !== "US" ||
      customer.customerProfile.preferredCurrency !== "USD" ||
      customer.adminProfile !== null ||
      customer._count.roleAssignments > 0)
  ) {
    throw orderError(
      "CUSTOMER_INELIGIBLE",
      "The selected account is no longer an eligible verified US customer.",
      409,
    );
  }
  if (
    context.source === "ADMIN_WHATSAPP_MANUAL" &&
    input.paymentMethod !== "WIRE_TRANSFER" &&
    input.paymentMethod !== "ZELLE"
  ) {
    throw orderError(
      "PAYMENT_METHOD_UNAVAILABLE",
      "Administrator-created orders support only Wire transfer or Zelle.",
      409,
    );
  }
  if (
    !paymentMethodConfig ||
    !isCheckoutPaymentMethodAvailable(
      input.paymentMethod,
      paymentMethodConfig,
      isNowPaymentsRuntimeOperational(),
    )
  ) {
    throw orderError(
      "PAYMENT_METHOD_UNAVAILABLE",
      "The selected payment method is not currently available.",
      409,
    );
  }
  const checkoutCharges = parseConfiguredCheckoutCharges(
    checkoutChargesSetting?.value,
  );
  if (!checkoutCharges) {
    throw orderError(
      "CHECKOUT_CONFIGURATION_INCOMPLETE",
      "Checkout shipping and tax charges have not been explicitly configured. Contact support before paying.",
      503,
      true,
    );
  }
  const { shippingAddress, billingAddress } = await resolveOrderAddresses(
    tx,
    userId,
    input.address,
  );

  const variants = await tx.productVariant.findMany({
    where: {
      ...buildPublishedVariantWhere(now),
      publicId: { in: input.items.map((item) => item.variantPublicId) },
      product: { is: buildPublishedProductWhere(now) },
    },
    select: {
      id: true,
      publicId: true,
      title: true,
      sku: true,
      optionValues: true,
      weightGrams: true,
      trackInventory: true,
      priceMode: true,
      product: {
        select: { id: true, title: true, slug: true },
      },
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
  });

  if (variants.length !== input.items.length) {
    throw orderError(
      "PRODUCT_UNAVAILABLE",
      "One or more items are no longer available for direct purchase.",
      409,
      true,
    );
  }

  const variantByPublicId = new Map(
    variants.map((variant) => [variant.publicId, variant]),
  );
  const lines: CheckoutLine[] = input.items.map((requested) => {
    const variant = variantByPublicId.get(requested.variantPublicId);
    if (!variant) {
      throw orderError(
        "PRODUCT_UNAVAILABLE",
        "One or more items are no longer available for direct purchase.",
        409,
        true,
      );
    }
    if (variant.priceMode !== PriceMode.FIXED) {
      throw orderError(
        "QUOTE_REQUIRED",
        "A quote-only item cannot be checked out at a client-supplied price. Contact support for an arrangement.",
        409,
        true,
      );
    }

    // The cart snapshot is only presentation state. MOQ is always evaluated
    // from the variant row selected inside this serializable DB transaction.
    const minimumEvaluation = evaluateMinimumOrderQuantity(
      variant.optionValues,
      requested.quantity,
    );
    if (!minimumEvaluation.ok) {
      if (minimumEvaluation.reason === "below_minimum") {
        throw orderError(
          "MINIMUM_ORDER_QUANTITY_NOT_MET",
          `The minimum direct-purchase quantity for ${variant.product.title} (${variant.title}) is ${minimumEvaluation.minimumOrderQuantity}. Update the cart and try again.`,
          409,
          true,
        );
      }
      throw orderError(
        "PRODUCT_UNAVAILABLE",
        "A product has an invalid minimum-order configuration and cannot be purchased directly. Contact support for help.",
        409,
        true,
      );
    }

    const price = selectCheckoutUsdPrice(variant.prices, now);
    if (!price) {
      throw orderError(
        "PRICE_UNAVAILABLE",
        "A current USD price is unavailable for one or more items. Contact support for help.",
        409,
        true,
      );
    }

    const lineTotalMinor = multiplyMinorAmount(
      price.amountMinor,
      requested.quantity,
    );
    return {
      variantId: variant.id,
      variantPublicId: variant.publicId,
      productId: variant.product.id,
      productName: variant.product.title,
      productSlug: variant.product.slug,
      variantName: variant.title,
      sku: variant.sku,
      optionValues: variant.optionValues,
      weightGrams: variant.weightGrams,
      trackInventory: variant.trackInventory,
      quantity: requested.quantity,
      unitPriceMinor: price.amountMinor,
      lineTotalMinor,
    };
  });

  const subtotalMinor = addMinorAmounts(
    lines.map((line) => line.lineTotalMinor),
  );
  const { shippingMinor, taxMinor, totalMinor } =
    calculateConfiguredCheckoutCharges(subtotalMinor, checkoutCharges);
  const allocatedTaxes = allocateCheckoutTax(
    lines.map((line) => line.lineTotalMinor),
    taxMinor,
  );
  const orderLines = lines.map((line, index) => {
    const allocatedTaxMinor = allocatedTaxes[index];
    if (allocatedTaxMinor === undefined) {
      throw new Error("Order tax allocation failed.");
    }
    return {
      ...line,
      taxMinor: allocatedTaxMinor,
      lineTotalMinor: addMinorAmounts([
        line.lineTotalMinor,
        allocatedTaxMinor,
      ]),
    };
  });
  await assertCustomerCheckoutQuota(tx, {
    userId,
    requestedReservedQuantity: orderLines
      .filter((line) => line.trackInventory)
      .reduce((sum, line) => sum + line.quantity, 0),
    now,
  });
  const reservationExpiresAt = new Date(
    now.getTime() + INVENTORY_RESERVATION_MILLISECONDS,
  );

  const order = await tx.order.create({
    data: {
      orderNumber: createOrderNumber(now),
      userId: customer.id,
      customerEmail: customer.email,
      customerPhone: shippingAddress.phone ?? null,
      currency: USD_CURRENCY,
      status: OrderStatus.PENDING_PAYMENT,
      paymentStatus: OrderPaymentStatus.PENDING,
      fulfillmentStatus: FulfillmentStatus.UNFULFILLED,
      subtotalMinor,
      discountMinor: BigInt(0),
      shippingMinor,
      taxMinor,
      totalMinor,
      placedAt: now,
      addresses: {
        create: [
          addressCreateInput(OrderAddressKind.SHIPPING, shippingAddress),
          addressCreateInput(OrderAddressKind.BILLING, billingAddress),
        ],
      },
      items: {
        create: orderLines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          productName: line.productName,
          productSlug: line.productSlug,
          variantName: line.variantName,
          sku: line.sku,
          optionValues:
            line.optionValues === null
              ? Prisma.JsonNull
              : (line.optionValues as Prisma.InputJsonValue),
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
          discountMinor: BigInt(0),
          taxMinor: line.taxMinor,
          lineTotalMinor: line.lineTotalMinor,
          currency: USD_CURRENCY,
          weightGrams: line.weightGrams,
        })),
      },
    },
    select: {
      id: true,
      publicId: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      totalMinor: true,
      currency: true,
      items: { select: { id: true, variantId: true } },
    },
  });

  const orderItemByVariantId = new Map(
    order.items.map((item) => [item.variantId?.toString(), item.id]),
  );
  for (const line of orderLines) {
    const orderItemId = orderItemByVariantId.get(line.variantId.toString());
    if (!orderItemId) {
      throw new Error("Order item snapshot mapping failed.");
    }
    if (line.trackInventory) {
      await reserveOrderItemInventory(tx, {
        variantId: line.variantId,
        orderItemId,
        quantity: line.quantity,
        now,
        expiresAt: reservationExpiresAt,
      });
    }
  }

  const payment = await tx.payment.create({
    data: {
      orderId: order.id,
      idempotencyKey,
      method: input.paymentMethod,
      status: paymentStatusFor(input.paymentMethod),
      currency: USD_CURRENCY,
      amountMinor: totalMinor,
      metadata: {
        checkoutSchemaVersion: 1,
        checkoutRequestHash: requestFingerprint,
        checkoutCharges: {
          configured: true,
          shippingFlatMinor: checkoutCharges.shippingFlatMinor,
          taxRateBps: checkoutCharges.taxRateBps,
        },
        providerMode:
          input.paymentMethod === "NOWPAYMENTS"
            ? "not_initialized"
            : "manual_pending",
        orderCreationSource: context.source,
        ...(context.source === "ADMIN_WHATSAPP_MANUAL"
          ? {
              adminManualOrder: {
                actorUserId: context.actorUserId,
                arrangementChannel: "WHATSAPP",
                addressMode: input.address.mode,
                paymentAlreadyReceived: false,
              },
            }
          : {}),
      },
    },
    select: { id: true, publicId: true, method: true, status: true },
  });

  if (context.source === "ADMIN_WHATSAPP_MANUAL") {
    await tx.paymentEvent.create({
      data: {
        paymentId: payment.id,
        eventType: "admin.manual_order.payment_created",
        statusBefore: null,
        statusAfter: PaymentStatus.PENDING,
        amountMinor: totalMinor,
        rawPayload: {
          arrangementChannel: "WHATSAPP",
          paymentAlreadyReceived: false,
        },
        occurredAt: now,
      },
      select: { id: true },
    });
    const creationSnapshot = {
      orderPublicId: order.publicId,
      orderNumber: order.orderNumber,
      customerUserId: customer.id,
      currency: USD_CURRENCY,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentPublicId: payment.publicId,
      paymentMethod: payment.method,
      paymentAttemptStatus: payment.status,
      totalMinor: totalMinor.toString(),
      itemCount: orderLines.length,
      itemQuantity: orderLines.reduce((sum, line) => sum + line.quantity, 0),
      addressMode: input.address.mode,
      arrangementChannel: "WHATSAPP",
    };
    await writeAdminAuditLog(tx, {
      actorUserId: context.actorUserId,
      action: "orders.manual.create",
      resourceType: "order",
      resourceId: order.publicId,
      before: null,
      after: creationSnapshot,
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: "order",
        aggregateId: order.publicId,
        eventType: "order.manual_created",
        payload: creationSnapshot,
      },
      select: { id: true },
    });
  }

  return mapCreatedOrder({ ...payment, order }, true);
}

export async function createCustomerOrder(
  userId: string,
  input: NormalizedCheckoutInput,
) {
  const db = getDb();
  const idempotencyKey = scopedCheckoutIdempotencyKey(
    userId,
    input.idempotencyKey,
  );
  const requestFingerprint = checkoutRequestFingerprint(input);

  return withSerializableRetry(() => {
    const now = new Date();
    return db.$transaction(
      (tx) =>
        createInsideTransaction(
          tx,
          userId,
          {
            items: input.items,
            paymentMethod: input.paymentMethod,
            address: {
              mode: "PROVIDED",
              shippingAddress: input.shippingAddress,
              ...(input.billingAddress
                ? { billingAddress: input.billingAddress }
                : {}),
            },
          },
          now,
          idempotencyKey,
          requestFingerprint,
          { source: "CUSTOMER_CHECKOUT" },
        ),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  });
}

export async function createAdminManualCustomerOrder(
  actorUserId: string,
  input: AdminManualOrderInput,
) {
  const db = getDb();
  const idempotencyKey = scopedAdminManualOrderIdempotencyKey(
    actorUserId,
    input.customerUserId,
    input.idempotencyKey,
  );
  const requestFingerprint = adminManualOrderRequestFingerprint(input);
  const address: OrderAddressSelection =
    input.address.mode === "SAVED"
      ? input.address
      : {
          mode: "PROVIDED",
          shippingAddress: input.address.value,
          billingAddress: input.address.value,
        };

  return withSerializableRetry(() => {
    const now = new Date();
    return db.$transaction(
      (tx) =>
        createInsideTransaction(
          tx,
          input.customerUserId,
          {
            items: input.items,
            paymentMethod: input.paymentMethod,
            address,
          },
          now,
          idempotencyKey,
          requestFingerprint,
          { source: "ADMIN_WHATSAPP_MANUAL", actorUserId },
        ),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  });
}
