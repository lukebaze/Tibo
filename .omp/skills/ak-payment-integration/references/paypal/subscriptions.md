# PayPal Subscriptions

Catalog products, billing plans and subscriptions (Subscriptions API v1). Verified 2026-09-26 against OpenAPI `billing_subscriptions_v1.json` (v1.8) and `catalogs_products_v1.json` (v1.0), https://developer.paypal.com/subscriptions/about and linked pages, and the JS SDK v6 reference.

Billing Agreements and v1 Billing Plans (under Payments v1) are deprecated; use this API. Model: **product** → **plan** (price, cycles) → **subscription** (one buyer on one plan).

## Endpoints

| Call | Endpoint | Server SDK (`SubscriptionsController`) |
|------|----------|----------------------------------------|
| Create product | `POST /v1/catalogs/products` | not in the SDK; use REST |
| List / show / patch product | `GET /v1/catalogs/products[/{id}]`, `PATCH ...` | not in the SDK |
| Create plan | `POST /v1/billing/plans` | `createBillingPlan` |
| List / show / patch plan | `GET /v1/billing/plans[/{id}]`, `PATCH ...` | `listBillingPlans`, `getBillingPlan`, `patchBillingPlan` |
| Activate / deactivate plan | `POST /v1/billing/plans/{id}/activate` / `deactivate` | `activateBillingPlan`, `deactivateBillingPlan` |
| Update plan pricing | `POST /v1/billing/plans/{id}/update-pricing-schemes` | `updateBillingPlanPricingSchemes` |
| Create subscription | `POST /v1/billing/subscriptions` | `createSubscription` |
| Show / patch subscription | `GET/PATCH /v1/billing/subscriptions/{id}` | `getSubscription`, `patchSubscription` |
| Revise (plan or quantity) | `POST /v1/billing/subscriptions/{id}/revise` | `reviseSubscription` |
| Suspend / activate / cancel | `POST .../suspend` / `activate` / `cancel` | `suspendSubscription`, `activateSubscription`, `cancelSubscription` |
| Capture outstanding balance | `POST .../capture` | `captureSubscription` |
| List transactions | `GET .../transactions?start_time=&end_time=` (both required) | `listSubscriptionTransactions` |

`PayPal-Request-Id` is accepted on create product, create plan, create subscription and capture (keys kept 72 hours).

## 1. Product

```bash
curl -X POST https://api-m.sandbox.paypal.com/v1/catalogs/products \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -H "PayPal-Request-Id: product-pro-v1" \
  -d '{ "name": "Pro plan", "type": "SERVICE" }'
```

`name` and `type` (`PHYSICAL`, `DIGITAL`, `SERVICE`) are required. Omit `id` to get a `PROD-...` ID, or pass your own SKU.

## 2. Plan

```json
{
  "product_id": "PROD-XXXX",
  "name": "Pro monthly",
  "status": "ACTIVE",
  "billing_cycles": [
    { "tenure_type": "TRIAL", "sequence": 1, "total_cycles": 1,
      "frequency": { "interval_unit": "DAY", "interval_count": 14 } },
    { "tenure_type": "REGULAR", "sequence": 2, "total_cycles": 0,
      "frequency": { "interval_unit": "MONTH", "interval_count": 1 },
      "pricing_scheme": { "fixed_price": { "value": "10.00", "currency_code": "USD" } } }
  ],
  "payment_preferences": {
    "auto_bill_outstanding": true,
    "setup_fee_failure_action": "CANCEL",
    "payment_failure_threshold": 2
  }
}
```

- Required: `product_id`, `name`, `billing_cycles`, `payment_preferences`. `status` may be `CREATED` or `ACTIVE` at creation; only active plans can be subscribed.
- `interval_unit`: `DAY`, `WEEK`, `MONTH`, `YEAR` (+ `interval_count`).
- `tenure_type`: `TRIAL` (at most 2 per plan; a free trial needs no `pricing_scheme`) or `REGULAR`. `total_cycles`: `0` = infinite (regular only), otherwise 1-999.
- `payment_preferences.setup_fee` (money) charges once at start; `setup_fee_failure_action`: `CONTINUE` or `CANCEL`.
- Pricing models: fixed, quantity (`quantity_supported: true` + subscription `quantity`), volume and tiered (`pricing_scheme.pricing_model`: `VOLUME` / `TIERED` + `tiers`).
- Price changes via `update-pricing-schemes` apply to existing **and** future subscriptions; payments within 10 days of the change are not affected (OpenAPI `pricing_scheme.fixed_price`).

Sources: https://developer.paypal.com/subscriptions/pricing-plan, https://developer.paypal.com/subscriptions/trial-period

## 3. Subscription and Approval

Create the subscription on the server so you control `custom_id` (your user ID):

```bash
curl -X POST https://api-m.sandbox.paypal.com/v1/billing/subscriptions \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -H "PayPal-Request-Id: user_42:subscribe:pro-monthly" \
  -d '{
    "plan_id": "P-XXXX",
    "custom_id": "user_42",
    "application_context": {
      "user_action": "SUBSCRIBE_NOW",
      "shipping_preference": "NO_SHIPPING",
      "return_url": "https://example.com/billing/return",
      "cancel_url": "https://example.com/billing/cancel"
    }
  }'
```

The response has `status: APPROVAL_PENDING` and a `rel: approve` link. Hand the ID to the JS SDK v6 subscription session:

