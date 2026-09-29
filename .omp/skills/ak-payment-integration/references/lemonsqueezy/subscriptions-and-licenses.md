# Lemon Squeezy Subscriptions and License Keys

Subscription lifecycle, plan changes, pause/cancel, quantity and usage billing, refunds, Customer Portal and the License API. Verified 2026-09-26 against https://docs.lemonsqueezy.com.

## Subscription Statuses

| Status | Meaning | Access |
|--------|---------|--------|
| `on_trial` | Free trial; `trial_ends_at` set | Grant |
| `active` | Paid and current | Grant |
| `paused` | Payment collection paused (`pause.mode` `void` or `free`) | `free`: grant; `void`: your policy (service not offered) |
| `past_due` | Renewal failed; 4 retries over 2 weeks | Grant (docs: customer keeps access during retries) |
| `unpaid` | All retries failed; dunning rules apply | Revoke (docs: customer loses access) |
| `cancelled` | Cancelled, in grace period until `ends_at`; resumable | Grant until `ends_at` |
| `expired` | Ended (grace period over, or dunning finished) | Revoke; not resumable |

Source: https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object, https://docs.lemonsqueezy.com/help/online-store/recovery-dunning

Store at least: subscription `id`, `status`, `customer_id`, `order_id`, `product_id`, `variant_id`, `first_subscription_item.id` and `.quantity`, `renews_at`, `ends_at`, `trial_ends_at`, `card_brand`, `card_last_four`. Derive access from `status` (and `ends_at`), not from which event arrived last.

## Update a Subscription

`PATCH /v1/subscriptions/:id`:

```bash
curl -X PATCH "https://api.lemonsqueezy.com/v1/subscriptions/$SUBSCRIPTION_ID" \
  -H 'Accept: application/vnd.api+json' -H 'Content-Type: application/vnd.api+json' \
  -H "Authorization: Bearer $LEMONSQUEEZY_API_KEY" \
  -d '{ "data": { "type": "subscriptions", "id": "'"$SUBSCRIPTION_ID"'",
        "attributes": { "variant_id": 11, "invoice_immediately": true } } }'
```

| Attribute | Effect |
|-----------|--------|
| `variant_id` | Change plan. Prorated by default: upgrade charges the difference on the next invoice, downgrade credits it |
| `invoice_immediately` | Charge the prorated amount now (new invoice) |
| `disable_prorations` | No proration; new price at next renewal. Overrides `invoice_immediately` |
| `pause` | `{ "mode": "void" \| "free", "resumes_at": "<ISO 8601, optional>" }`; `null` unpauses |
| `cancelled` | `true` cancels, `false` resumes during the grace period |
| `trial_ends_at` | Change the trial end |
| `billing_anchor` | Day of month 1-31 (issues a paid prorated trial to the next occurrence); `null`/`0` resets to today and removes an active trial |

- Changing billing cycle, free/paid state or trial state can move the billing date or charge immediately.
- **PayPal subscriptions cannot be changed through this endpoint.** Send the customer to the portal URL instead. The docs name it `urls.update_customer_portal` on the subscription object page but `urls.customer_portal_update_subscription` on the update page and in the webhook sample; read both keys.

Sources: https://docs.lemonsqueezy.com/api/subscriptions/update-subscription, https://docs.lemonsqueezy.com/guides/developer-guide/managing-subscriptions

## Cancel, Resume, Expire

- Cancel: `DELETE /v1/subscriptions/:id` (or `PATCH` with `cancelled: true`). Status becomes `cancelled`, `ends_at` is set; access continues until then.
- Resume: `PATCH` with `cancelled: false` before `ends_at`; the original schedule continues.
- At `ends_at` the subscription becomes `expired` and cannot be resumed; a new checkout is required.
- There is no immediate-termination option documented; to end access now, revoke it in your app and cancel the subscription.

## Trials and Dunning

- Trials are configured on the variant/price; `checkout_options.skip_trial` removes the trial for one checkout.
- Card renewals retry 4 times over 2 weeks (`past_due`), then `unpaid`; dunning emails and an optional auto-cancel period are configured in Recovery settings. PayPal retries every 5 days and suspends after 2 failed billing cycles.
- Renewal reminder emails go out 7 days before renewal.

## Quantity and Usage-Based Billing

- **Quantity-based:** set `checkout_data.variant_quantities` (or `quantity` URL param) at checkout; change later with `PATCH /v1/subscription-items/:id` `{ quantity, invoice_immediately?, disable_prorations? }`. Returns `422` if the variant uses usage-based billing.
- **Usage-based:** charged in arrears; the checkout charges `0` and ignores `quantity`. Report usage:

```bash
curl -X POST "https://api.lemonsqueezy.com/v1/usage-records" \
  -H 'Accept: application/vnd.api+json' -H 'Content-Type: application/vnd.api+json' \
  -H "Authorization: Bearer $LEMONSQUEEZY_API_KEY" \
  -d '{ "data": { "type": "usage-records",
        "attributes": { "quantity": 5, "action": "increment" },
        "relationships": { "subscription-item": { "data": { "type": "subscription-items", "id": "1" } } } } }'
```

