# PayPal Overview

PayPal REST APIs (Orders v2, Payments v2, Subscriptions v1, Webhooks v1) plus the PayPal JavaScript SDK v6 for buttons and card fields. PayPal is a payment processor, **not** a Merchant of Record: you are the seller, you calculate and remit tax, and you carry refunds, disputes and chargebacks.

Verified 2026-09-26 against https://developer.paypal.com (markdown pages via `<page>.md`, index at https://developer.paypal.com/llms.txt), the OpenAPI specs in https://github.com/paypal/paypal-rest-api-specifications, and `@paypal/paypal-server-sdk` 2.5.0 source.

## Core Capabilities

- **Orders v2:** create an order, buyer approves (PayPal, Pay Later, Venmo, cards, Apple Pay, Google Pay), then capture now (`intent: CAPTURE`) or authorize and capture later (`intent: AUTHORIZE`)
- **Payments v2:** capture/reauthorize/void authorizations, refund captures (full or partial)
- **Subscriptions v1:** catalog products, billing plans (fixed, quantity, volume, tiered pricing; up to 2 trial cycles), subscription lifecycle
- **Payment Method Tokens v3 (vault):** save PayPal, Venmo or cards for later or recurring charges
- **Webhooks v1:** RSA-signed notifications, verified offline (CRC32 + certificate) or by postback
- **JS SDK v6:** `<paypal-button>` web components, payment sessions, Card Fields with 3D Secure
- Server SDKs for TypeScript, Python, Java, .NET, PHP, Ruby (see `sdk.md`)

Sources: https://developer.paypal.com/api/rest, https://developer.paypal.com/sdk/js/set-up, https://developer.paypal.com/subscriptions/pricing-plan

**Not a Merchant of Record:** Orders take the tax you send (`amount.breakdown.tax_total`); PayPal does not compute or remit sales tax/VAT for you. If you need an MoR, use Polar or Creem.

## Fees (US, dated)

Checked 2026-09-26 on https://www.paypal.com/us/business/paypal-business-fees (page "Last Updated: September 1, 2026"). Rates differ per country; always read the fee page for the merchant's country.

| Payment type | Rate |
|--------------|------|
| PayPal Checkout, Venmo, PayPal Guest Checkout | 3.49% + fixed fee |
| Standard credit/debit card, Apple Pay, other third-party wallets | 2.99% + fixed fee |
| PayPal Pay Later | 4.99% + fixed fee |
| Advanced Credit and Debit Card Payments (Expanded Checkout) | 2.89% + fixed fee (Interchange++ available) |
| Fixed fee (USD) | 0.49 USD |
| International transactions | +1.50% on top of the domestic rate |

Also on that page: optional chargeback protection (0.40% / 0.60%), Fraud Protection Advanced (0.07 USD), separate chargeback and dispute fee tables. For the real fee on a payment, read `seller_receivable_breakdown.paypal_fee` from the capture instead of computing it.

## Authentication (OAuth 2.0 client credentials)

1. Developer Dashboard → **Apps & Credentials** → create an app (sandbox and live apps have separate credentials)
2. Exchange client ID + secret for an access token:

```bash
curl -X POST "https://api-m.sandbox.paypal.com/v1/oauth2/token" \
  -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials"
```

3. Call APIs with `Authorization: Bearer <access_token>`. The response carries `expires_in` (seconds); cache the token and refresh on expiry. PayPal's rate-limit guide explicitly says not to mint a token per transaction.

- Client ID is public (the browser SDK needs it). The client secret is server-only: never ship it to the browser, commit it, or paste it into chat or logs.
- The server SDK handles token fetch and refresh for you.
- Acting for another merchant (platforms) uses the `PayPal-Auth-Assertion` JWT header plus `PayPal-Partner-Attribution-Id` (BN code); out of scope here.

Sources: https://developer.paypal.com/api/rest/authentication, https://developer.paypal.com/api/rest/requests

## Environments

