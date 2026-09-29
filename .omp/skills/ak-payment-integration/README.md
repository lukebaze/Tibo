# Payment Integration Skill

Comprehensive payment integration skill for SePay (Vietnamese payment gateway), PayFS (Vietnamese bank-transaction webhooks), Polar (global SaaS monetization platform), Stripe (global payment infrastructure), PayPal (global wallet and card checkout), and the Merchants of Record Creem, Dodo Payments, Lemon Squeezy and Paddle.

## Features

### SePay Integration
- Vietnamese payment gateway with VietQR, NAPAS, bank transfers, and cards
- VietQR bank list via `banks.json` (count changes; do not hardcode)
- Webhook verification with HMAC-SHA256 (recommended), API Key or OAuth2
- VietQR image generation, payment gateway with IPN, API v2 (order VAs, refunds)
- Order-based virtual accounts
- SDK support for Node.js, PHP, and Laravel

### PayFS Integration
- Vietnamese bank-transaction notification service (not a gateway or MoR)
- Open Banking for MBBank, ACB, OCB; NAPAS for all banks (enterprise workspaces)
- Webhooks for money in/out and order events, `X-Client-API-Key` plus HMAC-SHA256 over sorted-key JSON
- Virtual accounts per customer/order for memo-free matching
- Flat monthly plans with per-transaction overage; no sandbox, no SDK, no refund API

### Polar Integration
- Global SaaS monetization platform
- Merchant of Record (handles global tax compliance)
- Subscription management with trials, upgrades, downgrades
- Usage-based billing with events and meters
- Automated benefit delivery (GitHub repos, Discord roles, license keys, files)
- Customer self-service portal
- Official SDKs (TypeScript, Python)
- Framework adapters (Next.js, Nuxt, TanStack Start, BetterAuth; community Laravel)

### Stripe Integration
- Global payment infrastructure
- Checkout Sessions, PaymentIntents, SetupIntents APIs
- Billing and subscriptions at scale
- Connect for marketplaces and platforms (Accounts v2)
- Payment Element for custom checkout experiences
- Multi-language SDKs (Node.js, Python, Ruby, PHP, Java, Go, .NET)
- Best practices for integration design, webhooks and API version upgrades

### Creem Integration
- Merchant of Record for SaaS and digital products (global tax, chargebacks)
- One-time, recurring and seat-based products, trials, pay-what-you-want (USD/EUR)
- Hosted checkout with signed success redirects
- Subscription upgrades, pause/resume, scheduled cancellation
- License keys with per-instance activation
- HMAC-SHA256 webhooks (`creem-signature`)
- TypeScript SDK, Next.js and Better Auth adapters, CLI, MCP server

