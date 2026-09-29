# Creem Webhooks

Endpoint setup, `creem-signature` verification, events, retries and idempotency. Verified 2026-09-26 against https://docs.creem.io/code/webhooks, the OpenAPI `WebhookEventType` enum, and `creem` SDK 1.13.0 source (`packages/sdk/src/webhooks.ts`).

## Setup

1. Dashboard → Developers → Webhooks: add a public HTTPS URL and copy its signing secret (test and live endpoints have separate secrets)
2. Or register from code (key scope `webhooks:write`); an empty `events` list subscribes to every event:

```typescript
const webhook = await creem.webhooks.create({
  url: 'https://example.com/api/webhooks/creem',
  name: 'Billing',
  events: ['checkout.completed', 'subscription.paid', 'subscription.canceled', 'refund.created'],
});
// Store the secret in your secret manager: webhook.secret, or later creem.webhooks.getSecret(webhook.id)
```

3. Pause without deleting: `creem.webhooks.update(id, { status: 'disabled' })`

**Local development:** `creem listen --forward-to http://localhost:3000/api/webhooks/creem` creates a temporary CLI-mode endpoint, forwards each event with the real body and `creem-signature`, prints the signing secret at startup, and deletes the endpoint on exit. Forwards are not retried; replay from the dashboard. Live mode needs `--live`. Alternatively use a tunnel or the dashboard **Send test event** button.

**Network:** Creem has no static source IPs (test or live), so don't use IP allowlists as authentication. Exempt the webhook route from bot protection/WAF challenges (on Cloudflare, Bot Fight Mode can't be skipped by custom rules).

Sources: https://docs.creem.io/code/webhooks, https://docs.creem.io/code/cli#local-webhooks

## Signature Verification

| Item | Value |
|------|-------|
| Header | `creem-signature` |
| Algorithm | HMAC-SHA256, hex digest |
| Key | the webhook secret string as-is (UTF-8, including any `whsec_` prefix) |
| Message | the raw request body, byte-for-byte |
| Timestamp / replay window | none in this scheme |

Parsing then re-serializing JSON changes the bytes and breaks verification. Compare in constant time.

### SDK (recommended)

```typescript
import { constructWebhookEventEntity } from 'creem/webhooks';

export async function POST(request: Request) {
  const rawBody = await request.text();
  let event;
  try {
    event = await constructWebhookEventEntity(rawBody, request.headers, {
      secret: process.env.CREEM_WEBHOOK_SECRET!,
    });
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

  if (!(await claimEvent('creem', event.id))) return new Response('OK'); // atomic claim on a unique (provider, event_id) index; a retry must be able to reclaim a failed or stale claim, see processWebhookIdempotently
  await enqueue(event);            // worker applies the change, then marks event.id processed
  return new Response('OK');       // 200 fast
}
```

- `verifyWebhookSignature(rawBody, headers, { secret })` only verifies; `constructWebhookEventEntity` verifies and returns a typed event narrowed by `event.eventType`.
- Source-verified behavior (SDK 1.13.0): the helper first tries Standard Webhooks headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`, 5-minute tolerance) and falls back to `creem-signature` (also accepting `x-creem-signature` and a `sha256=` prefix). The public docs only describe `creem-signature`.
- It uses Web Crypto and throws when `globalThis.crypto.subtle` is missing; edge runtimes and Workers are fine.

### Manual (Express)

```javascript
const crypto = require('crypto');

