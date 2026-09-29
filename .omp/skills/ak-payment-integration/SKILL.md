---
name: ak-payment-integration
description: Integrate payments with SePay and PayFS (Vietnamese bank transfers, VietQR), Polar, Stripe, Creem, Dodo Payments, Lemon Squeezy, Paddle, and PayPal. Checkout, webhooks, subscriptions, usage billing, license keys, QR codes, and multi-provider orders.
user-invocable: true
when_to_use: "Invoke for checkout, subscriptions, webhooks, or QR payments."
category: engineering
keywords: [payments, stripe, polar, creem, dodo-payments, lemonsqueezy, paddle, paypal, sepay, payfs, webhooks, qr]
license: MIT
argument-hint: "[provider] [task]"
metadata:
  author: agentkit
  version: "2.3.0"
---

# Payment Integration

Production-proven payment processing with SePay and PayFS (Vietnamese banks), Polar, Creem, Dodo Payments, Lemon Squeezy and Paddle (Merchants of Record), Stripe (global infrastructure), and PayPal (wallet and card checkout).

## When to Use

- Payment gateway integration (checkout, processing)
- Subscription management (trials, upgrades, billing)
- Webhook handling (notifications, idempotency)
- QR code payments (VietQR, NAPAS)
- Multi-provider order management

## Payment state invariants

Keep the existing provider/API version unless the request changes it. Load only its recipe.
Verify webhook signatures on the required raw payload, deduplicate with idempotency keys,
and keep order amount/currency/status server-owned. Client redirects do not prove payment.
Handle duplicate, invalid-signature and out-of-order events without incorrect fulfillment.
Use sandbox fixtures/accounts for tests, then report the actual verified transitions.
Provider versions, limits and fees are dated facts; recheck the linked official docs before pinning them.

## Platform Selection

| Platform | Best For |
|----------|----------|
| **SePay** | Vietnamese market, VND, bank transfers, VietQR |
| **PayFS** | Vietnamese bank-transfer confirmation webhooks (MB/ACB/OCB; all banks via NAPAS for enterprises), flat monthly plans, no gateway |
| **Polar** | Global SaaS, subscriptions, automated benefits (GitHub/Discord) |
| **Stripe** | Enterprise payments, Connect platforms, custom checkout |
| **Creem** | MoR for SaaS/software, license keys, USD/EUR only, simple API |
| **Dodo Payments** | MoR for SaaS/AI/digital products, usage/credit billing, license keys, Standard Webhooks |
| **Lemon Squeezy** | Existing LS stores; MoR for digital products/SaaS. Stripe-owned, maintenance mode: evaluate Stripe Managed Payments for new builds |
| **Paddle** | MoR for SaaS/AI/digital products, 30+ currencies, Paddle.js checkout, multi-item subscriptions |
| **PayPal** | Global wallet + cards checkout, subscriptions, not MoR (you own tax), no VND |

## Quick Reference

### SePay
- `references/sepay/overview.md` - Auth, environments, rate limits, IPs
- `references/sepay/api.md` - API v2/v1, order VAs, gateway API, refunds
- `references/sepay/webhooks.md` - Webhooks (HMAC), IPN, retries
- `references/sepay/sdk.md` - Node.js, PHP, Laravel
- `references/sepay/qr-codes.md` - VietQR generation
- `references/sepay/best-practices.md` - Production patterns

### PayFS
- `references/payfs/overview.md` - What it is, auth, API caveats, pricing, PayFS vs SePay
- `references/payfs/webhooks.md` - `X-Client-API-Key` + sorted-key HMAC, events, retries
- `references/payfs/payment-matching.md` - Order matching, VietQR, virtual accounts, refunds, testing

### Polar
- `references/polar/overview.md` - Auth, MoR, fees, API versioning
- `references/polar/products.md` - Pricing models
- `references/polar/checkouts.md` - Checkout flows
- `references/polar/subscriptions.md` - Lifecycle management
- `references/polar/webhooks.md` - Signing schemes, events, delivery
- `references/polar/benefits.md` - Automated delivery
- `references/polar/sdk.md` - TypeScript/Python SDKs, framework adapters
- `references/polar/best-practices.md` - Production patterns

### Stripe
- `references/stripe/stripe-best-practices.md` - Integration design
- `references/stripe/stripe-sdks.md` - Server SDKs
- `references/stripe/stripe-js.md` - Payment Element
- `references/stripe/stripe-webhooks.md` - Signature verification, fulfillment
- `references/stripe/stripe-cli.md` - Local testing
- `references/stripe/stripe-upgrade.md` - Version upgrades
- External: https://docs.stripe.com/llms.txt

### Creem
- `references/creem/overview.md` - Auth, MoR, fees, test mode, errors, idempotency
- `references/creem/checkouts-and-products.md` - Products, checkout, redirect signature, discounts
- `references/creem/subscriptions-and-licenses.md` - Lifecycle, plan changes, refunds, portal, license keys
- `references/creem/webhooks.md` - `creem-signature` HMAC, events, retries
- `references/creem/sdk-and-cli.md` - TypeScript SDK, Next.js/Better Auth, CLI, MCP, agent files

