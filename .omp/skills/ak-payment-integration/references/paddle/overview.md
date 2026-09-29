# Paddle Billing Overview

Merchant of Record (MoR) for SaaS, AI, mobile-app (web checkout) and digital products: Paddle is the legal seller, collects and remits sales tax/VAT/GST, handles PCI scope, fraud, chargebacks and billing support.

Verified 2026-09-26 against https://developer.paddle.com (llms.txt, llms-full.txt, `.md` pages), the OpenAPI spec in `PaddleHQ/paddle-openapi` (`v1/openapi.yaml`), and SDK source (`@paddle/paddle-node-sdk` 3.10.0, `paddle-python-sdk` 1.15.0, `paddle-go-sdk` v5.2.0, `paddlehq/paddle-php-sdk` 1.18.0).

## Paddle Billing vs Paddle Classic

This skill covers **Paddle Billing** only. Every account created after 2023-08-08 is on Billing; Classic accepts no new signups. Web results for "Paddle" often describe Classic, so check which one a codebase uses before editing it.

| Area | Classic (legacy) | Billing |
|------|------------------|---------|
| API base | `vendors.paddle.com/api`, form-encoded, vendor auth in body | `api.paddle.com`, JSON, Bearer API key |
| Success/error | `"success": true/false` in body | HTTP `2xx` with `data`/`meta`; `4xx`/`5xx` with `error`/`meta` |
| IDs | Auto-increment integers | Prefixed Paddle IDs (`pro_`, `pri_`, `txn_`, `sub_`, `ctm_`, `evt_`, `ntf_`...) |
| Catalog | Products (one-time) and plans (recurring) | Products with related prices; multi-item subscriptions |
| Webhooks | Form-encoded, signature inside the payload (verification requires PHP serialization); all endpoints get all events | JSON, `Paddle-Signature` header (HMAC-SHA256); events chosen per destination |
| Paddle.js | v1, `cdn.paddle.com/paddle/paddle.js`, `Paddle.Setup({ vendor })` | v2, `cdn.paddle.com/paddle/v2/paddle.js`, `Paddle.Initialize({ token })` |
| Custom data | `passthrough` string | `custom_data` object |
| Fulfillment | Paddle-issued license keys and downloads | Build your own from transaction/subscription webhooks |

Official SDKs and `@paddle/paddle-js` state they do not support Classic. Source: https://developer.paddle.com/llms.txt, https://developer.paddle.com/migrate/plan/data-mapping

## Fees (dated fact)

| Item | Amount | Source (checked 2026-09-26) |
|------|--------|-----------------------------|
| Pay-as-you-go | 5% + 50¢ per checkout transaction; no monthly or migration fees | https://www.paddle.com/pricing |
| Products under $10, or invoicing | Custom pricing (contact sales) | same |
| Balance/payout currencies | USD, EUR, GBP, AUD, CAD | https://developer.paddle.com/concepts/sell/supported-currencies |

The pricing page does not say whether the percentage applies to the tax-inclusive total; confirm the per-transaction breakdown via the transaction's payout totals before modelling margins. Recheck https://www.paddle.com/pricing before quoting fees.

## Credentials

| Credential | Format | Where it is used |
|------------|--------|------------------|
| API key | `pdl_sdbx_apikey_...` (sandbox) or `pdl_live_apikey_...` (live); 69 chars, regex `^pdl_(live\|sdbx)_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$` | Server only, `Authorization: Bearer <key>` |
| Client-side token | `test_` (sandbox) or `live_` + 27 chars | Frontend, `Paddle.Initialize({ token })`; can only open checkouts and preview prices/transactions, safe to publish |
| Webhook secret | `pdl_ntfset_<id>_<random>` per notification destination | Server only, signature verification |

- API keys are shown once; set permissions and an expiry (default 90 days, max 1 year). Keys created before 2025-05-06 are 50-char legacy keys without permissions or secret scanning; replace them.
- Paddle scans public GitHub repos and auto-revokes exposed keys (`api_key_exposure.created`, `api_key.revoked` webhooks). Subscribe to `api_key.expiring` (7 days before expiry) to rotate in time; rotatable keys can rotate automatically through AWS Secrets Manager.
- A sandbox credential against the live API (or the reverse) returns `403 forbidden`.
- Load credentials from environment variables or a secret store; never paste them into chat, prompts, client bundles or logs.

Source: https://developer.paddle.com/api-reference/about/authentication, https://developer.paddle.com/paddle-js/about/client-side-tokens, https://developer.paddle.com/api-reference/about/rotate-api-keys

## Environments

| Environment | API base | Dashboard | SDK setting |
|-------------|----------|-----------|-------------|
| Live | `https://api.paddle.com` | https://vendors.paddle.com | Node `Environment.production` (default) |
| Sandbox | `https://sandbox-api.paddle.com` | https://sandbox-vendors.paddle.com | Node `Environment.sandbox` |

- Sandbox is a separate account with separate keys, tokens, catalog, customers and notification destinations. Nothing carries over to live.
- Sandbox differences: no website approval, "Test Mode" watermark, refunds auto-approved every 10 minutes, webhook retries 3 times in 15 minutes (live: 60 in 3 days), emails only to your account domain.
- Paddle.js defaults to production; call `Paddle.Environment.set("sandbox")` before `Paddle.Initialize()` (or pass `environment: 'sandbox'` to `initializePaddle`).

**Sandbox test cards** (any name, any future expiry):