app.post('/api/webhooks/creem', express.raw({ type: 'application/json' }), async (req, res) => {
  const provided = String(req.get('creem-signature') || '').trim().toLowerCase();
  const expected = crypto
    .createHmac('sha256', process.env.CREEM_WEBHOOK_SECRET)
    .update(req.body)              // Buffer: raw bytes
    .digest('hex');

  const ok = /^[0-9a-f]{64}$/.test(provided) &&
    crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  if (!ok) return res.status(400).send('Invalid signature');

  const event = JSON.parse(req.body.toString('utf8'));
  await handleIdempotently(event.id, event);
  res.sendStatus(200);
});
```

Register `express.raw` on this route before any global `express.json()`. Full implementation: `scripts/creem-webhook-verify.js`.

The docs' own manual snippets compare with `===`; use `timingSafeEqual` as above. Source: https://docs.creem.io/code/webhooks#webhook-signatures

## Payload

```json
{
  "id": "evt_5WHHcZPv7VS0YUsberIuOz",
  "eventType": "checkout.completed",
  "created_at": 1728734325927,
  "object": { "id": "ch_...", "object": "checkout", "request_id": "order_123", "order": {}, "customer": {}, "product": {}, "subscription": {}, "metadata": {} }
}
```

- `eventType` (not `type`), `object` (not `data`), `created_at` in epoch milliseconds
- Subscription events carry the subscription with nested `product`, `customer`, `metadata`, `current_period_end_date`, `last_transaction_id`
- `checkout.completed` puts amount and currency on `object.order`, not at the top level

## Events

| Event | Meaning | Typical action |
|-------|---------|----------------|
| `checkout.completed` | Checkout paid; order (and subscription) created | Fulfil one-time orders; link customer to user |
| `subscription.active` | New subscription created | Sync only |
| `subscription.paid` | Subscription payment collected (first and renewals) | Grant/extend access |
| `subscription.trialing` | Trial started | Grant trial access |
| `subscription.update` | Subscription modified | Sync plan/seats |
| `subscription.scheduled_cancel` | Cancels at period end | Keep access; retention |
| `subscription.canceled` | Terminated | Revoke |
| `subscription.past_due` | Payment failed, retrying | Recovery UI |
| `subscription.unpaid` | Collection failed | Recovery UI / suspend per policy |
| `subscription.expired` | Period ended without payment | Revoke |
| `subscription.paused` | Paused | Revoke |
| `refund.created` | Refund issued | Mark order refunded; decide access |
| `dispute.created` | Chargeback opened | Flag account |
| `credits.granted`, `credits.consumed`, `credits.auto_recharged`, `customer_credits.exhausted` | Customer-credit balance changes | Sync balances |

Source: OpenAPI `WebhookEventType`, https://docs.creem.io/api-reference/introduction

## Delivery, Retries, Idempotency

- Respond with HTTP 200; anything else is a failed delivery.
- 5 attempts total: initial, then after 30 s, 5 min, 30 min and 6 h; nothing is retried after 24 h. Resend manually from Dashboard → Developers.
- The same event can arrive more than once. Deduplicate on the top-level `id` (`evt_...`) with a unique constraint, and make side effects idempotent.
- Ordering is not documented as guaranteed; make handlers state-based (compare `updated_at` / `status`, or re-fetch the subscription) rather than trusting arrival order.
- Ack fast and process on a queue; don't log full payloads (they contain customer emails), log `id` and `eventType`.
- Return 200 for unknown event types so new Creem events don't trigger retries.

Source: https://docs.creem.io/code/webhooks

Note: `https://creem.io/SKILL.md` lists an older retry schedule (30 s, 1 m, 5 m, 1 h); the webhook guide and API introduction above are authoritative.

## Mapping Events to Your Users

Pass your user ID when creating the checkout (`metadata.referenceId` or `metadata.userId`) and optionally `request_id` for your order ID. Read it back from `object.metadata` (checkout) or the subscription's `metadata` (subscription events); the samples show checkout metadata copied onto the subscription. Store `customer.id` on your user for portal links.

## Framework Helpers

- Next.js: `Webhook({ webhookSecret, onGrantAccess, onRevokeAccess, onCheckoutCompleted, ... })` from `@creem_io/nextjs` reads the raw body and verifies `creem-signature`. `onGrantAccess` fires for active/trialing/paid; `onRevokeAccess` for paused/expired/canceled; `subscription.scheduled_cancel` only calls `onSubscriptionScheduledCancel`.
- Better Auth: the plugin serves `/api/auth/creem/webhook` when `webhookSecret` is set.
- Details: `sdk-and-cli.md`.

## Testing

- `node scripts/creem-webhook-verify.js '<payload-json>' whsec_xxx` self-signs and verifies a payload
- Test-mode purchases with `4111 1111 1111 1111` trigger real test deliveries
- Test invalid signature, duplicate `id`, and out-of-order `subscription.canceled` before `subscription.paid` cases

## Resources

- Webhooks guide: https://docs.creem.io/code/webhooks
- Create webhook API: https://docs.creem.io/api-reference/endpoint/create-webhook
- SDK source: https://github.com/armitage-labs/creem/tree/main/packages/sdk