| Environment | REST API base | JS SDK v6 script | Server SDK |
|-------------|---------------|------------------|------------|
| Sandbox | `https://api-m.sandbox.paypal.com` | `https://www.sandbox.paypal.com/web-sdk/v6/core` | `Environment.Sandbox` (SDK default) |
| Live | `https://api-m.paypal.com` | `https://www.paypal.com/web-sdk/v6/core` | `Environment.Production` |

- Sandbox has its own apps, credentials, webhooks and generated buyer/seller accounts (Dashboard → Testing Tools → Sandbox Accounts). Nothing carries over to live.
- The server SDK defaults to Sandbox; set `Environment.Production` explicitly in production.
- A PayPal Business account is required to go live and to test outside the US.

Sources: https://developer.paypal.com/api/rest/requests, https://developer.paypal.com/api/rest

**Sandbox test cards:** use generated cards from Dashboard → Sandbox → Cards, or e.g. Visa `4012888888881881` with any future expiry and any 3-digit CVV. Put a rejection trigger in the cardholder name to simulate declines: `CCREJECT-REFUSED` (`0500`, DO_NOT_HONOR), `CCREJECT-SF` (`9500`, SUSPECTED_FRAUD), `CCREJECT-EC` (`5400`, EXPIRED_CARD). Source: https://developer.paypal.com/sandbox-testing/card-testing

## Money and Currency

- Amounts are **decimal strings** in major units: `{ "currency_code": "USD", "value": "19.99" }`. Not integer cents like Stripe/Polar/Creem; convert at the boundary.
- `HUF`, `JPY` and `TWD` are zero-decimal (`"1500"`, never `"1500.00"`).
- Supported currencies (checked 2026-09-26): AUD, BRL¹, CAD, CNY¹, CZK, DKK, EUR, HKD, HUF, ILS, JPY, MYR¹, MXN, NZD, NOK, PHP, PLN, GBP, SGD, SEK, CHF, THB, TWD, USD (¹ in-country accounts only). **VND is not supported**; Vietnamese merchants charge in USD (or another listed currency).
- Receiving a currency you don't hold leaves the payment `PENDING` until accepted, unless Payment Receiving Preferences auto-convert it.

Source: https://developer.paypal.com/reference/currency-codes

## Idempotency (`PayPal-Request-Id`)

Send a unique `PayPal-Request-Id` (UUID recommended; 38 single-byte character limit) on POSTs that support it. Retrying with the same ID returns the latest state of the original request instead of repeating the action; omitting it duplicates the action.

| API call | Key retention (OpenAPI/doc text) |
|----------|----------------------------------|
| Orders v2 create/authorize/capture | 6 hours (up to 72 h via account manager); **mandatory** for single-step create order with a `payment_source` (card, `vault_id`, billing agreement) |
| Payments v2 capture/reauthorize/void/refund | Not stated in the spec; the requests guide says refund IDs are honored for up to 45 days |
| Subscriptions v1 create plan / create subscription / capture | 72 hours |
| Catalog products create | 72 hours |
| Vault v3 payment/setup tokens | 3 hours |

- Use one ID per action and call type (the order create and its capture need different IDs). Derive them from your own order ID, e.g. `order_123:capture`.
- Two concurrent requests with the same ID: PayPal processes the first and may fail the second.
- A `5xx` or timeout from capture may still have captured: retry the **same** call with the **same** `PayPal-Request-Id` at least once before assuming failure.
- The server SDK does **not** generate this header; pass `paypalRequestId` yourself.

Sources: https://developer.paypal.com/api/rest/reference/idempotency, https://developer.paypal.com/api/rest/requests, OpenAPI `checkout_orders_v2.json`, `billing_subscriptions_v1.json`

## Errors

```json
{
  "name": "UNPROCESSABLE_ENTITY",
  "message": "The requested action could not be performed, semantically incorrect, or failed business validation.",
  "debug_id": "<correlation id>",
  "details": [{ "issue": "INSTRUMENT_DECLINED", "description": "The instrument presented was either declined by the processor or bank, or it can't be used for this payment." }],
  "links": [{ "href": "<error documentation link>", "rel": "information_link" }]
}
```

