# Creem Subscriptions, Refunds, Portal and Licenses

Subscription lifecycle, plan changes, cancellation, refunds, customer portal, and license keys. Verified 2026-09-26 against the OpenAPI spec and https://docs.creem.io/features/subscriptions/introduction.

## Statuses

OpenAPI `SubscriptionStatus`: `active`, `trialing`, `past_due`, `unpaid`, `paused`, `scheduled_cancel`, `canceled`.

- `trialing` → `active` with the first regular payment (free and paid trials alike)
- `past_due`: a renewal payment failed; Creem retries automatically and emails the customer; success returns to `active`
- `unpaid`: payment collection failed; treat like `past_due` in recovery UI and apply your own access policy
- `scheduled_cancel`: still active until `current_period_end_date`, then `canceled`; can be resumed before then
- `canceled` is terminal
- The `subscription.expired` event fires when the period end is reached without payment; the docs say retries can still happen and the status is terminal only at `canceled`. There is no `expired` value in the status enum.

Sources: https://docs.creem.io/code/webhooks, https://docs.creem.io/features/subscriptions/refunds-and-cancellations

## Access Policy

Grant/revoke from webhooks, keyed by your user ID in checkout `metadata`:

| Event | Suggested action |
|-------|------------------|
| `subscription.active` | Sync only; Creem recommends `subscription.paid` for granting access |
| `subscription.paid`, `subscription.trialing` | Grant or extend access |
| `subscription.paused`, `subscription.expired` | Revoke |
| `subscription.canceled` | Revoke (the Next.js adapter includes it in `onRevokeAccess`) |
| `subscription.scheduled_cancel` | Keep access until `current_period_end_date`; notify/retain |
| `subscription.past_due`, `subscription.unpaid` | Show payment-recovery UI; revoke per your grace policy |

Sources: https://docs.creem.io/features/subscriptions/introduction, https://docs.creem.io/code/sdks/nextjs

Store `subscription.id`, `status` and `current_period_end_date` locally and gate features on your own table, not on redirects.

## Retrieve and List

- `GET /v1/subscriptions?subscription_id=...` → SDK `creem.subscriptions.get(id)`
- `GET /v1/subscriptions/search?page_number&page_size` → SDK `creem.subscriptions.search(page, pageSize)`; no status/product filter, so filter client-side
- Per customer: `GET /v1/customers/{id}/subscriptions`

## Plan Changes

**Upgrade/downgrade to another product:** `POST /v1/subscriptions/{id}/upgrade` with `product_id` and optional `update_behavior` (default `proration-charge-immediately`).

**Seat/unit update:** `POST /v1/subscriptions/{id}` with `items: [{ id, units }]` (an item without `id` is created) and optional `update_behavior`.

| `update_behavior` | Upgrade | Downgrade |
|-------------------|---------|-----------|
| `proration-charge-immediately` | Access changes now; prorated difference charged now | Unused time and tax refunded to the original payment method |
| `proration-charge` (deprecated) | Same as `proration-charge-immediately` | Same |
| `proration-none` | No prorated charge this period | No credit or refund |

Plan changes take effect immediately. Source: https://docs.creem.io/features/subscriptions/managing

```typescript
await creem.subscriptions.upgrade('sub_xxx', {
  productId: 'prod_pro',
  updateBehavior: 'proration-charge-immediately',
});

await creem.subscriptions.update('sub_xxx', {
  items: [{ id: 'item_xxx', units: 5 }],
  updateBehavior: 'proration-none',
});
```

**Raising prices for existing subscribers:** editing a product's price only affects new checkouts. Create a new product (same currency and interval) and move each subscription with the upgrade endpoint, typically with `proration-none` so the new price starts next cycle.

## Cancel, Pause, Resume

`POST /v1/subscriptions/{id}/cancel`:
- `mode`: `immediate` | `scheduled` (default comes from store billing settings)
- `onExecute`: `cancel` | `pause`, used only with `scheduled`

```typescript
await creem.subscriptions.cancel('sub_xxx', { mode: 'scheduled' }); // keep access until period end
await creem.subscriptions.pause('sub_xxx');   // stop billing, keep the subscription
await creem.subscriptions.resume('sub_xxx');  // from paused or scheduled_cancel
```

Prefer `scheduled` for customer-initiated cancels; `immediate` cuts access now. Ask before cancelling in live mode. Source: OpenAPI `CancelSubscriptionRequestEntity`, https://creem.io/SKILL.md

