# Lemon Squeezy Overview

Merchant of Record (MoR) for digital products and SaaS: Lemon Squeezy is the legal seller, collects and remits sales tax/VAT, handles refunds, chargebacks and PCI scope, then pays out net sales.

Verified against https://docs.lemonsqueezy.com, the Lemon Squeezy blog and https://docs.stripe.com on 2026-09-26.

## Product Status (read before choosing Lemon Squeezy)

| Date | Event | Source |
|------|-------|--------|
| 2024-07-26 | Stripe acquired Lemon Squeezy | https://www.lemonsqueezy.com/blog/stripe-acquires-lemon-squeezy |
| 2025-04-29 | Stripe Managed Payments (Stripe's own MoR, built by the Lemon Squeezy team) announced; existing merchants told "no changes or action needed" | https://www.lemonsqueezy.com/blog/stripe-lemon-squeezy-update-2025 |
| 2026-01-28 | CEO update: team is heads-down on Managed Payments, admits "slower support responses and less frequent product updates", goal is an easy Lemon Squeezy to Managed Payments migration | https://www.lemonsqueezy.com/blog/2026-update |
| 2026-07-29 | Latest API changelog entry (`referral_amount` on orders/invoices): the API is still maintained | https://docs.lemonsqueezy.com/api/getting-started/changelog |

What this means (as of 2026-09-26):

- **No shutdown, deprecation or end-of-sale date has been announced.** The docs site shows no deprecation banner; the marketing site banner links to the 2026 update.
- **Strategic direction is Stripe Managed Payments.** Lemon Squeezy receives maintenance-level updates; the official JS SDK has not been released since 2024-11-05 (see `sdk.md`).
- **No official migration guide was found** on docs.lemonsqueezy.com or docs.stripe.com. Do not promise a migration path, tooling or timeline.
- **Greenfield projects:** also evaluate Stripe Managed Payments (Stripe Checkout/Payment Links with `managed_payments`, standard Stripe fees + 3.5% per successful transaction per https://stripe.com/managed-payments, checked 2026-09-26; no Connect, no Elements, subscriptions only through Checkout/Payment Links; see https://docs.stripe.com/payments/managed-payments.md) or another MoR in this skill (Polar, Creem).
- **Existing integrations:** keep working; isolate Lemon Squeezy behind your own billing interface so a later provider switch touches one module.

## Core Capabilities

- Products with variants; single payments and subscriptions; pay-what-you-want; free trials; setup fees
- Pricing models: standard, package, volume, graduated; quantity-based and usage-based billing
- Hosted checkout and checkout overlay (Lemon.js); API-created custom checkouts with custom price, prefill, custom data, expiry
- Subscription API: plan changes with proration, pause/unpause, cancel/resume, billing anchor, trial changes
- License keys with activation limits and a separate public License API
- Customer Portal (hosted billing management), discounts, affiliates, dunning, email marketing
- Webhooks signed with HMAC-SHA256 (`X-Signature`)

Sources: https://docs.lemonsqueezy.com/guides/developer-guide/getting-started, https://docs.lemonsqueezy.com/api

## Merchant of Record

- Lemon Squeezy is the merchant of record and "takes on all of the liability" for sales tax, refunds, chargebacks and PCI compliance. Source: https://docs.lemonsqueezy.com/help/payments/merchant-of-record
- Checkout payment methods include cards, PayPal and Apple Pay. Source: https://docs.lemonsqueezy.com/guides/developer-guide/taking-payments
- Subscription objects expose `payment_processor`: `stripe` or `paypal`.

## Fees and Payouts (checked 2026-09-26)

| Item | Amount | Source |
|------|--------|--------|
| Platform fee | 5% + 50¢ per transaction, on the total order value (tax included) | https://www.lemonsqueezy.com/pricing, https://docs.lemonsqueezy.com/help/getting-started/fees |
| International (non-US) transaction | +1.5% | fees page |
| PayPal transaction | +1.5% | fees page |
| Subscription payment | +0.5% | fees page |
| Abandoned-cart recovered payment | +5% | fees page |
| Affiliate referral (merchant) | +3% | fees page |
| Payout via Stripe | free to US banks; 1% per payout outside the US | fees page |
| Payout via PayPal | $0.50 per payout (US); 3% capped at $30 (non-US) | fees page |
| Chargeback | refund amount (minus platform fee) plus a $15 dispute fee, deducted from payout | https://docs.lemonsqueezy.com/help/payments/refunds-chargebacks |

Worked example from the docs: a $20 product with 20% VAT = $24.00 total; platform fee $0.50 + 5% of total + 1.5% international = $2.06; net $17.94.

- Payouts are created on the 1st and 15th; sales are held 13 days; minimum payout $50. Source: https://docs.lemonsqueezy.com/help/getting-started/getting-paid
- Refunds are deducted from the next payout "minus our platform fee" (the fee is not returned). Lemon Squeezy may refund within 60 days of purchase to prevent chargebacks, even under a "no refunds" policy.
- Custom pricing is available for high volume or products under $10 (contact sales).

Fees are dated facts; recheck the fees page before quoting them.

## Authentication

```bash
curl "https://api.lemonsqueezy.com/v1/users/me" \
  -H 'Accept: application/vnd.api+json' \
  -H 'Content-Type: application/vnd.api+json' \
  -H "Authorization: Bearer $LEMONSQUEEZY_API_KEY"
```

- Bearer API keys, created in Settings → API (https://app.lemonsqueezy.com/settings/api)
- Keys are created separately in test mode and live mode; each works only against its own mode's data
- **Generated API keys are valid for one year.** Track the expiry and rotate before it lapses.
- Keys are not scoped: a key has full access to the account's stores. Keep it server-side only (never in browser bundles, repos or logs); load it from an env var or secret store and never paste it into chat or prompts.
- A null-`Origin` client (e.g. a sandboxed Figma plugin iframe) can use `https://api-cors-anywhere.lemonsqueezy.com`; do not ship an API key to such a client.

Source: https://docs.lemonsqueezy.com/api/getting-started/requests

## Base URL, JSON:API and Versioning

- Base URL: `https://api.lemonsqueezy.com/v1` (HTTPS only). There is no separate test host; the key decides the mode.
- Main API follows JSON:API: send `Accept: application/vnd.api+json` and `Content-Type: application/vnd.api+json`; request bodies wrap fields in `data.type`, `data.attributes`, `data.relationships`.
- Responses carry `data` (resource objects with `type`, `id`, `attributes`, `relationships`, `links`) and optional `meta`, `links`, `included`.
- IDs are strings in JSON:API envelopes (`"id": "1"`) but integers inside attributes (`store_id: 1`); normalize before comparing.
- Major version in the path (`/v1`); additive changes (new fields, new webhook events) are considered backwards-compatible, so parsers must ignore unknown fields.
- The License API (`/v1/licenses/*`) is different: form-encoded requests, plain JSON responses, no API key. See `subscriptions-and-licenses.md`.

Source: https://docs.lemonsqueezy.com/api, https://docs.lemonsqueezy.com/api/getting-started/responses

## Test Mode

- New stores start in test mode; selling requires store activation (identity verification).
- Test mode has separate products, customers, orders, API keys and webhooks. "Copy to Live Mode" copies products/discounts but gives them new IDs, so checkout URLs change.
- Test mode emails go to the store owner and team members, not the checkout email. File downloads are disabled for test purchases.
- Objects include `test_mode: true|false`; `GET /v1/users/me` exposes `test_mode` in its `meta`.

**Test cards** (any future expiry, any CVC):

| Card | Result |
|------|--------|
| `4242 4242 4242 4242` | Visa success |
| `5555 5555 5555 4444` | Mastercard success |
| `3782 822463 10005` | Amex success |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 0069` | Expired card |
| `4000 0027 6000 3184` | 3D Secure |

Never use real card data in test mode; the docs warn it may suspend the store. Source: https://docs.lemonsqueezy.com/help/getting-started/test-mode

## Money and Currency

- Amounts are integers in the currency's smallest unit (`599` = $5.99; `¥599` for JPY).
- The store currency (Settings → General) is used for display, checkout and receipts; 130+ currencies are listed.
- **All transactions are processed in USD** at the mid-market rate; payouts are made in USD (bank payouts can convert to a chosen currency).
- Orders carry both store-currency and USD fields (`total`, `total_usd`, `currency`, `currency_rate`, `tax`, `tax_inclusive`, `refunded_amount`).

Source: https://docs.lemonsqueezy.com/help/payments/currencies, https://docs.lemonsqueezy.com/api/orders/the-order-object

## Errors

```json
{
  "jsonapi": { "version": "1.0" },
  "errors": [{ "detail": "Unauthenticated.", "status": "401", "title": "Unauthorized" }]
}
```

- `2xx` success, `4xx` client error (always a JSON:API `errors` array), `5xx` server error
- Endpoints document `404` (e.g. current usage on a non-usage product) and `422 Unprocessable Entity` (e.g. updating quantity on a usage-based item)
- License API errors use `{ "error": "..." }` with `400`, `404` or `422`

Source: https://docs.lemonsqueezy.com/api/getting-started/responses

## Rate Limits (checked 2026-09-26)

| API | Limit | Signal |
|-----|-------|--------|
| Main API | 300 calls/minute | `X-Ratelimit-Limit`, `X-Ratelimit-Remaining` headers; `429 Too Many Requests` |
| License API | 60 requests/minute | `429` implied; not documented further |

Back off on `429`; serialize bulk jobs. Sources: https://docs.lemonsqueezy.com/api, https://docs.lemonsqueezy.com/api/license-api

## Idempotency

The API documents **no idempotency key** header or field. Guard retries yourself:

- Create checkouts from your own order row and reuse a stored, unexpired checkout URL instead of creating a new one per click.
- Refunds, usage records and subscription updates are not idempotent; record the intent in your database before calling and reconcile with `GET` before retrying.
- Webhooks carry no event ID; see `webhooks.md` for a dedupe key.

## Pagination, Filtering, Includes

- Page-based: `page[number]`, `page[size]` (default 10, max 100); follow `links.next`; totals in `meta.page`
- Filters: `?filter[status]=active&filter[store_id]=1` (available filters differ per endpoint)
- Related resources: `?include=variants`, returned in top-level `included`; nested routes such as `GET /v1/products/100/variants`

Source: https://docs.lemonsqueezy.com/api/getting-started/requests

## Going Live

1. Activate the store (identity verification, payout method).
2. Create a live API key and live webhook (test ones do not work in live mode).
3. Copy products to live mode and update stored variant IDs and checkout URLs.
4. Run one low-value live purchase and refund it.

Source: https://docs.lemonsqueezy.com/guides/developer-guide/testing-going-live

## Resources

- Docs: https://docs.lemonsqueezy.com (no `llms.txt` or sitemap as of 2026-09-26)
- API reference: https://docs.lemonsqueezy.com/api
- API changelog: https://docs.lemonsqueezy.com/api/getting-started/changelog
- Stripe Managed Payments: https://docs.stripe.com/payments/managed-payments

## Next Steps

- **Products, variants, checkout, Lemon.js:** load `checkouts-and-products.md`
- **Subscriptions, usage, refunds, portal, license keys:** load `subscriptions-and-licenses.md`
- **Webhooks:** load `webhooks.md`
- **SDKs:** load `sdk.md`
