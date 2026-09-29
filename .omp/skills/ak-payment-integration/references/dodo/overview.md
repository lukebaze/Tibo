# Dodo Payments Overview

Merchant of Record (MoR) for SaaS, AI and digital products: Dodo Payments is the legal seller, handles payment processing, sales tax/VAT/GST, invoicing, disputes and payouts.

Verified 2026-09-26 against https://docs.dodopayments.com (llms.txt index, raw `.md` pages), https://dodopayments.com/pricing, and the Stainless-generated `dodopayments` TypeScript SDK 2.52.0 source (`github.com/dodopayments/dodopayments-typescript`).

## Core Capabilities

- Products: one-time, recurring (Day/Week/Month/Year intervals) and usage-based prices; pay-what-you-want; add-ons and seats; trials; $0 subscriptions
- Hosted checkout sessions (redirect, overlay, inline, mobile SDKs), static payment links, product collections, stacked discount codes (up to 20)
- Subscriptions: plan changes with proration modes, scheduled changes, pause/resume, grace period (`past_due`), on-demand charges, dunning and payment retries
- Usage-based billing (meters + event ingestion) and credit-based billing (credit entitlements, rollover, overage)
- Entitlements: license keys, file delivery, Discord, GitHub, Telegram, Framer, Notion
- Customer portal, customer wallets, refunds (full or per-item partial), disputes, payouts API
- Webhooks signed with the Standard Webhooks scheme (`webhook-id` / `webhook-timestamp` / `webhook-signature`)
- Official SDKs in 9 server languages, framework adapters, CLI, MCP server

Sources: https://docs.dodopayments.com/llms.txt, https://docs.dodopayments.com/features/mor-introduction

**Merchant of Record:** Dodo calculates, collects and remits sales tax, issues invoices and handles chargebacks as the seller of record; it accepts payments from 220+ countries and regions. Source: https://docs.dodopayments.com/features/mor-introduction

**Payment methods (not exhaustive):** cards, Apple Pay, Google Pay, BNPL (Klarna, Afterpay/Clearpay), PayPal, UPI and RuPay (India), SEPA and ACH direct debit, Pix, WeChat Pay, Korean wallets, and more; availability depends on currency, country and product type. Source: https://docs.dodopayments.com/features/payment-methods

## Fees and Payouts (checked 2026-09-26)

| Item | Amount |
|------|--------|
| Domestic US cards and wallets | 4% + 40¢ |
| International (cards and APMs outside the US) | +1.5% |
| Subscriptions, add-ons, usage-based billing | +0.5% |
| BNPL / PayPal | +3% each |
| ACH / SEPA direct debit | flat 1.5%, capped at $15 / €15 (replaces the card fee) |
| India domestic (INR cards, UPI) | 4% + 15¢ (+ international fee) |
| Refund | $1 per refund |
| Dispute / chargeback | $30 per dispute |
| Recovery (abandoned cart, dunning, payment retries) | 5% of recovered revenue |
| BYOP (bring your own processor) | 0.5% |
| USD SWIFT payout | $25 |

Source: https://dodopayments.com/pricing

- Fees are calculated on the total amount including tax. Source: https://docs.dodopayments.com/features/mor-introduction
- Payout threshold: minimum $50 (combined USD/EUR/GBP wallets, converted to USD); default cycle is bi-monthly. Source: https://docs.dodopayments.com/miscellaneous/faq, https://docs.dodopayments.com/features/payouts/payout-structure
- Mismatch: the pricing page lists regular payouts as free, while the payout-structure doc says standard pricing charges a $5 payout fee below $1,000. Recheck both before quoting payout costs.

Fees are dated facts; recheck https://dodopayments.com/pricing before quoting them.

## Authentication

Every request sends the API key as a bearer token:

```bash
curl https://test.dodopayments.com/products \
  -H "Authorization: Bearer $DODO_PAYMENTS_API_KEY"
```

- Create keys in Dashboard → Developer → API Keys, in the mode you want to call. Keys are shown once.
- Keys are read/write by default; uncheck **Enable write access** for a read-only key (analytics, dashboards).
- The docs publish no official key prefix. MCP docs use `dodo_test_...` placeholders and one troubleshooting page claims `test_`/`live_`; do not infer the environment from the key string, configure it explicitly.
- Keep keys server-side only: never in client bundles, public repos, logs, chat or prompts. Load them from environment variables or a secret store.
- The SDK reads `DODO_PAYMENTS_API_KEY` (and `DODO_PAYMENTS_WEBHOOK_KEY` for webhook verification) by default.

Source: https://docs.dodopayments.com/api-reference/introduction

## Environments

| Mode | API base | TS SDK `environment` |
|------|----------|----------------------|
| Live | `https://live.dodopayments.com` | `'live_mode'` (SDK default) |
| Test | `https://test.dodopayments.com` | `'test_mode'` |

- No `/v1` path segment: routes are `/checkouts`, `/payments`, `/subscriptions`, etc.
- The SDK defaults to **live**. Always set `environment: 'test_mode'` in development; passing both `baseURL` and `environment` throws.
- Test and live keys, products, webhooks and data are separate; a test key does not authenticate against `live.dodopayments.com` and vice versa. Copy products from test to live in the dashboard.
- Live payments and payouts need account verification; a live request before that fails with `MERCHANT_NOT_LIVE` (403).
- Hosted checkout hosts: `checkout.dodopayments.com` (live) and `test.checkout.dodopayments.com` (test).

Sources: https://docs.dodopayments.com/miscellaneous/test-mode-vs-live-mode, SDK `src/client.ts`