## Trials

- Product fields `trial_period_days` (≥ 1) and optional `trial_price` (paid trial, ≥ 1.00 and below the regular price)
- Free trial: card verified and saved, no charge; paid trial: charged at checkout, not auto-refunded on cancel
- Paid-trial checkouts are single-unit and can't use `custom_price`
- Discount codes apply to payments after the trial
- Changing trial settings affects new subscriptions only
- Better Auth plugin with `persistSubscriptions: true` limits each user to one trial

Source: https://docs.creem.io/features/trials, https://docs.creem.io/code/sdks/better-auth

## Refunds and Disputes

- API: `POST /v1/refunds` with `transaction_id` issues a **full** refund of the remaining refundable amount; status may be `pending` while the provider confirms. SDK: `creem.transactions.refund({ transactionId })`. CLI: `creem transactions refund <id> --yes`.
- Partial refunds: dashboard only (Transactions → Refund → amount).
- Refund status enum: `pending`, `requiresAction`, `succeeded`, `failed`, `canceled`.
- A `refund.created` webhook follows; its embedded `transaction.status` shows `refunded` (enum also has `partialRefund`).
- The refund docs don't say a refund cancels the subscription; cancel it explicitly when access should end.
- Disputes arrive as `dispute.created`; Creem manages chargebacks (25 USD/EUR fee).

Sources: https://docs.creem.io/api-reference/endpoint/refund-payment, https://docs.creem.io/features/subscriptions/refunds-and-cancellations, https://docs.creem.io/merchant-of-record/finance/refunds-and-chargebacks

Transaction IDs (`tran_...`) come from `subscription.last_transaction_id`, `refund.transaction.id`, or `GET /v1/transactions/search?customer_id&order_id&product_id`.

## Customer Portal

- After each payment the customer gets an email with a magic link to the Creem-hosted portal (separate login from your app).
- Customers can cancel subscriptions (immediately), update payment methods, view invoices and request support.
- Plan switching in the portal only works between products in a [product bundle](https://docs.creem.io/features/product-bundles) with self-service upgrades; otherwise use the upgrade API.
- Generate a link server-side:

```typescript
const { customerPortalLink } = await creem.customers.generateBillingLinks({
  customerId: 'cust_xxx',
});
```

REST: `POST /v1/customers/billing` `{ "customer_id": "cust_xxx" }` → `{ "customer_portal_link": "..." }`. Only generate links for the signed-in user's own customer ID.

Source: https://docs.creem.io/features/customer-portal

## License Keys

Enable **License Key Management** on a product (activation limit, expiry). On purchase Creem generates keys and shows them on the confirmation page, email receipt and portal; `checkout.completed` carries a `license_keys` array.

- Key format: five groups of five uppercase alphanumerics (`ABCDE-FGHIJ-KLMNO-PQRST-UVWXY`)
- One key per license feature × units purchased; treat `license_keys` as a list, and expect the field to be absent for products without keys
- Status: `inactive` (until first activation), `active`, `expired`, `disabled`; `activation_limit: null` means unlimited; instance status `active` | `deactivated`

| Endpoint | Body | Purpose |
|----------|------|---------|
| `POST /v1/licenses/activate` | `key`, `instance_name` | Register a device/instance; returns `instance.id` |
| `POST /v1/licenses/validate` | `key`, `instance_id` | Check status on startup / before premium features |
| `POST /v1/licenses/deactivate` | `key`, `instance_id` | Free an activation slot |
| `GET /v1/licenses/{id}/instances` | paging | List instances |

```typescript
const activated = await creem.licenses.activate({ key, instanceName: deviceLabel });
const instanceId = activated.instance?.id; // persist on the device

const check = await creem.licenses.validate({ key, instanceId });
if (check.status !== 'active') lockPremiumFeatures();
```

All license endpoints require the `x-api-key` header, so desktop or CLI apps must not ship the key. Route activation/validation through your backend and cache the result on the device for offline grace. Sources: https://docs.creem.io/features/addons/licenses, https://docs.creem.io/code/webhooks#license-keys

## Resources

- Lifecycle: https://docs.creem.io/features/subscriptions/introduction
- Managing: https://docs.creem.io/features/subscriptions/managing
- Refunds and cancellations: https://docs.creem.io/features/subscriptions/refunds-and-cancellations
- Seat-based billing: https://docs.creem.io/features/seat-based-billing
- License keys: https://docs.creem.io/features/addons/licenses
