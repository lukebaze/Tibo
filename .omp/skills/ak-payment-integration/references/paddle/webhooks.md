# Paddle Webhooks

Notification destinations, `Paddle-Signature` verification, events, delivery and local testing. Verified 2026-09-26 against https://developer.paddle.com/webhooks, the OpenAPI spec and SDK source (Node 3.10.0, Python 1.15.0, Go v5.2.0).

## Notification Destinations

Create in the dashboard (Developer tools → Notifications) or via `POST /notification-settings`.

| Setting | Notes |
|---------|-------|
| `type` | `url` (HTTPS endpoint) or `email` |
| `subscribed_events` | Pick per destination; subscribe only to what you handle |
| `api_version` | Payload shape follows this, not the account default |
| `traffic_source` | `platform` (real events), `simulation` (simulator), `all` |
| `endpoint_secret_key` | `pdl_ntfset_...`; one per destination, used to verify signatures |

- Up to 10 active destinations per account. Sandbox and live are separate accounts with separate secrets.
- Webhooks go to every matching destination; each has its own secret.

Source: https://developer.paddle.com/webhooks/about/create-notification-destination

## Signature Verification

Header on every delivery:

```
Paddle-Signature: ts=1671552777;h1=eb4d0dc8853be92b7f063b9f3ba5233eb920a09459b6e6b2c26705b4364db151
```

| Step | Rule |
|------|------|
| 1 | Split the header on `;`, then each part on `=`: `ts` = Unix seconds, `h1` = hex signature |
| 2 | Signed payload = `ts + ":" + rawBody` (raw bytes exactly as received) |
| 3 | `h1` = hex(HMAC-SHA256(key = endpoint secret key, message = signed payload)) |
| 4 | Compare in constant time; accept if **any** `h1` matches (several appear while a secret rotates) |
| 5 | Reject old timestamps; the SDKs default to 5 seconds |

Never parse and re-serialize JSON before verifying: any whitespace or key-order change breaks the signature. Source: https://developer.paddle.com/webhooks/about/signature-verification

### SDK behaviour differs (source, 2026-09-26)

| Verifier | Multiple `h1` | Compare | Timestamp check |
|----------|---------------|---------|-----------------|
| Node `@paddle/paddle-node-sdk` 3.10.0 | Keeps the **last** `h1` only | `===` (not constant time) | Rejects if older than 5 s; no future check |
| Python `paddle-python-sdk` 1.15.0 | Any match; also accepts several secrets | `hmac.compare_digest` | Older than 5 s rejected |
| Go `paddle-go-sdk` v5.2.0 | Regex allows exactly one `h1` | `hmac.Equal` | Opt-in via `VerifierWithTimestampTolerance` |
| `scripts/paddle-webhook-verify.js` | Any match | `crypto.timingSafeEqual` | `|now - ts| > 5 s` rejected (configurable) |

During a secret rotation, Node and Go SDK users may see failures when the matching `h1` is not the last/only one. Tight 5 s windows also need a synced server clock (NTP).

### Node SDK

```typescript
import express from 'express';
import { Paddle, EventName, Environment } from '@paddle/paddle-node-sdk';

const paddle = new Paddle(process.env.PADDLE_API_KEY!, { environment: Environment.sandbox });
const app = express();

// Raw body only on this route; do not put express.json() in front of it
app.post('/webhooks/paddle', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = (req.headers['paddle-signature'] as string) || '';
  let event;
  try {
    event = await paddle.webhooks.unmarshal(
      req.body.toString(), process.env.PADDLE_WEBHOOK_SECRET!, signature,
    );
  } catch {
    return res.sendStatus(400);    // bad signature or payload
  }
  // Storage or queue errors propagate as 5xx so Paddle retries
  if (!(await claimEvent('paddle', event.eventId))) return res.sendStatus(200); // atomic claim on a unique (provider, event_id) index; a retry must be able to reclaim a failed or stale claim, see processWebhookIdempotently
  await enqueue(event);            // do slow work asynchronously
  res.sendStatus(200);
});
```

- `unmarshal` is async: `await` it (some docs snippets omit this). It throws on a bad signature and returns a typed entity (camelCase: `eventId`, `eventType`, `occurredAt`, `data`).
- `paddle.webhooks.isSignatureValid(rawBody, secret, signature)` verifies without parsing.

### Framework-agnostic (bundled script)

```javascript
const PaddleWebhookVerifier = require('./scripts/paddle-webhook-verify');
const verifier = new PaddleWebhookVerifier(process.env.PADDLE_WEBHOOK_SECRET); // { toleranceSeconds: 5 }

app.post('/webhooks/paddle', express.raw({ type: 'application/json' }), async (req, res) => {
  const result = verifier.process(req.body, req.headers);
  if (!result.success) return res.status(400).send(result.error);

  const { id, type, data } = result.event;      // id = event_id (evt_...)
  if (!(await claimEvent('paddle', id))) return res.sendStatus(200); // atomic claim on a unique (provider, event_id) index; a retry must be able to reclaim a failed or stale claim, see processWebhookIdempotently
  await enqueue({ id, type, data }); // worker dispatches, then marks the event processed
  res.sendStatus(200);
});

// Worker: isPaymentEvent(type) → fulfil order; isSubscriptionEvent(type) → sync
// subscription state; isAdjustmentEvent(type) → refund/chargeback. All idempotent.
```

Next.js App Router: read `await request.text()` before anything else and pass that string. Serverless platforms that pre-parse JSON must expose the raw body.

## Payload