### Dodo Payments Integration
- Merchant of Record for SaaS, AI and digital products (global tax, chargebacks)
- One-time, subscription, usage-based and credit-based pricing, on-demand charges
- Hosted checkout sessions, payment links, overlay and inline checkout
- Plan changes with proration modes, pause/resume, dunning recovery
- License keys with public activate/validate endpoints
- Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`)
- SDKs in 9 languages, framework adapters, CLI, MCP server

### Lemon Squeezy Integration
- Merchant of Record for digital products and SaaS (Stripe-owned; team now builds Stripe Managed Payments)
- Hosted checkout and Lemon.js overlay, API checkouts with custom price, prefill and custom data
- Subscriptions with proration, pause, cancel/resume; quantity and usage-based billing
- License keys with a public License API (activate/validate/deactivate)
- HMAC-SHA256 webhooks (`X-Signature`)
- Official JavaScript SDK and Laravel package

### Paddle Integration
- Merchant of Record for SaaS, AI and digital products (global tax, fraud, chargebacks)
- Products with multiple prices, trials, country price overrides, 30+ currencies
- Paddle.js overlay and inline checkout, transactions and payment links
- Multi-item subscriptions with proration, pause/resume, scheduled cancellation
- Refunds and credits via adjustments, hosted customer portal
- HMAC-SHA256 webhooks (`Paddle-Signature`, timestamp + `h1`)
- Node.js, Python, Go and PHP SDKs, Paddle.js wrapper, MCP servers

### PayPal Integration
- Orders v2 checkout with PayPal, Pay Later, Venmo, cards, Apple Pay and Google Pay
- Capture now or authorize and capture later (Payments v2), full and partial refunds
- Subscriptions v1: products, plans with trials and tiers, lifecycle and failed-payment retries
- JS SDK v6 web components, payment sessions and Card Fields (3D Secure)
- RSA-signed webhooks verified offline (CRC32 + certificate) or by postback
- Official server SDKs (TypeScript, Python, Java, .NET, PHP, Ruby); not a Merchant of Record

## Structure

```
payment-integration/
├── SKILL.md                      # Main skill definition
├── README.md                     # This file
├── references/                   # Progressive disclosure documentation
│   ├── sepay/                   # SePay integration guides
│   │   ├── overview.md          # Auth, capabilities, environments
│   │   ├── api.md               # API endpoints and operations
│   │   ├── webhooks.md          # Webhook setup and handling
│   │   ├── sdk.md               # SDK usage (Node.js, PHP, Laravel)
│   │   ├── qr-codes.md          # VietQR generation
│   │   └── best-practices.md    # Security, patterns, monitoring
│   ├── payfs/                   # PayFS integration guides
│   │   ├── overview.md          # What it is, auth, API caveats, pricing, vs SePay
│   │   ├── webhooks.md          # Signature scheme, events, retries, idempotency
│   │   └── payment-matching.md  # Order matching, VietQR, VAs, refunds, testing
│   ├── polar/                   # Polar integration guides
│   │   ├── overview.md          # Auth, MoR concept, environments
│   │   ├── products.md          # Products, pricing, usage-based billing
│   │   ├── checkouts.md         # Checkout flows and embedded checkout
│   │   ├── subscriptions.md     # Lifecycle, upgrades, trials
│   │   ├── webhooks.md          # Event handling and verification
│   │   ├── benefits.md          # Automated benefit delivery
│   │   ├── sdk.md               # Multi-language SDK usage
│   │   └── best-practices.md    # Security, patterns, monitoring
│   ├── stripe/                  # Stripe integration guides
│   │   ├── stripe-best-practices.md  # Integration design, API selection
│   │   ├── stripe-sdks.md            # Server SDKs, errors, idempotency
│   │   ├── stripe-js.md              # Stripe.js, Payment Element, embedded checkout
│   │   ├── stripe-webhooks.md        # Signature verification, fulfillment
│   │   ├── stripe-cli.md             # Local testing, event triggers
│   │   └── stripe-upgrade.md         # API versions, SDK upgrades
│   ├── creem/                   # Creem integration guides
│   │   ├── overview.md          # Auth, MoR, fees, test mode, errors
│   │   ├── checkouts-and-products.md  # Products, checkout, redirects, discounts
│   │   ├── subscriptions-and-licenses.md  # Lifecycle, refunds, portal, licenses
│   │   ├── webhooks.md          # Signature verification, events, retries
│   │   └── sdk-and-cli.md       # SDK, adapters, CLI, MCP
│   ├── dodo/                    # Dodo Payments integration guides
│   │   ├── overview.md          # MoR, fees, auth, environments, errors
│   │   ├── checkouts-and-products.md  # Products, checkout sessions, links, discounts
│   │   ├── subscriptions-and-billing.md  # Lifecycle, usage/credits, licenses, refunds
│   │   ├── webhooks.md          # Standard Webhooks, events, retries
│   │   └── sdk.md               # SDKs, adapters, CLI, MCP
│   ├── lemonsqueezy/            # Lemon Squeezy integration guides
│   │   ├── overview.md          # Status, MoR, fees, auth, test mode, limits
│   │   ├── checkouts-and-products.md  # Catalog, checkouts, Lemon.js, discounts
│   │   ├── subscriptions-and-licenses.md  # Lifecycle, usage, refunds, portal, licenses
│   │   ├── webhooks.md          # Signature verification, events, dedupe
│   │   └── sdk.md               # JS SDK, Laravel, Lemon.js
│   ├── paddle/                  # Paddle Billing integration guides
│   │   ├── overview.md          # Billing vs Classic, fees, keys, sandbox, limits
│   │   ├── products-and-checkout.md  # Catalog, Paddle.js checkout, transactions
│   │   ├── subscriptions.md     # Lifecycle, proration, refunds, portal
│   │   ├── webhooks.md          # Signature verification, events, retries
│   │   └── sdk.md               # SDKs, Paddle.js wrapper, MCP
│   ├── paypal/                  # PayPal integration guides
│   │   ├── overview.md          # OAuth, environments, fees, idempotency, errors
│   │   ├── orders-and-checkout.md  # Orders v2, refunds, JS SDK v6, Card Fields
│   │   ├── subscriptions.md     # Products, plans, subscription lifecycle
│   │   ├── webhooks.md          # Self-verification, postback, events, retries
│   │   └── sdk.md               # Server SDKs, retries, migration
│   └── multi-provider-order-management-patterns.md  # Unified orders, refunds, webhook tracking
└── scripts/                      # Integration helper scripts
    ├── sepay-webhook-verify.js   # SePay webhook verification
    ├── payfs-webhook-verify.js   # PayFS webhook verification
    ├── polar-webhook-verify.js   # Polar webhook verification
    ├── creem-webhook-verify.js   # Creem webhook verification
    ├── dodo-webhook-verify.js    # Dodo Payments webhook verification
    ├── lemonsqueezy-webhook-verify.js  # Lemon Squeezy webhook verification
    ├── paddle-webhook-verify.js  # Paddle webhook verification
    ├── paypal-webhook-verify.js  # PayPal webhook verification
    ├── checkout-helper.js        # Checkout session generation
    ├── test-scripts.js           # Test suite for all scripts
    ├── package.json              # Node.js package configuration
    └── .env.example              # Environment variable template
