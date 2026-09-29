# Polar Webhooks

Event handling, signature verification, and monitoring.

## Setup

1. Organization Settings → Webhooks → **Add Endpoint**
2. Enter a publicly reachable HTTPS URL (Polar does not follow redirects; 3xx = failure)
3. Format: **Raw** for custom integrations (Discord/Slack formats also available)
4. Set a secret: generate one (recommended) or provide your own
5. Select events; optionally pin `api_version` (API: `POST /v1/webhooks/endpoints`)

**Delivery rules:**
- Timeout: **10 seconds** (aim to respond within 2 seconds; queue work)
- Any non-2xx is a failure; retried up to **10 times** with exponential backoff
- Endpoint auto-disabled after **10 consecutive failed deliveries** (re-enable in settings)
- Redeliver from the dashboard or `POST /v1/webhooks/events/{id}/redeliver`

**Local development:** `polar listen http://localhost:3000/` (Polar CLI, `curl -fsSL https://polar.sh/install.sh | bash`) or a tunnel such as ngrok.

## Signature Verification

### Headers
```
webhook-id: <message id>
webhook-timestamp: <unix seconds>
webhook-signature: v1,<base64 HMAC-SHA256>
webhook-api-version: 2026-04
```

Signed content: `${webhook-id}.${webhook-timestamp}.${rawBody}`. The signature header is a space-separated list of `v1,<sig>` entries. Reject timestamps more than 5 minutes off.

### Signing keys (two schemes)

| Secret generated | Scheme | HMAC key |
|------------------|--------|----------|
| By Polar on/after 2026-09-08 00:00 UTC | Standard Webhooks | base64-decoded secret after `whsec_` prefix (pass the secret as-is to a Standard Webhooks library) |
| Before that, or user-provided | Polar HMAC (legacy) | UTF-8 bytes of the full secret string (base64-encode it before giving it to a Standard Webhooks library) |

Regenerating an endpoint secret moves it to Standard Webhooks. No migration deadline for legacy secrets.

**SDK support:**
- Polar SDK 1.0.0-alpha.19+ (TS/Python preview) tries both keys; pass the dashboard secret as-is
- Stable `@polar-sh/sdk` 0.49 / `polar-sdk` 0.32 `validateEvent` only derive the legacy key (source-verified), so secrets generated after the cutoff need the 1.0 preview, a Standard Webhooks library, or `scripts/polar-webhook-verify.js`
- Stable 0.49 also throws `SDKValidationError` (after a valid signature) for event types it doesn't know: `subscription.cycled`, `subscription.paused`, `subscription.resumed`, `subscription.migrated`, `discount.*`

### TypeScript Verification (stable SDK)
```typescript
import express from 'express';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';

app.post('/webhook/polar', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = validateEvent(req.body, req.headers, process.env.POLAR_WEBHOOK_SECRET ?? '');
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return res.status(403).send('');
    }
    // SDKValidationError: signature was valid but the SDK can't parse this event type.
    // Acknowledge it; 5xx makes Polar retry and disables the endpoint after 10 failures.
    console.warn('Unparsed Polar event', req.headers['webhook-id'], error);
    return res.status(202).send('');
  }

  await enqueue(event); // process asynchronously
  res.status(202).send('');
});
```

### TypeScript Verification (SDK 1.0 preview)
```typescript
import { webhooks } from "@polar-sh/sdk/2026-04";

// Async; tries both signing keys
const event = await webhooks.validateEvent(rawBody, headers, process.env.POLAR_WEBHOOK_SECRET!);
// Errors: webhooks.PolarWebhookVerificationError, webhooks.PolarWebhookUnknownTypeError
```

### Python Verification (stable SDK)
```python
import os
from flask import Flask, request
from polar_sdk.webhooks import validate_event, WebhookVerificationError

app = Flask(__name__)

@app.route('/webhook/polar', methods=['POST'])
def polar_webhook():
    try:
        event = validate_event(
            body=request.data,
            headers=request.headers,
            secret=os.getenv('POLAR_WEBHOOK_SECRET', ''),
        )
    except WebhookVerificationError:
        return '', 403

    enqueue(event)
    return '', 202
```

### Manual Verification (both schemes)
```typescript
import crypto from 'crypto';

function signingKeys(secret: string): Buffer[] {
  const keys = [Buffer.from(secret, 'utf8')]; // legacy Polar HMAC
  const b64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) keys.push(Buffer.from(b64, 'base64')); // Standard Webhooks
  return keys;
}

function verify(rawBody: string, headers: Record<string, string>, secret: string): boolean {
  const id = headers['webhook-id'];
  const ts = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];
  if (!id || !ts || !signatures || !Number.isFinite(Number(ts))) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const expected = signingKeys(secret).map(key =>
    crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest()
  );

  return signatures.split(' ').some(entry => {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) return false;
    const provided = Buffer.from(sig, 'base64');
    return expected.some(e => e.length === provided.length && crypto.timingSafeEqual(e, provided));
  });
}
```
Full implementation: `scripts/polar-webhook-verify.js`.

## Event Types

Payload shape: `{ type, timestamp, api_version, data }`.

### Checkout
- `checkout.created`, `checkout.updated`, `checkout.expired`

### Order
- `order.created` - Order created (renewals start `pending`); check `billing_reason`
  - `purchase`, `subscription_create`, `subscription_cycle`, `subscription_update`, `subscription_meter_cycle`
- `order.paid` - Payment collected; use for fulfillment
- `order.updated` - Order changed (e.g. status)
- `order.refunded` - Order (partially) refunded

