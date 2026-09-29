# Lemon Squeezy Webhooks

Setup, `X-Signature` verification, payload shape, events, retries and deduplication. Verified 2026-09-26 against https://docs.lemonsqueezy.com/help/webhooks, the developer guide, the Next.js tutorial, and the official Laravel package middleware (`lmsqueezy/laravel`, `VerifyWebhookSignature.php`).

## Setup

1. Dashboard → Settings → Webhooks → add an HTTPS URL, a **signing secret you choose** (docs: normally a random 6-40 character string), and the events to send. Test and live webhooks are separate.
2. Or via API (`POST /v1/webhooks`; `url`, `events`, `secret` required, `test_mode` optional):

```bash
curl -X POST "https://api.lemonsqueezy.com/v1/webhooks" \
  -H 'Accept: application/vnd.api+json' -H 'Content-Type: application/vnd.api+json' \
  -H "Authorization: Bearer $LEMONSQUEEZY_API_KEY" \
  -d '{ "data": { "type": "webhooks",
        "attributes": { "url": "https://example.com/api/webhooks/lemonsqueezy",
                        "events": ["order_created", "order_refunded", "subscription_created", "subscription_updated", "subscription_payment_success"],
                        "secret": "'"$LEMONSQUEEZY_WEBHOOK_SECRET"'" },
        "relationships": { "store": { "data": { "type": "stores", "id": "1" } } } } }'
```

- API responses omit the secret, so generate it yourself (e.g. `openssl rand -hex 20`), store it in a secret manager, and pass it in.
- Manage with `GET/PATCH/DELETE /v1/webhooks/:id`; `last_sent_at` shows delivery activity.
- Local development: expose the route with a tunnel, or use the Laravel package's `php artisan lmsqueezy:listen` (not supported on Windows).

Sources: https://docs.lemonsqueezy.com/api/webhooks/create-webhook, https://docs.lemonsqueezy.com/help/webhooks/signing-requests

## Request

```
POST /api/webhooks/lemonsqueezy
Content-Type: application/json
X-Event-Name: order_created
X-Signature: <64 hex chars>
```

HTTPS endpoints must present a valid TLS certificate (it is verified before sending). Source: https://docs.lemonsqueezy.com/help/webhooks/webhook-requests

## Signature Verification

| Item | Value |
|------|-------|
| Header | `X-Signature` |
| Algorithm | HMAC-SHA256, lowercase hex digest |
| Key | your signing secret string as-is (UTF-8) |
| Message | the raw request body, byte-for-byte |
| Timestamp / replay window | none |

Parse JSON only after verifying; re-serialized JSON changes the bytes. `X-Event-Name` is not covered by the signature: route on the signed `meta.event_name`.

```javascript
const crypto = require('crypto');

app.post('/api/webhooks/lemonsqueezy', express.raw({ type: 'application/json' }), async (req, res) => {
  const provided = String(req.get('X-Signature') || '').trim().toLowerCase();
  const expected = crypto
    .createHmac('sha256', process.env.LEMONSQUEEZY_WEBHOOK_SECRET)
    .update(req.body)                // Buffer: raw bytes
    .digest('hex');

  const ok = /^[0-9a-f]{64}$/.test(provided) &&
    crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  if (!ok) return res.status(400).send('Invalid signature');

  const event = JSON.parse(req.body.toString('utf8'));
  await storeThenProcess(dedupeKey(event), event);   // see Deduplication
  res.sendStatus(200);
});
```

- Register `express.raw` on this route before any global `express.json()`. In Next.js route handlers use `await request.text()`.
- The official Node sample compares UTF-8 buffers with `timingSafeEqual`, which throws when the header length differs; check the format first as above. Source: https://docs.lemonsqueezy.com/help/webhooks/signing-requests
- The Laravel package verifies `hash_hmac('sha256', $payload, $secret)` with `hash_equals` against the `x-signature` header, confirming the same scheme.
- Full implementation with tests: `scripts/lemonsqueezy-webhook-verify.js`.

## Payload

```json
{
  "meta": {
    "event_name": "subscription_created",
    "custom_data": { "user_id": "user_123" }
  },
  "data": {
    "type": "subscriptions",
    "id": "1",
    "attributes": { "store_id": 1, "customer_id": 1, "order_id": 1, "variant_id": 1, "status": "active", "test_mode": false, "updated_at": "2021-08-11T13:54:19.000000Z" },
    "relationships": { "...": {} },
    "links": { "self": "https://api.lemonsqueezy.com/v1/subscriptions/1" }
  }
}
```