```

## Usage

### Activate the Skill

Claude Code will automatically activate this skill when you mention payment integration, subscriptions, webhooks, or platform-specific terms (SePay, PayFS, Polar, Stripe, Creem, Dodo Payments, Lemon Squeezy, Paddle, PayPal).

### Manual Activation

In conversations, simply reference the platforms:
- "Implement SePay payment integration"
- "Set up Polar subscriptions with usage-based billing"
- "Create webhook handler for payment notifications"

### Using Scripts

**SePay Webhook Verification:**
```bash
cd ${CLAUDE_PLUGIN_ROOT}/skills/ak-payment-integration/scripts
node sepay-webhook-verify.js '{"id":12345,"gateway":"Vietcombank",...}'
```

**PayFS Webhook Verification:**
```bash
PAYFS_WEBHOOK_SECRET=your_payfs_webhook_secret node payfs-webhook-verify.js '{"transaction_id":"1418108930751619072","amount":14000,"transfer_type":"credit",...}'
```

**Polar Webhook Verification:**
```bash
node polar-webhook-verify.js '{"type":"order.paid","data":{...}}' whsec_xxx
```

**Creem Webhook Verification:**
```bash
node creem-webhook-verify.js '{"id":"evt_xxx","eventType":"checkout.completed","object":{...}}' whsec_xxx
```

**Dodo Payments Webhook Verification:**
```bash
node dodo-webhook-verify.js '{"business_id":"bus_xxx","type":"payment.succeeded","timestamp":"2026-09-26T10:30:00Z","data":{"payload_type":"Payment"}}' whsec_xxx
```

**Lemon Squeezy Webhook Verification:**
```bash
node lemonsqueezy-webhook-verify.js '{"meta":{"event_name":"order_created"},"data":{"type":"orders","id":"1","attributes":{...}}}' your_signing_secret
```

**Paddle Webhook Verification:**
```bash
node paddle-webhook-verify.js '{"event_id":"evt_xxx","event_type":"transaction.completed","occurred_at":"2026-01-01T00:00:00Z","notification_id":"ntf_xxx","data":{...}}' pdl_ntfset_xxx
```

**PayPal Webhook Verification (self-signs with a throwaway key; offline demo):**
```bash
node paypal-webhook-verify.js '{"id":"WH-xxx","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{...}}' WEBHOOK_ID
```

**Checkout Helper:**
```bash
# SePay
node checkout-helper.js sepay '{"orderInvoiceNumber":"ORD001","orderAmount":100000,...}'