- `action`: `increment` (default; pair with "Sum of usage during period") or `set` (pair with "Most recent usage" aggregations)
- Current period usage: `GET /v1/subscription-items/:id/current-usage` (`404` if not usage-based)
- The subscription item ID is `first_subscription_item.id` (null during a free trial)
- Usage records have no idempotency key: aggregate locally and report from a job that records what was sent, or prefer `set` for totals so a retry is harmless

Sources: https://docs.lemonsqueezy.com/guides/developer-guide/usage-based-billing, https://docs.lemonsqueezy.com/api/usage-records/create-usage-record

## Invoices and Refunds

- Every subscription charge is a Subscription invoice (`/v1/subscription-invoices`, filter by `subscription_id`, `status`, `store_id`); `subscription_payment_*` webhooks carry this object.
- Refund a one-time order: `POST /v1/orders/:id/refund`
- Refund a subscription charge: `POST /v1/subscription-invoices/:id/refund`
- Body `{ "data": { "type": "orders" | "subscription-invoices", "id": "<id>", "attributes": { "amount": 100 } } }`; `amount` in minor units, omit for a full refund per the API docs (the JS SDK makes `amount` required)
- A refund does not cancel the subscription; cancel separately if access should end.
- Refunds emit `order_refunded` / `subscription_payment_refunded`; orders move to `refunded` or `partial_refund` and expose `refunded_amount`.
- The platform fee is not returned; Lemon Squeezy may itself refund within 60 days to prevent chargebacks.

Sources: https://docs.lemonsqueezy.com/api/orders/issue-refund, https://docs.lemonsqueezy.com/api/subscription-invoices/issue-refund

## Customer Portal

- Hosted, store-scoped billing portal: switch plans (variants you allow), pause/unpause, cancel/resume, manage payment methods, billing info and tax ID, view invoices, license keys and files.
- **Signed URL:** `urls.customer_portal` on Subscription and Customer objects; logs the customer in automatically, valid 24 hours. Fetch a fresh one (`GET /v1/subscriptions/:id` or `GET /v1/customers/:id`) when the user clicks Billing; don't store it.
- **Unsigned URL:** `https://[STORE].lemonsqueezy.com/billing` (magic-link login).
- `urls.update_payment_method` (24 h) opens the payment-method form, optionally in a Lemon.js overlay.
- Portal actions still arrive as webhooks; keep webhook sync in place.

Sources: https://docs.lemonsqueezy.com/guides/developer-guide/customer-portal, https://docs.lemonsqueezy.com/help/online-store/customer-portal

## License Keys

Enable per product/variant: activation limit and license length (subscription products have no length; the key expires when the subscription expires). Keys are emailed on purchase and shown in My Orders.

### License API (public, no API key)

| Endpoint | Params | Returns |
|----------|--------|---------|
| `POST /v1/licenses/activate` | `license_key`, `instance_name` (both required) | `activated`, `error`, `license_key`, `instance`, `meta` |
| `POST /v1/licenses/validate` | `license_key`, optional `instance_id` | `valid`, `error`, `license_key`, `instance` (or `null`), `meta` |
| `POST /v1/licenses/deactivate` | `license_key`, `instance_id` (both required) | `deactivated`, `error`, `license_key`, `meta` |

```bash
curl -X POST https://api.lemonsqueezy.com/v1/licenses/activate \
  -H "Accept: application/json" \
  --data-urlencode "license_key=$LICENSE_KEY" \
  --data-urlencode "instance_name=workstation-01"
```

- Form-encoded bodies (`Content-Type: application/x-www-form-urlencoded`), `Accept: application/json`, JSON responses; rate limit 60 requests/minute
- Key `status`: `inactive` (no activations), `active`, `expired`, `disabled`
- Persist `instance.id` from activation; validate and deactivate need it
- **Verify ownership:** compare `meta.store_id`, `meta.product_id` and/or `meta.variant_id` with your hard-coded IDs, otherwise a key for any other Lemon Squeezy product activates your app. Optionally match `meta.customer_email`.
- Activation fails once `activation_limit` is reached; deactivate old instances first
- Validate periodically and cache the result with a grace window for offline use

Sources: https://docs.lemonsqueezy.com/api/license-api, https://docs.lemonsqueezy.com/guides/tutorials/license-keys

### License Keys API (authenticated)

- `GET /v1/license-keys`, `GET /v1/license-keys/:id`, `GET /v1/license-key-instances`
- `PATCH /v1/license-keys/:id` with `activation_limit` (`null` = unlimited), `expires_at` (`null` = perpetual), `disabled`
- The license-keys tutorial still says keys cannot be disabled via the API; the update endpoint (added 2023-12-21) documents `disabled`. Prefer the endpoint and verify in test mode.
- Webhooks: `license_key_created` (sent with `order_created`), `license_key_updated`

Source: https://docs.lemonsqueezy.com/api/license-keys/update-license-key

## Resources

- Managing subscriptions: https://docs.lemonsqueezy.com/guides/developer-guide/managing-subscriptions
- Subscription object: https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object
- License API: https://docs.lemonsqueezy.com/api/license-api