### Dodo Payments
- `references/dodo/overview.md` - MoR, fees, auth, test/live environments, test cards, errors, rate limits, idempotency
- `references/dodo/checkouts-and-products.md` - Products, checkout sessions, unsigned return URL, payment links, overlay, discounts
- `references/dodo/subscriptions-and-billing.md` - Lifecycle, plan changes, pause/cancel, on-demand, usage/credits, license keys, refunds, portal
- `references/dodo/webhooks.md` - Standard Webhooks verification, events, retries, `webhook-id` idempotency
- `references/dodo/sdk.md` - SDKs, framework adapters and their caveats, CLI, MCP, agent files

### Lemon Squeezy
- `references/lemonsqueezy/overview.md` - Status (Stripe, Managed Payments), MoR, fees, auth, JSON:API, test mode, limits
- `references/lemonsqueezy/checkouts-and-products.md` - Stores, variants, prices, checkouts, custom data, Lemon.js, discounts
- `references/lemonsqueezy/subscriptions-and-licenses.md` - Lifecycle, plan changes, usage records, refunds, portal, License API
- `references/lemonsqueezy/webhooks.md` - `X-Signature` HMAC, events, retries, dedupe key (no event id)
- `references/lemonsqueezy/sdk.md` - JS SDK (stale since 2024-11), Laravel, Lemon.js

### Paddle
- `references/paddle/overview.md` - Billing vs Classic, fees, keys, sandbox, versioning, errors, rate limits
- `references/paddle/products-and-checkout.md` - Products, prices, Paddle.js checkout, transactions, discounts
- `references/paddle/subscriptions.md` - Lifecycle, proration, pause/cancel, refunds (adjustments), portal
- `references/paddle/webhooks.md` - `Paddle-Signature` HMAC, events, retries, IPs, simulator
- `references/paddle/sdk.md` - Node/Python/Go/PHP SDKs, Paddle.js wrapper, MCP servers

### PayPal
- `references/paypal/overview.md` - OAuth, environments, fees, currencies, idempotency, errors
- `references/paypal/orders-and-checkout.md` - Orders v2, capture/authorize, refunds, JS SDK v6, Card Fields, vault
- `references/paypal/subscriptions.md` - Products, plans, subscription lifecycle, failed payments
- `references/paypal/webhooks.md` - Self-verification (CRC32 + RSA cert) vs postback, events, retries
- `references/paypal/sdk.md` - `@paypal/paypal-server-sdk`, retries, migration from deprecated SDKs

### Multi-Provider
- `references/multi-provider-order-management-patterns.md` - Unified orders, currency conversion

### Scripts
- `scripts/sepay-webhook-verify.js` - SePay webhook verification
- `scripts/payfs-webhook-verify.js` - PayFS webhook verification
- `scripts/polar-webhook-verify.js` - Polar webhook verification
- `scripts/creem-webhook-verify.js` - Creem webhook verification
- `scripts/dodo-webhook-verify.js` - Dodo Payments webhook verification (Standard Webhooks)
- `scripts/lemonsqueezy-webhook-verify.js` - Lemon Squeezy webhook verification
- `scripts/paddle-webhook-verify.js` - Paddle Billing webhook verification
- `scripts/paypal-webhook-verify.js` - PayPal webhook verification (CRC32 + RSA cert)
- `scripts/checkout-helper.js` - Checkout session generator

## Key Capabilities

| Platform | Highlights |
|----------|------------|
| **SePay** | VietQR/NAPAS QR, cards, HMAC webhooks, IPN, API v2, 2-3 req/s |
| **PayFS** | Bank-transaction webhooks, API key + HMAC (sorted JSON, 5 min), 10 retries, VND only, no sandbox |
| **Polar** | MoR, subscriptions, usage billing, benefits, 500 req/min (sandbox 100) |
| **Stripe** | Checkout Sessions, Billing, Connect (Accounts v2), Payment Element |
| **Creem** | MoR, subscriptions, seats, license keys, HMAC webhooks (no timestamp), USD/EUR |
| **Dodo Payments** | MoR, subscriptions, usage/credit billing, on-demand charges, license keys, Standard Webhooks (5-min window) |
| **Lemon Squeezy** | MoR, variants, subscriptions, usage billing, license keys, HMAC webhooks (no event id), 300 req/min |
| **Paddle** | MoR, multi-item subscriptions with proration, adjustments (refunds/credits), `Paddle-Signature` ts+h1 HMAC (5 s tolerance), 240 req/min |
| **PayPal** | Orders v2 capture/authorize, Subscriptions v1, JS SDK v6, RSA-signed webhooks, not MoR, no VND |

## Implementation

**General flow:** auth → products → checkout → webhooks → events
