# PayPal Webhooks

Subscription setup, signature verification (offline self-verification or postback), events, retries and idempotency. Verified 2026-09-26 against https://developer.paypal.com/api/rest/webhooks, https://developer.paypal.com/api/rest/webhooks/rest (integration guide with the official Node sample), https://developer.paypal.com/api/rest/webhooks/event-names and OpenAPI `notifications_webhooks_v1.json` (v1.11).

## Setup

1. Subscribe a listener URL per REST app: Developer Dashboard → Apps & Credentials → your app → Webhooks, or `POST /v1/notifications/webhooks` (`url`, `event_types[]`; `*` = all events)
2. Record the returned **webhook ID**. It is needed to verify every message and is **not** sent in the request; store it as `PAYPAL_WEBHOOK_ID` (sandbox and live differ)
3. Up to 10 listener URLs per app. Events only reach listeners of the app that generated them
4. Listener must be HTTPS on port 443; use a tunnel for local development

Management endpoints: `GET/PATCH/DELETE /v1/notifications/webhooks/{webhook_id}`, `GET /v1/notifications/webhooks-event-types`, `GET /v1/notifications/webhooks-events` (history), `POST /v1/notifications/webhooks-events/{event_id}/resend`, `POST /v1/notifications/simulate-event`.

**Delivery failures with no HTTP status** usually mean a firewall blocks inbound 443 or URL-filtering services flag your domain as malicious.

## Request Headers

| Header | Content |
|--------|---------|
| `paypal-transmission-id` | Unique ID of this HTTP transmission |
| `paypal-transmission-time` | Transmission time (RFC 3339) |
| `paypal-transmission-sig` | Base64 RSA signature |
| `paypal-cert-url` | X.509 certificate URL, e.g. `https://api.sandbox.paypal.com/v1/notifications/certs/CERT-...` |
| `paypal-auth-algo` | `SHA256withRSA` |

## Option A: Self-Verification (preferred)

PayPal calls self-verification "the preferred method as it will be faster and avoid extra API dependency and latency".

1. Build the signed message from the **raw** body:

   ```
   <paypal-transmission-id>|<paypal-transmission-time>|<your webhook ID>|<crc32(raw body) as unsigned decimal>
   ```

   The doc's table writes the format with spaces (`transmissionId | timeStamp | webhookId | crc32`); the official sample code joins with `|` and **no spaces**, which is what verifies. CRC32 is the standard IEEE CRC32 (`zlib.crc32` in Node ≥ 20.15/22.2, `buffer-crc32` in the sample: `parseInt("0x" + crc32(body).toString("hex"))`).
2. Download the certificate at `paypal-cert-url` (cache it per URL).
3. Verify `paypal-transmission-sig` (base64) over the message with RSA-SHA256 and the certificate's public key.