- The body is a JSON:API resource object: `data.type` is `orders`, `subscriptions`, `subscription-invoices`, `license-keys`, `customers` or `affiliates` depending on the event.
- `meta.custom_data` is present on Order, Subscription and License key events when the checkout had custom data.
- `data.id` is a string; `attributes.*_id` values are integers.
- `data.attributes.test_mode` tells test from live; reject test events in production.
- One developer-guide sample omits the `data` wrapper; the webhook requests and example payload pages (and the Next.js tutorial) use `data`. Code against `data`.

## Events

| Event | `data` object | Typical action |
|-------|---------------|----------------|
| `order_created` | Order | Fulfil one-time purchase (check `status === 'paid'` and variant) |
| `order_refunded` | Order | Mark refunded/partially refunded (`refunded_amount`) |
| `subscription_created` | Subscription | Link subscription to user (always sent with `order_created`) |
| `subscription_updated` | Subscription | Catch-all sync of status, plan, dates, URLs |
| `subscription_cancelled` | Subscription | Keep access until `ends_at` |
| `subscription_resumed` | Subscription | Clear cancellation |
| `subscription_expired` | Subscription | Revoke |
| `subscription_paused` / `subscription_unpaused` | Subscription | Apply pause policy |
| `subscription_payment_success` | Subscription invoice | Record payment; first charge and renewals |
| `subscription_payment_failed` | Subscription invoice | Recovery UI |
| `subscription_payment_recovered` | Subscription invoice | Sent with `subscription_payment_success` after a failure |
| `subscription_payment_refunded` | Subscription invoice | Record refund |
| `license_key_created` / `license_key_updated` | License key | Sync key state |
| `customer_updated` | Customer | Sync profile (added 2026-02-25) |
| `affiliate_activated` | Affiliate | Affiliate tooling |

Recommended minimum: `order_created` for one-time sales; `subscription_created`, `subscription_updated`, `subscription_payment_success` for subscriptions. `subscription_updated` fires after every lifecycle change, so granular events are optional.

The "simulate" page also lists `subscription_plan_changed`, which is absent from the event-type list and the JS SDK types; do not depend on it.

Source: https://docs.lemonsqueezy.com/help/webhooks/event-types

## Delivery, Retries, Ordering

- Return HTTP `200`; any other status is a failure. Failed deliveries retry up to 3 more times with exponential backoff (e.g. 5 s, 25 s, 125 s), then stop. Resend recent webhooks from Settings → Webhooks.
- Store the event and return `200` fast; process from a queue. Log `meta.event_name`, `data.type`, `data.id`, not the payload (it contains names and emails).
- Several events fire for one action (e.g. `subscription_payment_success` + `subscription_updated`); ordering is not documented as guaranteed. Make handlers state-based: compare `attributes.updated_at` with what you stored, or re-fetch the object from the API.
- Return `200` for unknown event names so new events don't trigger retries.

Sources: https://docs.lemonsqueezy.com/help/webhooks/webhook-requests, https://docs.lemonsqueezy.com/guides/developer-guide/webhooks

## Deduplication

**Payloads carry no event ID or delivery ID** (none documented as of 2026-09-26), so build a key from signed fields:

```javascript
// Same event re-delivered (retry or manual resend) → same key.
const dedupeKey = (e) =>
  [e.meta.event_name, e.data.type, e.data.id, e.data.attributes.updated_at || ''].join(':');
```

- `event_name` separates `order_created` from `order_refunded` on the same order; `updated_at` separates successive `subscription_updated` events on the same subscription.
- Store it with a unique constraint `(provider, event_id)` and make side effects idempotent (upsert by `data.id`).
- If two distinct events could ever share `updated_at`, fall back to a SHA-256 of the raw body; it also matches exact re-deliveries.

## Mapping Events to Your Users

Put your IDs in `checkout_data.custom` (e.g. `user_id`, `order_id`) and read `meta.custom_data`. Subscription-invoice events do not document `custom_data`; resolve them via `attributes.subscription_id` → your stored subscription. Store `customer_id` for portal links.

## Testing

- `node scripts/lemonsqueezy-webhook-verify.js '<payload-json>' <secret>` self-signs and verifies a payload.
- Test-mode purchases (`4242 4242 4242 4242`) trigger real test deliveries.
- Dashboard "Simulate event" on test subscriptions/orders sends `subscription_*` and `order_*` events; `subscription_payment_*` simulation needs one real renewal (use a daily-interval test product).
- Test invalid signature, duplicate delivery, and `subscription_expired` arriving before `subscription_updated`.

Source: https://docs.lemonsqueezy.com/help/webhooks/simulate-webhook-events

## Resources

- Webhooks help: https://docs.lemonsqueezy.com/help/webhooks
- Signing requests: https://docs.lemonsqueezy.com/help/webhooks/signing-requests
- Example payloads: https://docs.lemonsqueezy.com/help/webhooks/example-payloads
- Next.js tutorial: https://docs.lemonsqueezy.com/guides/tutorials/webhooks-nextjs
