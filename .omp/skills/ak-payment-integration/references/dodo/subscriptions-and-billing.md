# Dodo Payments Subscriptions and Billing

Subscription lifecycle, plan changes, pause/cancel, on-demand charges, usage and credit billing, license keys, refunds and the customer portal. Verified 2026-09-26 against https://docs.dodopayments.com/features/subscription, https://docs.dodopayments.com/developer-resources/subscription-integration-guide, the refunds/license-key/customer-portal feature pages, and `dodopayments` SDK 2.52.0 types.

## Lifecycle

Create subscriptions through a checkout session with a `recurring_price` product (see `checkouts-and-products.md`).

| Status | Meaning | Access |
|--------|---------|--------|
| `pending` | Being created | None yet |
| `active` | Renews automatically | Grant |
| `past_due` | Renewal failed, grace period open (only if you enabled one); `past_due_ends_at` on the payload | Keep |
| `on_hold` | Renewal or plan-change charge failed; renewals stopped | Revoke; recoverable |
| `paused` | Deliberately paused; billing frozen | Revoke; resumable |
| `cancelled` | Will not renew (re-purchase only) | Revoke at the right time |
| `failed` | Initial mandate/payment failed; **terminal** | Never grant |
| `expired` | Term (`subscription_period_*`) ended | Revoke |

Webhook sequence (source: subscription integration guide):

- No trial: `subscription.active`, then `payment.succeeded` for the first charge (typically within 2-10 minutes).
- Trial: `subscription.active` at checkout with no charge; at trial end `payment.succeeded` **and** `subscription.renewed`.
- Every renewal: `subscription.renewed` alongside `payment.succeeded`, carrying the new `next_billing_date`. Use `subscription.renewed` to extend access.
- Failure: `subscription.failed` + `payment.failed` at creation; `subscription.past_due` (grace period) or `subscription.on_hold` on renewal failure.
- Any field change: `subscription.updated`.

Key `Subscription` fields: `subscription_id`, `status`, `product_id`, `quantity`, `customer.customer_id`, `next_billing_date`, `previous_billing_date`, `cancel_at_next_billing_date`, `cancelled_at`, `expires_at`, `paused_at`, `scheduled_change`, `metadata`, `recurring_pre_tax_amount`, `currency`, `trial_period_days`. The customer ID is nested under `customer`; some doc samples read `subscription.customer_id`, which the SDK type does not define.

## Cancel, Pause, Resume

```typescript
// Cancel at period end (keeps access until next_billing_date)
await client.subscriptions.update(subId, { cancel_at_next_billing_date: true });

// Cancel immediately
await client.subscriptions.update(subId, { status: 'cancelled', cancel_reason: 'cancelled_by_customer' });

// Pause / resume: send status ALONE; combining it with other fields returns 422
await client.subscriptions.update(subId, { status: 'paused' });
await client.subscriptions.update(subId, { status: 'active' });
```

- The old `pause` boolean was removed (2026-08 changelog); it now always returns 422.
- `status: 'active'` also resumes an `on_hold` subscription that has an unpaid pause invoice (voiding it).
- Other updatable fields: `metadata`, `billing`, `tax_id`, `customer_name`, `next_billing_date`, `cancellation_comment`, `cancellation_feedback`.

Source: SDK `SubscriptionUpdateParams`, https://docs.dodopayments.com/changelog/v1.113.6

## Plan Changes

```typescript
const preview = await client.subscriptions.previewChangePlan(subId, {
  product_id: 'pdt_pro', quantity: 1, proration_billing_mode: 'prorated_immediately',
});

await client.subscriptions.changePlan(subId, {
  product_id: 'pdt_pro',
  quantity: 1,
  proration_billing_mode: 'prorated_immediately',
  effective_at: 'immediately',          // or 'next_billing_date' (typical for downgrades)
  on_payment_failure: 'prevent_change', // or 'apply_change'
});
```

| `proration_billing_mode` | Behaviour |
|--------------------------|-----------|
| `prorated_immediately` | Credit unused time on the old plan, charge a full new cycle |
| `difference_immediately` | Charge the price difference now (upgrade); downgrade credit goes to future renewals |
| `full_immediately` | Charge the full new price now, reset cycle |
| `do_not_bill` | Switch without charges or credits |

- Scheduled changes appear in `scheduled_change`; cancel with `subscriptions.cancelChangePlan(subId)`.
- Optional: `addons`, `discount_codes`, `metadata`, `collect_via_payment_link` (needs a business setting).
- Events: `subscription.plan_changed` (and `payment.succeeded` when charged). A failed immediate charge can move the subscription to `on_hold` unless `on_payment_failure: 'prevent_change'`.

Source: https://docs.dodopayments.com/developer-resources/subscription-upgrade-downgrade

## Recovering `on_hold`

```typescript
const res = await client.subscriptions.updatePaymentMethod(subId, {
  payment_method: { type: 'new', return_url: 'https://example.com/billing' },
  // or { type: 'existing', payment_method_id: 'pm_...' }
});
// res.payment_link -> send the customer there; res.payment_id for the dues charge
```