**Test cards** (test mode only; expiry 06/32, CVV 123):

| Card | Result |
|------|--------|
| `4242 4242 4242 4242` (Visa US) | Success |
| `5555 5555 5555 4444` (Mastercard US) | Success |
| `4000 0000 0000 0002` | Generic decline |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 0341` (expiry 12/34) | Declined at the subscription's next charge (test renewal/plan-change failures) |

UPI test IDs: `success@upi`, `failure@upi`. Source: https://docs.dodopayments.com/miscellaneous/testing-process

## Money and Currency

- Amounts are integers in the smallest currency unit (`1999` = $19.99), except static payment-link `paymentAmount`, which uses major units (`12.5`).
- Products can be priced in any supported currency; pay-what-you-want base currency must be USD, GBP or EUR. A non-zero subscription price must be at least $1 (or equivalent); exactly $0 is allowed.
- Adaptive Currency shows local-currency prices at live FX (2-4% FX fee charged to the customer); Localized Pricing sets fixed per-currency/per-country prices; Purchasing Power Parity is also available.
- Tax categories (SDK `TaxCategory`): `digital_products`, `saas`, `e_book`, `edtech`, `live_tutoring`. Prices can be tax-inclusive.

Sources: https://docs.dodopayments.com/features/products, https://docs.dodopayments.com/features/adaptive-currency, https://docs.dodopayments.com/developer-resources/integration-guide

## Errors

```json
{ "code": "CHECKOUT_SESSION_CONSUMED", "message": "Payment with the given checkout session has already been generated." }
```

| Status | Meaning |
|--------|---------|
| 400 | Malformed request or invalid parameters |
| 401 | Missing or invalid API key |
| 403 | Key lacks permission, or business cannot perform the action (`MERCHANT_NOT_LIVE`, `BUSINESS_ARCHIVED`) |
| 404 / 409 / 410 | Not found / state conflict / deleted or archived |
| 422 | Semantically invalid (e.g. `status: paused` combined with other fields) |
| 429 | Rate limit or retry limit exceeded |
| 500 / 502 / 503 | Server or upstream error; retry later |

Branch on `code`, not `message` (`message` can be `null`). Card declines on a failed payment use separate codes (`error_code` on the payment, e.g. `INSUFFICIENT_FUNDS`). The TS SDK throws `APIError` subclasses (`BadRequestError`, `AuthenticationError`, `RateLimitError`, ...). Source: https://docs.dodopayments.com/api-reference/error-codes

## Rate Limits (checked 2026-09-26)

| Tier | Burst (per second) | Sustained (per minute) |
|------|--------------------|------------------------|
| Default | 40 | 240 |
| Tier 1 | 100 | 1,000 |
| Tier 2 | 500 | 5,000 |
| Unauthenticated (per IP) | 20 | 100 |

Limits apply per business across all its keys. Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; back off exponentially on `429`. Source: https://docs.dodopayments.com/api-reference/introduction

## Idempotency

- The REST API documents **no general `Idempotency-Key` header**, and the TS SDK sends none.
- The SDK retries 408, 409, 429 and 5xx up to 2 times by default, including POSTs. For money-moving calls (refunds, `subscriptions.charge`, plan changes), guard with your own order/refund state and consider `maxRetries: 0` plus a reconcile-by-fetch on timeout.
- Body-level keys exist where documented: usage events dedupe on `event_id`; customer wallet ledger entries take `idempotency_key`; webhook endpoint creation takes `idempotency_key`.
- Checkout sessions are single-use (`CHECKOUT_SESSION_CONSUMED`), which prevents double payment per session, not duplicate session creation.

Sources: SDK `src/client.ts` (`idempotencyHeader` unset, `shouldRetry`), https://docs.dodopayments.com/developer-resources/usage-based-billing-guide

## Pagination

- Most lists use page numbers (`page_number`, `page_size`); `/webhooks` uses cursors.
- SDK lists auto-paginate with `for await (const item of client.payments.list())`.
- The API cannot search by metadata; store Dodo IDs (`payment_id`, `subscription_id`, `customer_id`) in your database.

## Metadata

Up to 50 keys per object; keys up to 40 chars (letters, digits, `-`, `_`), string values up to 500 chars. Checkout-session metadata is not returned by `GET /checkouts/{id}`; read it from the resulting payment. Source: https://docs.dodopayments.com/api-reference/metadata

## Going Live

1. Complete account verification (business and identity documents) so live payments and payouts turn on.
2. Copy products to live mode; create a live API key and live webhook endpoint (new signing secret).
3. Switch SDK `environment` to `'live_mode'` and swap env vars.
4. Run one low-value live purchase and refund it.

Source: https://docs.dodopayments.com/miscellaneous/verification-process, https://docs.dodopayments.com/miscellaneous/test-mode-vs-live-mode

## Resources

- Docs: https://docs.dodopayments.com (append `.md` to a page path for raw markdown; index at `/llms.txt`, full dump at `/llms-full.txt`)
- API reference: https://docs.dodopayments.com/api-reference/introduction
- Changelog: https://docs.dodopayments.com/changelog/introduction
- GitHub org (SDKs, adapters, CLI): https://github.com/dodopayments

## Next Steps

- **Products, checkout sessions, payment links, overlay/inline:** load `checkouts-and-products.md`
- **Subscriptions, usage/credits, license keys, refunds, portal:** load `subscriptions-and-billing.md`
- **Webhooks:** load `webhooks.md`
- **SDKs, adapters, CLI, MCP, agent files:** load `sdk.md`
