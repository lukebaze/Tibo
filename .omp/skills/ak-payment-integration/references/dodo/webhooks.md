# Dodo Payments Webhooks

Endpoint setup, Standard Webhooks signature verification, events, retries and idempotency. Verified 2026-09-26 against https://docs.dodopayments.com/developer-resources/webhooks, the `WebhookEventType` enum in `dodopayments` SDK 2.52.0 (`src/resources/webhook-events.ts`), the SDK `webhooks.unwrap` source, and the `standardwebhooks` 1.1.1 reference implementation.

## Setup

1. Dashboard → Developer → Webhooks → **Add endpoint**: HTTPS URL, select events (selecting none subscribes to **all** events). The signing secret is on the endpoint's **Overview** tab; test and live endpoints have separate secrets.
2. Or from code: `client.webhooks.create({ url, filter_types: ['payment.succeeded', ...], idempotency_key })`, then `client.webhooks.retrieveSecret(webhookId)` and store `secret` in your secret manager.
3. **Rotate secret** keeps the old secret valid for 24 hours; accept both during the overlap if you deploy in stages.
4. Optional per-endpoint settings: throttling (messages/second, queued not dropped), custom headers, JavaScript transformations, failure email alerts.

**Local development:** `dodo wh listen <local-url>` forwards real test-mode events with original headers (test key only). `dodo wh trigger <event> <url>` sends **unsigned** mock payloads, so it only exercises handlers that skip verification; the dashboard **Testing → Send example** sends properly signed samples (not retried).

**Network:** delivery IPs change over time; do not use IP allowlists as authentication. Verify the signature. Exempt the route from bot protection/WAF challenges.

Source: https://docs.dodopayments.com/developer-resources/webhooks

## Signature Verification (Standard Webhooks)

| Item | Value |
|------|-------|
| Headers | `webhook-id`, `webhook-timestamp` (unix seconds), `webhook-signature` |
| Signed content | `${webhook-id}.${webhook-timestamp}.${raw body}` |
| Key | secret with any `whsec_` prefix removed, then base64-decoded |
| Algorithm | HMAC-SHA256, base64 output |
| Header format | space-separated `v1,<base64>` entries; valid if any `v1` entry matches |
| Replay window | reject timestamps more than 5 minutes old or in the future |

Use the raw body bytes; parsing and re-serializing JSON breaks verification. Compare in constant time.

### SDK (recommended)

```typescript
import DodoPayments from 'dodopayments';

const client = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,   // also read from env by default
  environment: 'test_mode',
});

export async function POST(request: Request) {
  const rawBody = await request.text();
  const headers = {
    'webhook-id': request.headers.get('webhook-id') ?? '',
    'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '',
    'webhook-signature': request.headers.get('webhook-signature') ?? '',
  };

  let event;
  try {
    event = client.webhooks.unwrap(rawBody, { headers });   // throws on bad signature/timestamp
  } catch {
    return new Response('Invalid signature', { status: 401 });
  }

  const webhookId = headers['webhook-id'];               // idempotency key
  if (!(await claimEvent('dodo', webhookId))) return new Response('OK'); // atomic claim on a unique (provider, event_id) index; a retry must be able to reclaim a failed or stale claim, see processWebhookIdempotently
  await enqueue(webhookId, event);                       // worker applies it, then marks processed
  return new Response('OK');
}
```

- `unwrap` delegates to the `standardwebhooks` package. Source-verified trap: it only verifies when `headers` is passed; `unwrap(body, { headers: undefined })` just parses. Always pass the three headers.
- `unsafeUnwrap` (Python `unsafe_unwrap`, Go `UnsafeUnwrap`) never verifies; test-only.
- Python: `client.webhooks.unwrap(await request.body(), headers={...})`; Go: `client.Webhooks.Unwrap(rawBody, r.Header)`.

### Manual (Express)

```javascript
const crypto = require('crypto');

app.post('/api/webhooks/dodo', express.raw({ type: 'application/json' }), async (req, res) => {
  const id = req.get('webhook-id');
  const ts = req.get('webhook-timestamp');
  const sigHeader = req.get('webhook-signature') || '';
  if (!id || !/^\d+$/.test(ts || '') || Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
    return res.status(401).send('Invalid headers');
  }

  const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key)
    .update(`${id}.${Number(ts)}.`).update(req.body)      // req.body is the raw Buffer
    .digest();

  const ok = sigHeader.split(' ').some((entry) => {
    const [version, sig] = entry.split(',');
    const provided = Buffer.from(sig || '', 'base64');
    return version === 'v1' && provided.length === expected.length &&
      crypto.timingSafeEqual(provided, expected);
  });
  if (!ok) return res.status(401).send('Invalid signature');

  const event = JSON.parse(req.body.toString('utf8'));
  await handleIdempotently(id, event);
  res.sendStatus(200);
});
```

Register `express.raw` on this route before any global `express.json()`. Full implementation with tests: `scripts/dodo-webhook-verify.js`. The docs' Express example uses the `standardwebhooks` npm package (`new Webhook(secret).verify(payload, headers)`), which is equivalent.

## Payload

```json
{
  "business_id": "bus_H4ekzPSlcg",
  "type": "payment.succeeded",
  "timestamp": "2026-09-26T10:30:00Z",
  "data": { "payload_type": "Payment", "payment_id": "pay_...", "total_amount": 2999, "currency": "USD", "metadata": {} }
}
```