| Card | Result |
|------|--------|
| `4242 4242 4242 4242` | Success, no 3DS |
| `4000 0038 0000 0446` | Success with 3DS |
| `4000 0566 5566 5556` | Visa debit success |
| `4000 0000 0000 0002` | Declined |
| `4000 0027 6000 3184` | Succeeds first, declines later (renewal failure) |

Source: https://developer.paddle.com/sdks/sandbox

## API Versioning

- Send `Paddle-Version: 1` on every request. Version 1 is current (2026-09-26) and no version is deprecated.
- Without the header, Paddle uses the account default version. You cannot request a version older than your default.
- Notification destinations carry their own `api_version`; webhook payloads follow it, not the account default.
- The Node SDK does not send `Paddle-Version` (source: `src/internal/api/client.ts`); add it via `customHeaders` if you pin versions.

Source: https://developer.paddle.com/api-reference/about/versioning

## Money and Currency

- Amounts are **strings** holding integers in the lowest denomination: `{ "amount": "1000", "currency_code": "USD" }` is 10.00 USD. Zero-decimal currencies (JPY, KRW, CLP, VND) use whole units.
- 30+ payment currencies (OpenAPI `currency_code` enum includes USD, EUR, GBP, JPY, AUD, CAD, BRL, INR, KRW, VND...). Each has a minimum charge, e.g. USD 0.70, EUR 0.65, GBP 0.55, VND 20276.
- Tax: `tax_mode` on prices is `account_setting`, `external` (price excludes tax) or `internal` (price includes tax); `location` also exists in the OpenAPI enum. Products need a `tax_category` (`standard` and `saas` are enabled by default).

Source: OpenAPI `Money`, `TaxMode`; https://developer.paddle.com/concepts/sell/supported-currencies

## Errors

```json
{
  "error": {
    "type": "request_error",
    "code": "invalid_field",
    "detail": "Request does not pass validation.",
    "documentation_url": "https://developer.paddle.com/errors/shared/invalid_field",
    "errors": [{ "field": "description", "message": "maximum length of 256 exceeded" }]
  },
  "meta": { "request_id": "9346b365-4cad-43a6-b7c1-48ff6a1c7836" }
}
```

- Branch on `error.code` (e.g. `not_found`, `forbidden`, `invalid_field`, `conflict`, `too_many_requests`), not on `detail` text.
- Log `meta.request_id` for support. Retry `5xx` with exponential backoff.
- SDKs raise typed errors: Node `ApiError` (`code`, `detail`, `errors`, `retryAfter`), Python `ApiError.error_code`, Go `*paddle.APIError`, PHP `ApiError->errorCode`.

Source: https://developer.paddle.com/api-reference/about/errors, https://developer.paddle.com/errors

## Rate Limits (dated fact, checked 2026-09-26)

| Scope | Limit | On breach |
|-------|-------|-----------|
| All operations, per IP | 240 requests/min | `429 too_many_requests`, blocked 60 s, honor `Retry-After` |
| `POST /pricing-preview`, `POST /transactions/preview`, per IP | 1,000 requests/min | same |
| Chargeable subscription updates (`prorated_immediately` / `full_immediately`), per subscription | 20/hour, 100/24 h | `429 subscription_immediate_charge_*_limit_exceeded` |

`Paddle.PricePreview()` and `Paddle.TransactionPreview()` in the browser are not rate limited. Source: https://developer.paddle.com/api-reference/about/rate-limiting

## Idempotency

- The API **does not** accept client-supplied idempotency keys (https://developer.paddle.com/sdks/libraries). If a create call times out, list or get the entity before retrying, or you may create duplicates.
- Mitigations: store the Paddle ID as soon as a create returns; put your own order/user ID in `custom_data` so you can search for it; make webhook processing idempotent on `event_id`.
- The Node SDK sends a random `X-Transaction-ID` per request; it is a trace ID, not an idempotency key.

## Pagination

Cursor-based: `per_page` (most lists default 50, max 200; transactions 30; adjustments default 10, max 50) and `after=<last Paddle ID>`. Responses carry `meta.pagination.{next, has_more, estimated_total}`; `next` is always present, so loop on `has_more`. SDK list calls return iterators (`for await` in Node). Source: https://developer.paddle.com/api-reference/about/pagination

## Going Live

1. Complete account verification and get your website domain approved (Checkout → Website approval).
2. Set the **default payment link** (Checkout → Checkout settings); transactions cannot be created without it.
3. Recreate products/prices, client-side token, API key and notification destinations in the live account.
4. Switch base URL, API key, client token, webhook secret, and remove `Paddle.Environment.set("sandbox")`.
5. Allowlist the live webhook IPs if you filter by IP, then make one low-value live purchase and refund it.

Source: https://developer.paddle.com/build/go-live-checklist, https://developer.paddle.com/build/transactions/default-payment-link

## Resources

- Docs: https://developer.paddle.com (append `.md` to any page for markdown)
- LLM index: https://developer.paddle.com/llms.txt (full dump: https://developer.paddle.com/llms-full.txt)
- API reference: https://developer.paddle.com/api-reference
- OpenAPI: https://github.com/PaddleHQ/paddle-openapi
- Changelog: https://developer.paddle.com/changelog
- Status: https://paddlestatus.com

## Next Steps

- **Products, prices, Paddle.js checkout, transactions:** load `products-and-checkout.md`
- **Subscriptions, proration, refunds/adjustments, portal:** load `subscriptions.md`
- **Webhooks and `Paddle-Signature`:** load `webhooks.md`
- **SDKs, Paddle.js wrapper, MCP servers:** load `sdk.md`