On success you receive `payment.succeeded`, then `subscription.active`. Dunning emails and automatic payment retries (5% of recovered revenue) can also recover it; manual retry: `client.payments.retry(paymentId)` (max 3 sends with cooldowns).

## On-Demand Subscriptions

Create with `subscription_data.on_demand` on the checkout session (authorizes a mandate), then charge variable amounts:

```typescript
await client.subscriptions.charge(subId, { product_price: 2500, product_description: 'September usage' });
```

The SDK retries POSTs on 5xx/timeouts without an idempotency key; record the charge intent in your DB first and reconcile on timeout. Source: https://docs.dodopayments.com/developer-resources/ondemand-subscriptions

## Usage-Based Billing

1. Create a meter: `client.meters.create({ name, event_name: 'api_request', measurement_unit: 'requests', aggregation: { type: 'count' } })` (`sum`, `max`, `last` need `aggregation.key`, a metadata key).
2. Attach the meter to a `usage_based_price` product (free threshold and per-unit price) and sell it through checkout.
3. Ingest events:

```typescript
await client.usageEvents.ingest({
  events: [{
    event_id: `req_${requestId}`,     // idempotency key: repeats are ignored
    customer_id: 'cus_abc123',
    event_name: 'api_request',
    timestamp: new Date().toISOString(),
    metadata: { tokens: 150 },
  }],
});
```

- Max 1,000 events per request; duplicate `event_id` inside one request rejects the whole request.
- Timestamps older than 1 hour or more than 5 minutes in the future are rejected, so buffer briefly and flush often.
- Metadata: max 50 keys, keys up to 100 chars, values up to 500 chars; flat values only.

Sources: https://docs.dodopayments.com/features/usage-based-billing/event-ingestion, SDK `usage-events.ts`

**Credit-based billing:** credit entitlements grant credits via products/subscriptions (rollover, expiry, overage), meters deduct them; balances via `client.creditEntitlements.balances`; events `credit.*`. Source: https://docs.dodopayments.com/features/credit-based-billing

## License Keys

License keys are a License Key **entitlement** (Dashboard → Entitlements) attached to products; product-level `license_key_*` fields are deprecated.

- Issued automatically: one key per unit on `payment.succeeded` (one-time) or per seat on `subscription.active`; `license_key.created` fires. Subscription keys follow subscription status (disabled on `on_hold`/`paused`, permanently on `cancelled`/`expired`, reissued on `plan_changed`); one-time keys are disabled by `refund.succeeded`.
- Manual fulfillment mode: purchase creates a `Pending` grant (`entitlement_grant.created`); deliver with `POST /grants/{grant_id}/license-key` (409 if already fulfilled).
- Runtime endpoints are **public** (no API key checked), safe to call from desktop apps and CLIs:

```typescript
const pub = new DodoPayments({ bearerToken: 'public', environment: 'test_mode' }); // never ship a real key
const inst = await pub.licenses.activate({ license_key: key, name: 'MacBook-01' }); // inst.id -> "lki_..."
const { valid } = await pub.licenses.validate({ license_key: key, license_key_instance_id: inst.id });
await pub.licenses.deactivate({ license_key: key, license_key_instance_id: inst.id });
```

Activate returns 403 (key not active), 404 (unknown key), 422 (activation limit reached). Validation is `valid: true` only for active, unexpired keys. Source: https://docs.dodopayments.com/features/license-keys

## Refunds

```typescript
// Full refund
await client.refunds.create({ payment_id: 'pay_...', reason: 'customer_request' });

// Partial: per item (product_id or addon_id), amount in smallest unit
await client.refunds.create({
  payment_id: 'pay_...',
  items: [{ item_id: 'pdt_123', amount: 500, tax_inclusive: true }],
  metadata: { order_id: 'order_123' },
});
```

- Rules: payment must have succeeded; within the refund window (30 days by default); total refunds cannot exceed the amount paid; only one refund per payment may be `pending`/`review` at a time; your balance must cover it.
- Statuses: `pending`, `review`, `succeeded`, `failed`; final states fire `refund.succeeded` / `refund.failed`. Mark the order refunded on the webhook, not on the API response.
- A refund does not cancel a subscription; cancel it separately if access should end.
- Fee: $1 per refund (pricing page, 2026-09-26).

Source: https://docs.dodopayments.com/features/transactions/refunds

## Customer Portal

```typescript
const { link } = await client.customers.customerPortal.create('cus_abc123', {
  return_url: 'https://example.com/account',
  send_email: false,
});
// redirect the signed-in user to `link` (valid 24 h)
```

- Customers manage subscriptions, payment methods, invoices and license keys there.
- A static portal link (email sign-in) also exists; sign-in emails are not sent in test mode.
- Resolve `customer_id` from your authenticated session, never from a query parameter the user controls.

Source: https://docs.dodopayments.com/features/customer-portal

## Resources

- Subscriptions: https://docs.dodopayments.com/features/subscription
- Upgrades/downgrades: https://docs.dodopayments.com/developer-resources/subscription-upgrade-downgrade
- Usage-based billing guide: https://docs.dodopayments.com/developer-resources/usage-based-billing-guide
- License keys: https://docs.dodopayments.com/features/license-keys
- Refunds: https://docs.dodopayments.com/features/transactions/refunds
