# NOWPayments operations and activation

Ti-Shop contains a NOWPayments adapter, but this repository is **not connected to a live NOWPayments account**. A fresh environment is disabled, the database payment method is disabled, and the global online-payment switch is off. Mock verification demonstrates local state handling only; it is not a provider certification or a production transaction.

Use the provider's current primary documentation when provisioning an account or changing endpoints:

- [NOWPayments API reference](https://documenter.getpostman.com/view/7907941/2s93JusNJt)
- [NOWPayments payment statuses](https://nowpayments.zendesk.com/hc/en-us/articles/18395434917149-Payment-statuses)
- [NOWPayments IPN setup](https://nowpayments.zendesk.com/hc/en-us/articles/21395546303389-IPN-and-how-to-setup)
- [NOWPayments sandbox guide](https://nowpayments.io/blog/how-to-use-the-sandbox-a-guide)

Do not copy credentials, callback secrets, or recipient addresses into this file, source control, build arguments, `NEXT_PUBLIC_*`, screenshots, or support tickets.

## Two independent control planes

NOWPayments is available to a customer only when all relevant controls agree:

1. Runtime mode and credentials are valid.
2. The `NOWPAYMENTS` method is enabled in `/admin/payments`.
3. The `commerce.online_payments_enabled` global kill switch is on.
4. Checkout shipping and tax are explicitly configured.
5. The selected product/variant has a current fixed USD price and, when tracked, reservable US inventory.

Runtime configuration does not silently change database settings, and `db:seed` does not re-enable or disable an existing payment method. Keep the global switch off while credentials, callbacks, or deployment versions are changing.

## Runtime modes

| `NOWPAYMENTS_MODE` | Intended use | Requirements | Important boundary |
| --- | --- | --- | --- |
| `disabled` | Default and emergency off | No credential | Invoice initialization and IPN handling fail closed |
| `mock` | Local development/tests | High-entropy `NOWPAYMENTS_IPN_SECRET` | Rejected whenever `NODE_ENV=production`; never use as a live claim |
| `sandbox` | Provider sandbox verification | Sandbox API key, IPN secret, and the current official sandbox HTTPS `/v1` base URL | Production API host is rejected |
| `production` | Live account after approval | Production API key and IPN secret | API base defaults to `https://api.nowpayments.io/v1`; non-production provider hosts are rejected |

Variables read by the adapter:

```dotenv
NOWPAYMENTS_MODE=disabled
NOWPAYMENTS_API_BASE_URL=
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=
NOWPAYMENTS_TIMEOUT_MS=10000
```

`NOWPAYMENTS_TIMEOUT_MS` must be `1000..30000`. The IPN secret must contain at least 16 characters; use a substantially longer randomly generated value in real environments. Sandbox requires an explicit current base URL because provider sandbox endpoints can change. The application accepts only HTTPS `/v1` endpoints on a matching `*.nowpayments.io` host and deliberately rejects the production host in sandbox mode.

The public callback is:

```text
https://YOUR_EXACT_SITE_ORIGIN/api/payments/nowpayments/ipn
```

`SITE_URL` supplies that exact origin. It must be HTTPS in production, contain no path, and match the customer-facing trusted origin.

## Local mock workflow

Use mock only with `npm run dev` or automated tests, never the production Docker runner:

```dotenv
NOWPAYMENTS_MODE=mock
NOWPAYMENTS_IPN_SECRET=local-random-secret-at-least-16-characters
```

After migrations, seed, legacy import, inventory setup, and owner grant:

1. Configure shipping and tax in `/admin/payments`.
2. Enable the NOWPayments method.
3. Turn on the online-payment switch last.
4. Create an order as a signed-in customer and initialize its payment from the order page.
5. Use the clearly labeled local mock page to simulate provider statuses.
6. Confirm in the customer order and admin order views that waiting/confirming do not consume stock, while a valid final event confirms once and consumes the reservation once.

The mock adapter is deterministic and in-process. It does not contact NOWPayments, prove callback reachability, test provider credentials, verify settlement, or replace sandbox testing.

## Sandbox activation

Perform this against a non-production database and public staging HTTPS origin:

1. Keep the admin method and global online-payment switch disabled.
2. Obtain current sandbox credentials and the current sandbox `/v1` URL from the official documentation.
3. Generate a dedicated staging IPN secret and configure the exact staging callback in the provider dashboard.
4. Inject `NOWPAYMENTS_MODE=sandbox`, base URL, API key, IPN secret, and timeout through the runtime secret manager.
5. Restart the app and verify `/api/ready` is `200`. An invalid mode/host/credential shape makes readiness fail; readiness does not make a charge.
6. Configure a deliberate shipping/tax policy and a controlled fixed-price/inventory test item.
7. Enable the method, then enable the global switch last.
8. Exercise waiting, confirming, finished, partial, expired/canceled, wrong-asset, duplicate-callback, and delayed-callback cases where the sandbox permits them.
9. Run reconciliation and reservation expiry jobs and inspect payment events, order state, inventory movements, audit logs, and pending outbox rows.
10. Turn the global switch back off after the test window unless staging is intentionally kept available.

Do not promote sandbox API keys or the sandbox IPN secret to production.

## Production enablement order

Production activation is an operational change, not merely an environment edit:

1. Complete business/account approval with NOWPayments and independently verify the current production API/IPN instructions.
2. Back up the database and deploy a release that already passed local and sandbox verification.
3. Keep both the NOWPayments method and global online-payment switch off.
4. Configure the exact production HTTPS callback and a new production-only IPN secret in the provider dashboard.
5. Inject `NOWPAYMENTS_MODE=production`, the production API key, IPN secret, and timeout. The base URL may be omitted to use the code's pinned production default.
6. Restart the app and verify nginx health, app health, and `/api/ready`.
7. Schedule and alert on the reconciliation and reservation-expiry jobs before accepting orders.
8. Review customer-facing method text, checkout charges, fixed prices, and reservable inventory in the admin system.
9. Enable the NOWPayments method while the global switch remains off.
10. Enable the global online-payment switch last and conduct one controlled low-value order. Verify the provider dashboard, signed IPN, local payment events, order transition, and single inventory movement before broad availability.

If any check is ambiguous, turn the global switch off. Do not manually label a NOWPayments attempt paid through the manual wire/Zelle review action; that action intentionally refuses online-payment methods.

## IPN verification and idempotency

The IPN route:

- accepts only JSON and caps the body at 128 KiB;
- requires `x-nowpayments-sig` as a 128-character hexadecimal signature;
- recursively sorts JSON object keys, serializes the canonical payload, and verifies HMAC-SHA512 with a timing-safe comparison;
- validates the provider payload shape before database work;
- stores a fingerprinted payment event so exact duplicate source events are idempotent;
- returns `503` for a valid event that has not yet matched a local payment, allowing provider retry instead of acknowledging and discarding it;
- records state changes, order aggregation, inventory effects, and an outbox event in one serializable database transaction.

Never accept a browser redirect or customer screenshot as payment confirmation. Redirect return pages are presentation only; provider state must arrive through a verified IPN or reconciliation response.

## Status policy

| Provider status | Local behavior |
| --- | --- |
| `waiting` | Payment pending; order remains pending; stock remains reserved |
| `confirming`, `confirmed` | Awaiting confirmations; **not paid**; stock remains reserved |
| `sending` | Provider processing; **not paid** |
| `partially_paid` | Partial-payment state and manual review; no fulfillment |
| `finished` | Eligible for paid only after all integrity and amount checks pass |
| `refunded` | Refunded payment state |
| `failed` | Failed; a pending order closes when no other live attempt remains |
| `expired` | Expired/failed; reservation is released as the order closes |
| `cancelled` / `canceled` | Voided and review-marked policy path |
| `wrong_asset_confirmed` or unknown status | Review required; never auto-paid |

A `finished` payload is still rejected into review unless all of these match the immutable local payment/order: order reference, USD currency, exact fiat amount, positive expected crypto amount, complete actual paid amount, and payment asset. An overpayment is recorded as `OVERPAID`, counts as paid, consumes inventory once, and is flagged for operational review. A child/repeated deposit (`parent_payment_id`) creates or moves a payment attempt to review rather than silently merging funds.

Out-of-order events cannot regress a confirmed payment to a pending state. A late final event for an order already canceled by reservation expiry is forced to review and cannot consume missing/expired inventory.

## Reconciliation

Run periodically from the production operations image:

```bash
docker compose run --rm \
  --env NOWPAYMENTS_MODE \
  --env NOWPAYMENTS_API_KEY \
  --env NOWPAYMENTS_IPN_SECRET \
  operations \
  npm run payments:reconcile:nowpayments -- \
  --batch-size=50 --older-than-minutes=5 \
  --unlinked-invoice-minutes=60
```

Bounds are batch size `1..100`, linked-payment age `1..1440` minutes, and invoice-only age `1..10080` minutes. The job retrieves stale attempts that already have a provider payment ID and sends provider state through the same validation and transactional state machine as IPN. It also selects old invoice-only attempts, moves them to `REVIEW_REQUIRED`, records an event/outbox alert, and reports their identifiers. It exits non-zero on any failed selected payment or any unresolved invoice-only attempt.

Schedule it at a cadence appropriate to order volume (five minutes is a reasonable starting point), alert on any non-zero exit, `failed > 0`, or `unresolvedInvoices > 0`, and rerun while a full batch continues to be selected.

The base `operations` service receives only the limited database connection. The `--env` flags inherit exported provider values from the scheduler/host secret scope for this reconciliation container only, so inventory expiry and legacy import do not receive the NOWPayments API key/IPN secret. In sandbox, also pass `--env NOWPAYMENTS_API_BASE_URL`; pass `--env NOWPAYMENTS_TIMEOUT_MS` only when intentionally overriding its 10-second default.

The API-key status endpoint cannot query an invoice that has never exposed a payment ID. The hold therefore requires an operator with `payments.manage` and `orders.manage` to open the admin order and compare the invoice in the matching provider environment. Entering a payment ID performs a live lookup and refuses payment ID, invoice ID, provider mode, order reference, currency, or amount mismatches before using the normal event state machine. If the provider dashboard independently confirms there is no payment or deposit, the separate explicit unpaid action cancels the attempt and releases inventory in the same audited transaction. Never use it merely to silence an alert.

## Reservation expiry

Checkout reserves tracked inventory for 24 hours. Run the expiration job independently of reconciliation:

```bash
docker compose run --rm operations \
  npm run inventory:expire-reservations -- --limit=100
```

Repeat until the JSON output reports `reservations: 0`; `hasMore: true` means another batch may remain. Expiry releases reserved quantity without reducing on-hand stock, cancels the still-pending order, expires active unpaid attempts, moves partial payments to review, and records payment/outbox events. Invoice-only NOWPayments holds are deliberately skipped until the monitored provider review is resolved. Schedule this at least every few minutes so ordinary stale stock does not remain locked indefinitely.

## Emergency disable and credential rotation

For a suspected provider or callback incident:

1. Turn off the database global online-payment switch immediately.
2. Keep accepting no new NOWPayments attempts; do not delete existing payment rows or events.
3. Preserve app/proxy logs, provider event identifiers, order references, and timestamps without copying secrets or full customer payloads into chat.
4. Reconcile known provider payment IDs and place ambiguous/late/partial/repeated attempts into review.
5. Rotate the API key or IPN secret in the provider and secret manager, restart, and confirm readiness before re-enabling.

IPN-secret rotation must be coordinated because callbacks signed with the old secret will fail after the app changes. Keep the switch off during the boundary, drain or reconcile outstanding attempts, and document the exact cutover time.