### Subscription
- `subscription.created`, `subscription.active`, `subscription.updated`
- `subscription.canceled` - Cancellation scheduled or immediate
- `subscription.uncanceled` - Scheduled cancellation reverted
- `subscription.revoked` - Access ended (status `canceled`)
- `subscription.past_due` - Renewal payment failed
- `subscription.cycled` - New billing period (also on trial conversion)
- `subscription.paused`, `subscription.resumed`
- `subscription.migrated` - Billing taken over from another provider

**Note:** `subscription.updated` is the catch-all fired alongside every status change.

### Customer
- `customer.created`, `customer.updated`, `customer.deleted`
- `customer.state_changed` - Active subscriptions, granted benefits or meters changed

### Seats & Members (seat-based pricing)
- `customer_seat.assigned`, `customer_seat.claimed`, `customer_seat.revoked`
- `member.created`, `member.updated`, `member.deleted`

### Benefit Grant
- `benefit_grant.created`, `benefit_grant.updated`, `benefit_grant.revoked`
- `benefit_grant.cycled` - Grant renewed for a new subscription period

### Refund
- `refund.created`, `refund.updated`

### Organization-level
- `benefit.created`, `benefit.updated`
- `product.created`, `product.updated`
- `discount.created`, `discount.updated`, `discount.deleted`
- `organization.updated`

## Event Sequences

- **Cancel at period end:** `subscription.updated` + `subscription.canceled` now; `subscription.updated` + `subscription.revoked` at period end
- **Immediate revoke:** `subscription.updated`, `subscription.canceled`, `subscription.revoked`
- **Renewal:** `subscription.cycled`, `subscription.updated`, `order.created`, then `order.updated`, `order.paid`
- **Pause:** `subscription.updated` now; `subscription.updated` + `subscription.paused` at period end
- **Resume:** `subscription.updated`, `subscription.resumed`, `order.created`

## Handler Implementation

### Basic Handler
```typescript
async function handleEvent(event) {
  switch (event.type) {
    case 'order.paid':
      await handleOrderPaid(event.data);
      break;

    case 'customer.state_changed':
      await syncAccess(event.data); // activeSubscriptions, grantedBenefits, activeMeters
      break;

    case 'subscription.revoked':
      await revokeAccess(event.data.customer.externalId);
      break;

    default:
      console.log(`Unhandled event: ${event.type}`);
  }
}
```

### Order Handler
```typescript
async function handleOrderPaid(order) {
  switch (order.billingReason) {
    case 'purchase':
      await fulfillOneTimeOrder(order);
      break;
    case 'subscription_create':
      await handleNewSubscription(order);
      break;
    case 'subscription_cycle':
      await handleRenewal(order);
      break;
    case 'subscription_update':
      await handlePlanChange(order);
      break;
  }
}
```

### Customer State Handler
```typescript
async function syncAccess(state) {
  const hasActiveSubscription = state.activeSubscriptions.length > 0;
  if (hasActiveSubscription) {
    await enableFeatures(state.externalId);
  } else {
    await disableFeatures(state.externalId);
  }
}
```

## Best Practices

### 1. Verify on the raw body, then acknowledge fast
Use `express.raw` / `request.text()`; re-serialized JSON breaks signatures. Enqueue and return 2xx (202) within a couple of seconds.

### 2. Idempotency
Deduplicate on the `webhook-id` header (stable across retries), not on `data.id` alone.

```typescript
const webhookId = req.headers['webhook-id'];
if (await db.processedWebhooks.exists(webhookId)) return res.status(202).send('');
await db.processedWebhooks.insert({ webhookId, type: event.type, receivedAt: new Date() });
```

### 3. Ordering
Deliveries can arrive out of order or be retried. Compare timestamps/status before overwriting state, or re-fetch current state (Customer State API) on each event.

### 4. Error Handling
- Invalid signature → 403 (Polar retries non-2xx; a persistent mismatch will disable the endpoint)
- Processing failure after acceptance → log, retry internally, keep returning 2xx

### 5. Firewalls
Allowlist Polar IPs (production: `3.134.238.10`, `3.129.111.220`, `52.15.118.168`, `3.134.178.243`, `74.220.50.0/24`, `74.220.58.0/24`). Cloudflare Bot Fight Mode blocks webhooks (403); disable it for the route. Exclude the webhook route from auth/CSRF middleware.

## Monitoring

### Dashboard
- Delivery history with payloads and response status
- Manual redelivery

### API
- `GET /v1/webhooks/deliveries` - Delivery log
- `PATCH /v1/webhooks/endpoints/{id}/secret` - Rotate secret (new secret uses Standard Webhooks)

## Framework Adapters

### Next.js (`@polar-sh/nextjs`)
```typescript
// app/api/webhook/polar/route.ts
import { Webhooks } from "@polar-sh/nextjs";

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  onPayload: async (payload) => { /* catch-all */ },
  onOrderPaid: async (payload) => { /* fulfill */ },
  onCustomerStateChanged: async (payload) => { /* sync access */ }
});
```

### BetterAuth (`@polar-sh/better-auth`)
`webhooks({ secret, onOrderPaid, onCustomerStateChanged, onPayload, ... })` plugin inside `polar({ client, use: [...] })`.

### Laravel (`danestves/laravel-polar`, community)
Routes under `polar/*` (exclude from CSRF). Listen to `Danestves\LaravelPolar\Events\WebhookHandled` or typed events such as `OrderCreated`, `SubscriptionUpdated`.

## Testing

```bash
# Sign and verify a payload locally (self-test)
node scripts/polar-webhook-verify.js '{"type":"order.paid","data":{"id":"o1"}}' whsec_xxx

# Forward sandbox events to localhost
polar listen http://localhost:3000/
```