Shape per the OpenAPI `error` schema (`name`, `message`, `debug_id` required; `details`, `links` optional); values are illustrative.

| Status | `name` | Typical cause |
|--------|--------|---------------|
| 400 | `INVALID_REQUEST` | Schema/validation error (see `details[].field`/`issue`) |
| 401 | `AUTHENTICATION_FAILURE` | Missing/expired token, or sandbox credentials against live |
| 403 | `NOT_AUTHORIZED` | App lacks the feature/permission |
| 404 | `RESOURCE_NOT_FOUND` | Wrong ID or wrong environment |
| 409 | `RESOURCE_CONFLICT` | Concurrent request on the same resource; retry later |
| 422 | `UNPROCESSABLE_ENTITY` | Business rule: `INSTRUMENT_DECLINED`, `ORDER_NOT_APPROVED`, `ORDER_ALREADY_CAPTURED`, `DUPLICATE_INVOICE_ID`, `PAYER_ACTION_REQUIRED`, `MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED` |
| 429 | `RATE_LIMIT_REACHED` | Throttled |
| 500/503 | `INTERNAL_SERVER_ERROR` / `SERVICE_UNAVAILABLE` | Retry idempotently |

Log `debug_id` (required on every error body) and include it in support tickets; never log tokens or full payer data. Branch on `details[].issue`, not on `message`. Simulate errors in sandbox with the `PayPal-Mock-Response` header (e.g. `{"mock_application_codes": "INSTRUMENT_DECLINED"}`).

Sources: https://developer.paypal.com/api/rest/responses, https://developer.paypal.com/api/orders/v2/error-messages/, OpenAPI `error` schema

## Rate Limits

PayPal publishes no numeric limit and may throttle traffic that looks abusive (`429 RATE_LIMIT_REACHED`). Cache OAuth tokens, use webhooks instead of polling, and back off on `429`. Source: https://developer.paypal.com/api/rest/reference/rate-limiting

## Deprecated APIs (don't use for new work)

| Deprecated | Current |
|------------|---------|
| Payments v1 (`/v1/payments/payment`, sales) | Orders v2 + Payments v2 |
| Billing Agreements / Billing Plans (v1 payments) | Subscriptions v1 |
| Invoicing v1 | Invoicing v2 |
| JS SDK v5 (`/sdk/js?client-id=...`), `checkout.js` v4 | JS SDK v6 (`/web-sdk/v6/core`) |
| `@paypal/checkout-server-sdk`, `paypal-rest-sdk` | `@paypal/paypal-server-sdk` |

Sources: https://developer.paypal.com/api/rest/deprecated-resources, https://developer.paypal.com/v5-v6, npm deprecation notices (checked 2026-09-26)

## Going Live

1. Business account; create a **live** app and copy its client ID/secret into the secret store.
2. Recreate webhook subscriptions, catalog products and plans in live (IDs differ); update `PAYPAL_WEBHOOK_ID`.
3. Switch API base, JS SDK script URL and SDK `Environment` together.
4. Configure Payment Receiving Preferences for the currencies you sell in.
5. Run one low-value live payment and refund it; confirm `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED` arrive and verify.

## Resources

- Docs index: https://developer.paypal.com/llms.txt (append `.md` to a page path for markdown)
- OpenAPI specs: https://github.com/paypal/paypal-rest-api-specifications
- Server SDKs: https://github.com/paypal/PayPal-TypeScript-Server-SDK (and sibling repos)
- JS SDK v6 samples: https://github.com/paypal-examples/v6-web-sdk-sample-integration

## Next Steps

- **Orders, capture/authorize, JS SDK v6, Card Fields, vaulting, refunds:** load `orders-and-checkout.md`
- **Products, plans, subscriptions:** load `subscriptions.md`
- **Webhook verification, events, retries:** load `webhooks.md`
- **Server SDKs and migration from deprecated SDKs:** load `sdk.md`