# Polar
node checkout-helper.js polar '{"productId":"prod_xxx","successUrl":"https://..."}'

# Creem (prints request body and a curl that reads $CREEM_API_KEY)
node checkout-helper.js creem '{"productId":"prod_xxx","requestId":"order_123","successUrl":"https://..."}'
```

**Run Tests:**
```bash
npm test
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
# SePay
SEPAY_MERCHANT_ID=SP-TEST-XXXXXXX
SEPAY_SECRET_KEY=spsk_test_xxxxxxxxxxxxx
SEPAY_ENV=sandbox
SEPAY_WEBHOOK_AUTH_TYPE=hmac
SEPAY_WEBHOOK_SECRET=your_hmac_secret

# PayFS
PAYFS_WEBHOOK_SECRET=your_payfs_webhook_secret
PAYFS_WEBHOOK_API_KEY=your_payfs_webhook_api_key

# Polar
POLAR_ACCESS_TOKEN=polar_oat_xxxxxxxxxxxxxxxx
POLAR_SERVER=sandbox
POLAR_WEBHOOK_SECRET=whsec_xxx  # exactly as shown in webhook settings

# Creem
CREEM_API_KEY=creem_test_xxx
CREEM_SERVER=test
CREEM_WEBHOOK_SECRET=whsec_xxx

# Dodo Payments
DODO_PAYMENTS_API_KEY=your_test_mode_api_key
DODO_PAYMENTS_ENVIRONMENT=test_mode
DODO_PAYMENTS_WEBHOOK_KEY=whsec_xxx

# Lemon Squeezy
LEMONSQUEEZY_API_KEY=your_api_key
LEMONSQUEEZY_STORE_ID=12345
LEMONSQUEEZY_WEBHOOK_SECRET=your_signing_secret

# Paddle
PADDLE_API_KEY=pdl_sdbx_apikey_xxx
PADDLE_ENV=sandbox
PADDLE_CLIENT_TOKEN=test_xxx
PADDLE_WEBHOOK_SECRET=pdl_ntfset_xxx