```json
{
  "event_id": "evt_01h8bzakzx3hm2fmen703n5q45",
  "event_type": "transaction.completed",
  "occurred_at": "2026-09-26T09:15:12.123456Z",
  "notification_id": "ntf_01h8bzam1z32agrxjwhjgqk8w6",
  "data": { "id": "txn_01...", "status": "completed", "custom_data": { "orderId": "order_123" } }
}
```

- `data` is the full entity as of the event (same shape as the API for the destination's `api_version`).
- `event_id` identifies the event; `notification_id` identifies one delivery to one destination. **Deduplicate on `event_id`.**
- Order is not guaranteed. Compare `occurred_at` (or the entity's `updated_at`) with what you stored, or re-fetch the entity from the API before acting on stale data.
- `management_urls` for the customer portal are not included in subscription payloads.

## Events (56 in OpenAPI and the Node SDK, 2026-09-26)

| Entity | Events |
|--------|--------|
| `transaction` | `created`, `ready`, `billed`, `paid`, `completed`, `updated`, `canceled`, `past_due`, `payment_failed`, `revised` |
| `subscription` | `created`, `activated`, `trialing`, `updated`, `past_due`, `paused`, `resumed`, `canceled`, `imported` |
| `customer` / `address` / `business` | `created`, `updated`, `imported` |
| `adjustment` | `created`, `updated` |
| `payment_method` | `saved`, `deleted` |
| `payout` | `created`, `paid` |
| `product` / `price` / `discount` | `created`, `updated`, `imported` |
| `discount_group` | `created`, `updated` |
| `report` | `created`, `updated` |
| `api_key` | `created`, `updated`, `expiring`, `expired`, `revoked` |
| `api_key_exposure` | `created` |
| `client_token` | `created`, `updated`, `revoked` |

The docs also have pages for `product_collection.created` / `.updated`, which are not in the OpenAPI enum or Node SDK yet.

**Minimum set for most SaaS apps:** `transaction.completed` (or `transaction.paid`), `subscription.created`, `subscription.updated`, `subscription.canceled`, `adjustment.created`, `adjustment.updated`. Add `transaction.payment_failed` / `subscription.past_due` for dunning UI, and `api_key.expiring` / `api_key_exposure.created` for key hygiene.

**Typical checkout sequence:** `transaction.created` → `customer.created` → `address.created` → (`business.created`) → `transaction.updated`/`ready` → `transaction.paid` → `subscription.created` (recurring items) → `transaction.completed`. `transaction.paid` means captured; `completed` means Paddle finished processing (subscription linked, fees calculated). Fulfil on one of them and make it idempotent.

Source: OpenAPI `EventTypeName`; https://developer.paddle.com/webhooks/about/how-webhooks-work

## Delivery and Retries

| Item | Rule |
|------|------|
| Acknowledge | Respond `200` within 5 seconds; do heavy work in a queue |
| Retries (sandbox) | 3 attempts within 15 minutes |
| Retries (live) | 60 attempts over 3 days (20 in the first hour, 47 in the first day), exponential backoff |
| After exhaustion | Status `failed`; replay with `POST /notifications/{notification_id}/replay` |
| History | `GET /notifications`, `GET /notifications/{id}/logs` |

The "respond" page says `200`; the troubleshooting page says any `2xx`. Return `200` to be safe.

**Source IPs** (checked 2026-09-26; fetch current list from `GET /ips`):

| Environment | IPs |
|-------------|-----|
| Sandbox | 34.194.127.46, 54.234.237.108, 3.208.120.145, 44.226.236.210, 44.241.183.62, 100.20.172.113 |
| Live | 34.232.58.13, 34.195.105.136, 34.237.3.244, 35.155.119.135, 52.11.166.252, 34.212.5.7 |

If a WAF sits in front of the endpoint, allow the `Paddle` user agent and these IPs. IP allowlisting is defence in depth, not a replacement for signature checks.

Source: https://developer.paddle.com/webhooks/about/respond-to-webhooks, https://developer.paddle.com/webhooks/about/webhook-ips

## Local Testing

- **Webhook simulator** (Developer tools → Simulations): single events or scenarios (subscription created, renewed, paused, resumed, canceled). Simulated deliveries are signed with the destination secret, so they exercise your verifier. The destination's `traffic_source` must include `simulation`.
- **Tunnel:** `hookdeck listen 3000 paddle --path /api/webhook` gives a public URL for a sandbox destination. Any HTTPS tunnel works.
- **Bundled script** (self-signs then verifies, no network):

```bash
export PADDLE_WEBHOOK_SECRET=pdl_ntfset_placeholder
node scripts/paddle-webhook-verify.js '{"event_id":"evt_1","event_type":"transaction.completed","occurred_at":"2026-09-26T00:00:00Z","notification_id":"ntf_1","data":{"id":"txn_1"}}'
```

- Build test headers in unit tests with `PaddleWebhookVerifier.sign(rawBody, secret, { timestamp })`.

## Checklist

- [ ] Raw body passed to the verifier; no JSON middleware on the route
- [ ] Secret from env/secret store; sandbox and live secrets kept apart
- [ ] Constant-time compare, any-`h1` match, 5 s tolerance, NTP-synced clock
- [ ] Dedup table keyed by `event_id`; handlers idempotent
- [ ] `200` returned within 5 s; slow work queued
- [ ] Out-of-order events handled via `occurred_at` / re-fetch
- [ ] Refunds applied on `adjustment.updated` with `status: approved`
- [ ] Failed notifications monitored and replayed