Security hardening (not in PayPal's sample, which fetches any URL from the header):
- `paypal-cert-url` is an unauthenticated header, so allowlist it tightly: `https://` on `api.paypal.com`, `api-m.paypal.com` or their `sandbox` variants, path under `/v1/notifications/certs/`, no query. A looser `*.paypal.com` check lets any PayPal page that echoes input serve an attacker key
- Reject if `paypal-auth-algo` is present and not `SHA256withRSA`
- Accept only a parseable X.509 certificate (never a bare public key) inside its validity dates, cache only certificates that parse, bound the cache, and time out the download; consider also checking its issuer chain
- Compare against the raw bytes; parsing and re-stringifying JSON breaks the CRC

```javascript
const express = require('express');
const PaypalWebhookVerifier = require('./paypal-webhook-verify');

const verifier = new PaypalWebhookVerifier(process.env.PAYPAL_WEBHOOK_ID); // downloads + caches certs

app.post('/api/webhooks/paypal', express.raw({ type: 'application/json' }), async (req, res) => {
  const result = await verifier.processAsync(req.body, req.headers); // Buffer: raw bytes
  if (!result.success) return res.status(400).send('Invalid signature');

  const { id, type, data } = result.event;             // id = WH-..., type = event_type
  if (!(await claimEvent('paypal', id))) return res.sendStatus(200); // atomic claim on a unique (provider, event_id) index; a retry must be able to reclaim a failed or stale claim, see processWebhookIdempotently
  await enqueue({ id, type, data });                   // worker applies it, then marks id processed
  res.sendStatus(200);                                  // 2xx fast
});
```

Register `express.raw` on this route before any global `express.json()`. Full implementation (offline, Node built-ins only): `scripts/paypal-webhook-verify.js`. PayPal's own sample answers `200` even for invalid signatures (it only skips processing); returning `400` is also fine and just triggers retries for forged messages.

## Option B: Postback (`verify-webhook-signature`)

```bash
curl -X POST https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "auth_algo": "<paypal-auth-algo>",
    "cert_url": "<paypal-cert-url>",
    "transmission_id": "<paypal-transmission-id>",
    "transmission_sig": "<paypal-transmission-sig>",
    "transmission_time": "<paypal-transmission-time>",
    "webhook_id": "<your webhook ID>",
    "webhook_event": <raw body, byte-for-byte>
  }'
# → { "verification_status": "SUCCESS" }  (or "FAILURE")
```

- All seven fields are required (OpenAPI `verify_webhook_signature`). Build the JSON by splicing the raw body text into `webhook_event`; re-serializing a parsed object can fail verification.
- Costs one API call (plus an OAuth token) per event and doesn't work for simulator mock events.
- The server SDK (`@paypal/paypal-server-sdk` 2.5.0) has **no** webhook helper; call the endpoint with your own HTTP client or self-verify.
- PayPal's guide sample posts to `api.sandbox.paypal.com`; the documented REST base is `api-m.sandbox.paypal.com` / `api-m.paypal.com`.

## Payload

```json
{
  "id": "WH-3F562076HD293871E-75F399086E414290U",
  "event_version": "1.0",
  "create_time": "2024-05-16T05:19:19.355Z",
  "resource_type": "capture",
  "resource_version": "2.0",
  "event_type": "PAYMENT.CAPTURE.COMPLETED",
  "summary": "Payment completed for $ 500.0 USD",
  "resource": {
    "id": "3Y662965014333303",
    "status": "COMPLETED",
    "amount": { "value": "500.00", "currency_code": "USD" },
    "final_capture": true,
    "seller_receivable_breakdown": {
      "gross_amount": { "value": "500.00", "currency_code": "USD" },
      "paypal_fee": { "value": "25.44", "currency_code": "USD" },
      "net_amount": { "value": "474.56", "currency_code": "USD" }
    },
    "supplementary_data": { "related_ids": { "order_id": "9P99943869582473S" } }
  },
  "links": [{ "rel": "resend", "method": "POST", "href": "https://api.sandbox.paypal.com/v1/notifications/webhooks-events/WH-.../resend" }]
}
```

- `event_type` (not `type`), `resource` (not `data`); `resource_version` tells you which API shape the resource uses (`2.0` = Payments v2)
- Map back to your order with `resource.custom_id` / `invoice_id` (echoed when you set them) or `supplementary_data.related_ids.order_id`
- Payloads contain payer data; log `id` and `event_type`, not the body

## Events

| Event | Meaning | Typical action |
|-------|---------|----------------|
| `CHECKOUT.ORDER.APPROVED` | Buyer approved an order | Capture server-side if your browser flow didn't (redirect/APM flows) |
| `CHECKOUT.PAYMENT-APPROVAL.REVERSED` | Approved but problem before capture | Cancel local order, notify buyer |
| `PAYMENT.CAPTURE.COMPLETED` | Money captured | Fulfil (idempotent) |
| `PAYMENT.CAPTURE.PENDING` | Capture pending (review, eCheck, currency) | Wait |
| `PAYMENT.CAPTURE.DECLINED` | Capture declined | Mark failed |
| `PAYMENT.CAPTURE.REFUNDED` | Merchant refunded | Mark refunded; revoke per policy |
| `PAYMENT.CAPTURE.REVERSED` | PayPal reversed (e.g. chargeback) | Revoke, flag account |
| `PAYMENT.REFUND.PENDING` / `PAYMENT.REFUND.FAILED` | Refund states | Track |
| `PAYMENT.AUTHORIZATION.CREATED` / `VOIDED` | Authorization states (voided also at 30-day validity end) | Track |
| `BILLING.SUBSCRIPTION.*`, `PAYMENT.SALE.*` | Subscription lifecycle and cycle payments | See `subscriptions.md` |
| `CUSTOMER.DISPUTE.CREATED` / `UPDATED` / `RESOLVED` | Disputes | Flag, respond in time |
| `VAULT.PAYMENT-TOKEN.CREATED` / `DELETED` | Saved payment method changes | Sync |

Full list: https://developer.paypal.com/api/rest/webhooks/event-names. `PAYMENT.SALE.*` and `CHECKOUT.ORDER.PROCESSED` belong to deprecated Payments v1 flows, except `PAYMENT.SALE.*` still fires for Subscriptions v1 payments.

## Delivery, Retries, Idempotency

- Respond with any 2xx. No response, connection failure or non-2xx → PayPal retries **up to 25 times over 3 days**, then marks the delivery Failed (resend manually from the Webhook Events dashboard or the resend API)
- The same event can arrive more than once; dedupe on the top-level `id` (`WH-...`) with a unique constraint. `paypal-transmission-id` identifies a delivery attempt, not the event
- Ordering is not guaranteed; make handlers state-based (re-fetch the capture/subscription and apply its current status)
- PayPal documents no replay window for `paypal-transmission-time`, and whether retries reuse the original time is not documented. The script's `toleranceSeconds` is off by default; if you enable it, confirm retries still pass
- Ack fast, process on a queue; return 2xx for unknown event types

## Testing

- `node scripts/paypal-webhook-verify.js '<payload-json>' WEBHOOK_ID` self-signs a payload with a throwaway RSA key and verifies it (offline)
- **Webhooks simulator** (Dashboard → Testing Tools, or `POST /v1/notifications/simulate-event`) sends mock events to any URL; mock events verify with the literal webhook ID `WEBHOOK_ID` and **cannot** use the postback API
- Then subscribe the URL to a sandbox app and generate real events (sandbox purchase → `PAYMENT.CAPTURE.COMPLETED`; subscription → `PAYMENT.SALE.COMPLETED`)
- Test invalid signature, cert URL on a non-PayPal host, duplicate `id`, and `PAYMENT.CAPTURE.REFUNDED` arriving before `COMPLETED`

## Resources

- Overview: https://developer.paypal.com/api/rest/webhooks
- Integration guide (self-verification sample): https://developer.paypal.com/api/rest/webhooks/rest
- Simulator: https://developer.paypal.com/api/rest/webhooks/simulator
- API reference: https://developer.paypal.com/api/webhooks/v1/
