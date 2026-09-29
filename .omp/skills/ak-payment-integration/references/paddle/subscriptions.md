# Paddle Subscriptions, Refunds and Customer Portal

Lifecycle, plan changes and proration, pause/cancel, one-time charges, adjustments (refunds/credits/chargebacks) and the customer portal. Verified 2026-09-26 against https://developer.paddle.com and the OpenAPI spec (`PaddleHQ/paddle-openapi`).

## Lifecycle

Subscriptions are created by Paddle when a transaction with recurring prices is paid (checkout or API). You never `POST` a subscription directly.

Status (OpenAPI `StatusSubscription`): `trialing`, `active`, `past_due`, `paused`, `canceled`.

| Status | Access (Paddle's recommendation) | Notes |
|--------|----------------------------------|-------|
| `trialing` | Full | Same as active |
| `active` | Full | |
| `past_due` | Full, with a banner linking to update payment | Payment Recovery (Retain) retries automatically |
| `paused` | None or read-only | No transactions are created while paused |
| `canceled` | None | Terminal; cannot be reinstated |

`scheduled_change` (`action`: `cancel`, `pause`, `resume`; `effective_at`) records a pending end-of-period change. While it is set the subscription stays in its current status, and **you cannot update items**; gate self-serve plan changes on it.

Source: https://developer.paddle.com/build/subscriptions/provision-access-webhooks

## Provisioning From Webhooks

| Event | Action |
|-------|--------|
| `subscription.created` | Store `customer.id` and `subscription.id` on your user; grant access |
| `subscription.updated` | Re-read status, items, `scheduled_change`, billing period; covers renewals, upgrades, downgrades and status changes |
| `transaction.completed` | Record one-off charges or one-time purchases |
| `subscription.past_due` / `subscription.canceled` / `subscription.paused` / `subscription.resumed` | Optional fine-grained hooks; `subscription.updated` also carries these changes |

Store at least: `customer_id`, `subscription_id`, `status`, `items[].price.id`, `items[].price.product_id`, `scheduled_change.effective_at`, and the event `occurred_at` you last applied. Ignore events older than the stored `occurred_at` (delivery order is not guaranteed). Source: same page and https://developer.paddle.com/webhooks/about/how-webhooks-work

## Trials

- A trial comes from the price (`trial_period`), not from the subscription call.
- `POST /subscriptions/{id}/activate` ends a trial early and bills now.
- Extend or change a trial by updating `next_billed_at` on the trialing subscription.

Source: https://developer.paddle.com/build/trials/extend-activate-change-date-trials

## Upgrades, Downgrades and Add-ons

`PATCH /subscriptions/{id}` replaces the **whole** `items` list: include every item to keep, drop the old plan, add the new one.

```typescript
// Preview first and show the customer what they will pay
const preview = await paddle.subscriptions.previewUpdate('sub_01...', {
  items: [{ priceId: 'pri_enterprise_monthly', quantity: 1 }],
  prorationBillingMode: 'prorated_immediately',
});
// preview.immediateTransaction, preview.nextTransaction, preview.recurringTransactionDetails

const updated = await paddle.subscriptions.update('sub_01...', {
  items: [{ priceId: 'pri_enterprise_monthly', quantity: 1 }],
  prorationBillingMode: 'prorated_immediately',
  onPaymentFailure: 'prevent_change',   // or 'apply_change'
});
```

| `proration_billing_mode` | Behaviour |
|--------------------------|-----------|
| `prorated_immediately` | Prorate now, bill the prorated amount now |
| `prorated_next_billing_period` | Prorate now, bill on next renewal |
| `full_immediately` | No proration, bill the full amount now |
| `full_next_billing_period` | No proration, bill the full amount on next renewal |
| `do_not_bill` | Change items without charging |

- Proration is calculated to the minute; see `details.line_items[].proration` on the resulting transaction.
- `on_payment_failure` defaults to `prevent_change`: if the immediate charge fails, the change is not applied.
- Immediate chargeable updates are limited to 20 per subscription per hour and 100 per 24 h.
- `proration_billing_mode` is required when changing items (the docs always pass it; the OpenAPI marks no field required, so treat it as mandatory in practice).
- Other `PATCH` fields: `next_billed_at` (change billing date), `discount`, `collection_mode`, `billing_details`, `currency_code`, `custom_data`, `scheduled_change: null` (remove a pending change).

Source: https://developer.paddle.com/concepts/subscriptions/proration, https://developer.paddle.com/build/subscriptions/replace-products-prices-upgrade-downgrade, OpenAPI `PATCH /subscriptions/{subscription_id}`

## One-Time Charges on a Subscription

`POST /subscriptions/{id}/charge` with `items`, `effective_from` (`next_billing_period` or `immediately`) and optional `on_payment_failure`. Preview with `POST /subscriptions/{id}/charge/preview`. Source: OpenAPI; https://developer.paddle.com/build/subscriptions/bill-add-one-time-charge

## Cancel

```typescript
await paddle.subscriptions.cancel('sub_01...', { effectiveFrom: 'next_billing_period' }); // default
await paddle.subscriptions.cancel('sub_01...', { effectiveFrom: 'immediately' });
```

- `next_billing_period` creates a `scheduled_change` (`action: cancel`) at the next billing date and sets `next_billed_at` to null; status stays `active` until then. Keep access until `scheduled_change.effective_at`.
- `immediately` sets `status: canceled` now.
- Undo a scheduled cancel with `PATCH { "scheduled_change": null }`.
- Changes billed `next_billing_period` are forgiven on cancel. Canceled subscriptions cannot be reinstated: returning customers buy a new subscription (new checkout or transaction).

Source: https://developer.paddle.com/build/subscriptions/cancel-subscriptions

## Pause and Resume

```typescript
await paddle.subscriptions.pause('sub_01...', {
  effectiveFrom: 'next_billing_period',     // or 'immediately'
  resumeAt: '2026-12-01T00:00:00Z',         // omit for an open-ended pause
  onResume: 'start_new_billing_period',     // default; or 'continue_existing_billing_period'
});
await paddle.subscriptions.resume('sub_01...', { effectiveFrom: 'immediately' });
```

- Pausing cancels past-due renewal transactions (`origin: subscription_recurring`) to avoid double billing. Next-period credits are forgiven; next-period charges land on the resume transaction.
- `start_new_billing_period` bills immediately on resume; `continue_existing_billing_period` keeps the old period if the resume falls inside it.
- The pause guide says customers **cannot** pause from the customer portal; build pause in your app or use the dashboard. (The provisioning guide says the portal handles "pause or cancel"; the pause guide is more specific.)

Source: https://developer.paddle.com/build/subscriptions/pause-subscriptions

## Payment Failures

- Renewal failure: transaction goes `past_due`, subscription goes `past_due` (`transaction.payment_failed`, `transaction.past_due`, `subscription.past_due`).
- Paddle Retain Payment Recovery retries and emails the customer; when dunning is exhausted the subscription is paused or canceled per your dunning settings.
- Let customers fix cards via `GET /subscriptions/{id}/update-payment-method-transaction` (open the returned transaction in Paddle.js) or the portal `update_subscription_payment_method` link.

Source: https://developer.paddle.com/concepts/retain/payment-recovery-dunning, https://developer.paddle.com/build/subscriptions/update-payment-details

## Refunds, Credits and Chargebacks (Adjustments)

Billed/completed transactions are immutable financial records. Change money after the fact with `POST /adjustments`.

```typescript
// Full refund of a completed transaction
await paddle.adjustments.create({
  action: 'refund',
  type: 'full',
  transactionId: 'txn_01...',
  reason: 'customer_request',
});

// Partial refund of one line item (amount is tax-inclusive unless taxMode: 'external')
await paddle.adjustments.create({
  action: 'refund',
  type: 'partial',
  transactionId: 'txn_01...',
  reason: 'Partial refund for downtime',
  items: [{ itemId: 'txnitm_01...', type: 'partial', amount: '500' }],
});
```

| Field | Values |
|-------|--------|
| `action` | `refund`, `credit` (manual-collection invoices only); Paddle itself creates `chargeback`, `chargeback_warning`, `chargeback_reverse`, `credit_reverse`, `chargeback_warning_reverse` |
| `type` | `full`, `partial` (item `type`: `full`, `partial`, plus `tax`, `proration` in the enum) |
| `status` | `pending_approval` → `approved` or `rejected`; later `reversed` possible |

- Refunds need a `completed` transaction and return money to the original payment method. Credits need `billed` or `past_due` manually-collected transactions.
- **Live refunds usually need Paddle approval.** Auto-approved only when the account is verified and active, the refund is ≤ 400 USD (or equivalent), below your balance, and not a bank-transfer payment. Sandbox auto-approves every 10 minutes.
- You cannot create an adjustment for a transaction while another adjustment on it is `pending_approval`; wait for `approved` or `rejected` first.
- Mark your order refunded on `adjustment.updated` with `status: approved`, not when the create call returns.
- A refund does **not** cancel the subscription; cancel separately if access should end.
- Chargebacks: Paddle creates `chargeback` / `chargeback_warning` adjustments automatically, contests them, and creates `chargeback_reverse` when it wins. Listen to `adjustment.created`.
- Paddle emails a credit note PDF; `GET /adjustments/{id}/credit-note` returns a link.

Source: https://developer.paddle.com/build/transactions/create-transaction-adjustments, OpenAPI `AdjustmentAction`, `AdjustmentStatus`, `AdjustmentItemType`

## Customer Portal

Paddle-hosted portal: payment history and invoice PDFs, subscription details, update payment method, cancel (with Retain cancellation flows). Included by default.

```typescript
const session = await paddle.customerPortalSessions.create('ctm_01...', ['sub_01...']);
// session.urls.general.overview                        → portal home
// session.urls.subscriptions[0].cancelSubscription      → deep link to cancel
// session.urls.subscriptions[0].updateSubscriptionPaymentMethod
```

- Up to 25 `subscription_ids` per session. Authenticated links carry a short-lived `token`: create a new session per click, never cache or email them.
- Only create sessions for the customer ID stored on the signed-in user (check ownership server-side).
- `subscription.management_urls` (`cancel`, `update_payment_method`) also exist on API responses but require the customer to sign in by email, expire, and are not included in webhook payloads.

Source: https://developer.paddle.com/build/customers/integrate-customer-portal, https://developer.paddle.com/concepts/sell/customer-portal

## Testing

- Webhook simulator scenarios: subscription created, renewed, paused, resumed, canceled (Developer tools → Simulations). See `webhooks.md`.
- Sandbox card `4000 0027 6000 3184` succeeds first and declines later, useful for past-due flows.
- Move a sandbox renewal forward by updating `next_billed_at` rather than waiting.