```javascript
const session = sdk.createPayPalSubscriptionSession({
  onApprove: async ({ subscriptionId }) => {
    await fetch('/api/subscriptions/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriptionId }),
    });
  },
  onCancel: () => {},
  onError: (err) => console.error(err.code),
});
button.addEventListener('click', () =>
  session.start({ presentationMode: 'auto' }, fetch('/api/subscriptions', { method: 'POST' }).then((r) => r.json())), // resolves { subscriptionId }
);
```

On confirm, the server calls `GET /v1/billing/subscriptions/{id}` and checks `status === 'ACTIVE'`, `plan_id`, and `custom_id` equals the logged-in user before granting access. Never trust the browser's `subscriptionId` alone.

The Subscriptions integration guide still shows the v5 pattern (`/sdk/js?client-id=...&vault=true&intent=subscription` with `createSubscription: (data, actions) => actions.subscription.create({ plan_id })`); v5 is deprecated, prefer the v6 session above.

Sources: https://developer.paypal.com/subscriptions/integrate, https://developer.paypal.com/sdk/js/reference

## Statuses

| `status` | Meaning | Access |
|----------|---------|--------|
| `APPROVAL_PENDING` | Created, buyer has not approved | No |
| `APPROVED` | Buyer approved, not yet active | No (wait) |
| `ACTIVE` | Billing | Yes |
| `SUSPENDED` | Paused by you, or by PayPal after reaching `payment_failure_threshold` | Your policy (usually no) |
| `CANCELLED` | Cancelled by you or the buyer | Until paid-through date, your policy |
| `EXPIRED` | All finite cycles completed | No |

`billing_info` carries `next_billing_time`, `last_payment`, `outstanding_balance`, `failed_payments_count`, `last_failed_payment`.

## Lifecycle Operations

- **Cancel:** `POST .../cancel` with `{ "reason": "..." }` (required). The request has no end-of-period option (only `reason`), so stop billing now and keep access until your stored paid-through date.
- **Suspend / reactivate:** `POST .../suspend` `{ "reason" }` (required), `POST .../activate` `{ "reason" }` (required to reactivate).
- **Upgrade/downgrade:** `POST .../revise` with `plan_id` and/or `quantity`. PayPal-wallet subscribers must re-consent via the returned `approve` link; without it billing continues on the old plan. Card subscriptions need no re-consent. New price starts next cycle; proration and one-time fees are not automatic.
- **Failed payments:** PayPal retries every 5 days, up to twice per cycle; an unrecovered cycle adds to `outstanding_balance`. Reaching `payment_failure_threshold` suspends the subscription. `auto_bill_outstanding: true` adds the balance to the next cycle.
- **Recover balance:** `POST .../capture` with `{ "note", "capture_type": "OUTSTANDING_BALANCE", "amount" }` (amount ≤ outstanding balance).

Sources: https://developer.paypal.com/subscriptions/tiers, https://developer.paypal.com/subscriptions/payment-failure-retry

## Webhooks for Subscriptions

| Event | Typical action |
|-------|----------------|
| `BILLING.SUBSCRIPTION.CREATED` | Sync only |
| `BILLING.SUBSCRIPTION.ACTIVATED` | Grant access (after confirming status by GET) |
| `PAYMENT.SALE.COMPLETED` | A cycle was paid: extend paid-through date (see the note below for linking the sale to the subscription) |
| `BILLING.SUBSCRIPTION.PAYMENT.FAILED` | Dunning UI |
| `BILLING.SUBSCRIPTION.SUSPENDED` | Restrict per policy |
| `BILLING.SUBSCRIPTION.CANCELLED` / `EXPIRED` | Revoke at paid-through date |
| `BILLING.SUBSCRIPTION.UPDATED` | Re-fetch and sync plan/quantity |
| `PAYMENT.SALE.REFUNDED` / `PAYMENT.SALE.REVERSED` | Mark refunded / charged back |
| `BILLING.PLAN.*`, `CATALOG.PRODUCT.*` | Catalog sync |

Events can arrive out of order and more than once: dedupe on event `id`, then re-fetch the subscription and apply its current `status`. Source: https://developer.paypal.com/subscriptions/webhooks

Linking a sale to its subscription: sale payloads are commonly reported to carry the subscription ID in `resource.billing_agreement_id`, but no current PayPal doc or schema fetched for this guide shows it. Confirm with a real sandbox event before relying on it; the documented fallback is `GET /v1/billing/subscriptions/{id}/transactions`.

## Refunding a Subscription Payment

Subscription charges are **sales** (`PAYMENT.SALE.*`), not Orders v2 captures. The event reference links sale refunds to the deprecated Payments v1 sale refund; the current docs give no Payments v2 path for sale IDs. Refund from the PayPal dashboard, or test in sandbox whether your sale/transaction ID works with `POST /v2/payments/captures/{id}/refund` before automating. Refunding does not cancel the subscription; cancel separately.

## Testing

- Sandbox buyer from Dashboard → Sandbox Accounts approves subscriptions; plans with a 1-day interval make renewals observable
- Simulate `BILLING.SUBSCRIPTION.*` and `PAYMENT.SALE.*` with the Webhooks simulator (mock events use webhook ID `WEBHOOK_ID`; see `webhooks.md`)
- Test: approval then immediate cancel, `SUSPENDED` after failures, revise without re-consent, duplicate `PAYMENT.SALE.COMPLETED`

Source: https://developer.paypal.com/subscriptions/test-go-live