# PayPal
PAYPAL_CLIENT_ID=your_client_id
PAYPAL_CLIENT_SECRET=your_client_secret
PAYPAL_ENV=sandbox
PAYPAL_WEBHOOK_ID=your_webhook_id
```

## Progressive Disclosure

The skill uses progressive disclosure to minimize context usage:
1. **SKILL.md** - Overview and quick reference
2. **references/** - Detailed guides loaded on demand
3. **scripts/** - Executable helpers with embedded examples

Load only the references you need for your current task.

## Platform Selection Guide

**Choose SePay for:**
- Vietnamese market targeting
- Bank transfer automation
- Local payment methods
- QR code payments (VietQR/NAPAS)
- Direct bank monitoring

**Choose PayFS for:**
- Vietnamese bank-transfer confirmation on MBBank, ACB or OCB accounts
- Enterprises that need every Vietnamese bank via NAPAS
- Flat monthly pricing instead of per-payment fees
- Teams that generate their own VietQR and own the checkout

**Choose Polar for:**
- Global market
- SaaS/subscription business
- Usage-based billing
- Automated benefit delivery
- Tax compliance (Merchant of Record)
- Customer self-service

**Choose Stripe for:**
- Global payment infrastructure
- Enterprise-grade payment processing
- Connect platforms (marketplaces)
- Billing/subscriptions at scale
- Custom checkout experiences (Payment Element)
- Maximum payment method coverage

**Choose Creem for:**
- SaaS or downloadable software sold globally in USD/EUR
- Merchant of Record without building tax compliance
- Built-in license keys for desktop/CLI apps
- Seat-based subscriptions and simple hosted checkout

**Choose Dodo Payments for:**
- Merchant of Record for SaaS, AI and digital products sold globally
- Usage-based or credit-based billing (meters, credits, on-demand charges)
- License keys plus subscriptions in one platform
- Standard Webhooks and SDKs across many languages

**Choose Lemon Squeezy for:**
- Existing Lemon Squeezy stores and integrations
- MoR checkout overlay with minimal code (Lemon.js)
- License keys validated from desktop/CLI apps without an API key
- Note: Stripe-owned and in maintenance mode; for new builds compare Stripe Managed Payments, Polar, Creem, Dodo Payments and Paddle

**Choose Paddle for:**
- SaaS, AI or digital products sold worldwide with localized prices in 30+ currencies
- Merchant of Record handling tax, fraud and chargebacks
- Multi-item subscriptions with fine-grained proration control
- Overlay or inline checkout embedded in your own pages

**Choose PayPal for:**
- Buyers who expect a PayPal, Venmo or Pay Later button
- Global card and wallet checkout where you handle tax yourself (not MoR)
- Authorize-then-capture flows and simple recurring billing
- Not for VND: PayPal does not support VND, so Vietnamese merchants charge in USD

## Examples

### SePay Payment Flow
1. Load `references/sepay/overview.md` for authentication
2. Load `references/sepay/sdk.md` for integration
3. Use `checkout-helper.js` to generate payment form
4. Load `references/sepay/webhooks.md` for webhooks and IPN
5. Use `sepay-webhook-verify.js` to verify authenticity (HMAC recommended)

### PayFS Bank-Transfer Flow
1. Load `references/payfs/overview.md` to pick Open Banking or NAPAS and set up a Workspace
2. Load `references/payfs/payment-matching.md` to create orders, payment codes and VietQR
3. Load `references/payfs/webhooks.md` and use `payfs-webhook-verify.js` to verify deliveries
4. Match `transaction.credit` to the order, dedupe on `transaction_id`, fulfil once

### Polar Subscription Flow
1. Load `references/polar/overview.md` for setup
2. Load `references/polar/products.md` for pricing
3. Load `references/polar/checkouts.md` for payment
4. Load `references/polar/subscriptions.md` for lifecycle
5. Load `references/polar/webhooks.md` for events
6. Load `references/polar/benefits.md` for automation

### Stripe Integration Flow
1. Load `references/stripe/stripe-best-practices.md` for integration design
2. Choose Checkout `ui_mode`: `hosted_page`, `embedded_page` or `elements` (Payment Element)
3. Use the Checkout Sessions API for most use cases
4. Load `references/stripe/stripe-webhooks.md` to verify events and fulfill orders
5. Load `references/stripe/stripe-upgrade.md` when upgrading API versions

### Creem Subscription Flow
1. Load `references/creem/overview.md` for keys and test mode
2. Load `references/creem/checkouts-and-products.md` for products and checkout
3. Load `references/creem/webhooks.md` and use `creem-webhook-verify.js` to verify events
4. Load `references/creem/subscriptions-and-licenses.md` for lifecycle, refunds and licenses

### Dodo Payments Subscription Flow
1. Load `references/dodo/overview.md` for keys, test mode and fees
2. Load `references/dodo/checkouts-and-products.md` for products and checkout sessions
3. Load `references/dodo/webhooks.md` and use `dodo-webhook-verify.js` to verify events
4. Load `references/dodo/subscriptions-and-billing.md` for lifecycle, usage billing, refunds and licenses

### Lemon Squeezy Subscription Flow
1. Load `references/lemonsqueezy/overview.md` for status, keys and test mode
2. Load `references/lemonsqueezy/checkouts-and-products.md` to create checkouts with custom data
3. Load `references/lemonsqueezy/webhooks.md` and use `lemonsqueezy-webhook-verify.js` to verify events
4. Load `references/lemonsqueezy/subscriptions-and-licenses.md` for plan changes, refunds, portal and licenses

### Paddle Subscription Flow
1. Load `references/paddle/overview.md` for keys, sandbox and versioning
2. Load `references/paddle/products-and-checkout.md` for prices and Paddle.js checkout
3. Load `references/paddle/webhooks.md` and use `paddle-webhook-verify.js` to verify events
4. Load `references/paddle/subscriptions.md` for proration, cancellation, refunds and portal

### PayPal Checkout Flow
1. Load `references/paypal/overview.md` for credentials, environments and idempotency
2. Load `references/paypal/orders-and-checkout.md` to create and capture orders server-side and render JS SDK v6 buttons
3. Load `references/paypal/webhooks.md` and use `paypal-webhook-verify.js` to verify events
4. Load `references/paypal/subscriptions.md` for plans and recurring billing

## Testing

All scripts include comprehensive test coverage:
- SePay webhook verification (HMAC, API key, none)
- PayFS webhook verification (documented test vector, API key, sorted-key HMAC, expiry)
- Polar webhook signature validation (Standard Webhooks and legacy Polar HMAC)
- Creem webhook signature validation (`creem-signature` HMAC-SHA256)
- Dodo Payments webhook signature validation (Standard Webhooks, spec test vector)
- Lemon Squeezy webhook signature validation (`X-Signature` HMAC-SHA256, dedupe key)
- Paddle webhook signature validation (`Paddle-Signature` ts/h1 HMAC-SHA256, timestamp tolerance, multiple `h1`)
- PayPal webhook verification (CRC32 + RSA-SHA256, cert URL host check)
- Checkout generation, including a SePay signature test vector
- Error handling and edge cases

Run `npm test` in the scripts directory to verify functionality.

## Support

### SePay
- Docs: https://developer.sepay.vn/en
- Email: info@sepay.vn
- Hotline: 02873059589

### PayFS
- Docs: https://docs.payfs.vn/vi (Vietnamese only)
- Email: support@payfs.vn

### Polar
- Docs: https://polar.sh/docs
- API Reference: https://polar.sh/docs/api-reference
- GitHub: https://github.com/polarsource/polar

### Stripe
- Docs: https://docs.stripe.com
- API Reference: https://docs.stripe.com/api
- Changelog: https://docs.stripe.com/changelog
- Go Live Checklist: https://docs.stripe.com/get-started/checklist/go-live

### Creem
- Docs: https://docs.creem.io
- API Reference: https://docs.creem.io/api-reference/introduction
- GitHub: https://github.com/armitage-labs/creem

### Dodo Payments
- Docs: https://docs.dodopayments.com
- API Reference: https://docs.dodopayments.com/api-reference/introduction
- GitHub: https://github.com/dodopayments

### Lemon Squeezy
- Docs: https://docs.lemonsqueezy.com
- API Reference: https://docs.lemonsqueezy.com/api
- JS SDK: https://github.com/lmsqueezy/lemonsqueezy.js

### Paddle
- Docs: https://developer.paddle.com
- API Reference: https://developer.paddle.com/api-reference
- OpenAPI: https://github.com/PaddleHQ/paddle-openapi

### PayPal
- Docs: https://developer.paypal.com
- API Reference: https://developer.paypal.com/api/rest
- OpenAPI specs: https://github.com/paypal/paypal-rest-api-specifications

## License

MIT

## Version

See `metadata.version` in `SKILL.md`.