- `type` is the event name; `timestamp` (ISO 8601) is when the event occurred, not when it was delivered.
- `data.payload_type`: `Payment`, `Subscription`, `Refund`, `Dispute`, `LicenseKey`, `CreditLedgerEntry`, `CreditBalanceLow`, `AbandonedCheckout`, `DunningAttempt`, `EntitlementGrant`, `Payout`.
- `data` is the **latest** object state at delivery time, so a retried old event can carry newer state.
- There is **no event id in the body**; the idempotency key is the `webhook-id` header.
- Checkout-session `metadata` appears on the payment (`data.metadata`); subscriptions carry their own `metadata`.

## Events (48, SDK 2.52.0)

| Group | Events | Typical action |
|-------|--------|----------------|
| Payment | `payment.succeeded`, `payment.failed`, `payment.processing`, `payment.cancelled` | Fulfil one-time orders on `succeeded`; show failure reason |
| Subscription | `subscription.active`, `subscription.renewed`, `subscription.updated`, `subscription.plan_changed`, `subscription.past_due`, `subscription.on_hold`, `subscription.paused`, `subscription.unpaused`, `subscription.cancelled`, `subscription.expired`, `subscription.failed`, `subscription.update_payment_method` | Grant on `active`, extend on `renewed`, revoke on `on_hold`/`paused`/`cancelled`/`expired`, never grant on `failed` |
| Refund | `refund.succeeded`, `refund.failed` | Mark order refunded; decide access |
| Dispute | `dispute.opened`, `dispute.challenged`, `dispute.accepted`, `dispute.cancelled`, `dispute.expired`, `dispute.won`, `dispute.lost` | Flag account; respond in dashboard |
| License key | `license_key.created` | Store/display key |
| Entitlements | `entitlement_grant.created`, `entitlement_grant.delivered`, `entitlement_grant.failed`, `entitlement_grant.revoked` | Manual license fulfilment, access sync |
| Credits | `credit.added`, `credit.deducted`, `credit.expired`, `credit.rolled_over`, `credit.rollover_forfeited`, `credit.overage_charged`, `credit.overage_reset`, `credit.manual_adjustment`, `credit.balance_low` | Sync balances, low-balance alerts |
| Recovery | `abandoned_checkout.detected`, `abandoned_checkout.recovered`, `dunning.started`, `dunning.recovered` | Analytics only |
| Payout | `payout.created`, `payout.in_progress`, `payout.on_hold`, `payout.success`, `payout.failed` | Finance reconciliation |

A successful subscription charge emits both `payment.succeeded` and (for renewals and post-trial charges) `subscription.renewed`; drive access from subscription events and fulfil one-time orders from `payment.succeeded` (where `data.subscription_id` is null). Source: https://docs.dodopayments.com/developer-resources/webhooks/intents/webhook-events-guide, SDK `WebhookEventType`

## Delivery, Retries, Idempotency

- Return any `2xx` within **15 seconds** (connect + read timeout); anything else is a failure.
- Retries with backoff, 8 attempts total: immediately, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h. Replay single messages or recover failed/missing ranges from the dashboard.
- Duplicates happen: store `webhook-id` with a unique constraint and mark it processed only after the handler succeeds.
- Events can arrive out of order. Order by the body `timestamp` or, better, re-fetch the object (`client.subscriptions.retrieve`) and apply its current status.
- Ack fast and process on a queue; log `webhook-id` and `type`, not payloads (they include emails and addresses).
- Return 200 for unknown event types so new Dodo events do not trigger retries.

Source: https://docs.dodopayments.com/developer-resources/webhooks

## Mapping Events to Your Users

Pass your user/order ID in checkout `metadata` and store the `session_id`. Read it back from `data.metadata` on `payment.succeeded`, or from the subscription's `metadata`. Store `data.customer.customer_id` on your user for the portal, usage events and credit balances.

## Framework Helpers

- `@dodopayments/nextjs`, `express`, `hono`, `fastify`, `sveltekit`, `nuxt`, `astro`, `remix`, `tanstack`, `bun`, `better-auth`, `convex`: `Webhooks({ webhookKey, onPayload, onPaymentSucceeded, onSubscriptionActive, ... })` verifies with Standard Webhooks, validates the payload schema, then calls typed handlers.
- Source check (dodo-adapters, 2026-09-26): there is no typed `subscription.past_due` handler; catch it in `onPayload`.
- Adapter handlers receive only the parsed payload, not `webhook-id`; implement deduplication with a state-based upsert (compare `data.status`/timestamps) or verify manually when you need the header.
- Adapter docs name the env var `DODO_PAYMENTS_WEBHOOK_SECRET`; the SDK reads `DODO_PAYMENTS_WEBHOOK_KEY`. Pick one and pass it explicitly.
- Details: `sdk.md`.

## Testing

- `node scripts/dodo-webhook-verify.js '<payload-json>' whsec_<base64>` self-signs and verifies a payload.
- Dashboard **Send example** for signed deliveries; `dodo wh listen` for real test-mode events.
- Test invalid signature, stale timestamp, duplicate `webhook-id`, and `subscription.cancelled` arriving before `subscription.renewed`.

## Resources

- Webhooks guide: https://docs.dodopayments.com/developer-resources/webhooks
- Event guide: https://docs.dodopayments.com/developer-resources/webhooks/intents/webhook-events-guide
- Standard Webhooks spec: https://github.com/standard-webhooks/standard-webhooks
- SDK source: https://github.com/dodopayments/dodopayments-typescript
