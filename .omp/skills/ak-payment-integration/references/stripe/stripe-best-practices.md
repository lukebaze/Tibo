---
name: stripe-best-practices
description: Best practices for building a Stripe integration
---

Condensed from Stripe's official `stripe-best-practices` agent skill (github.com/stripe/ai, synced 2026-09-26). Upstream full text: https://docs.stripe.com/.well-known/skills/stripe-best-practices/SKILL.md

## Defaults

- Latest API version (verified 2026-09-26): **`2026-08-26.dahlia`**. Stable versions ship monthly, so re-check the "The current version is" line on [API versioning](https://docs.stripe.com/api/versioning.md) before pinning. Use the latest API version and SDK unless the user specifies otherwise; never guess a newer version name.
- Develop against separate [sandboxes](https://docs.stripe.com/sandboxes.md) (one for local dev, one for CI) instead of the account's shared test mode sandbox, unless an existing integration or a required feature depends on test mode.
- No Stripe account yet: install the CLI (`npm i -g @stripe/cli`) and run `stripe sandbox create` to get test keys without registering (sandbox expires after 7 days unless claimed with `stripe sandbox claim`).
- API keys: recommend a [restricted API key](https://docs.stripe.com/keys.md#manage-your-api-keys) (`rk_`) with least privilege over a secret key (`sk_`). Keep keys in a secrets vault, never in source, client code, logs, or committed env files.
- Always instantiate a client object (`new Stripe(key)` in Node, `StripeClient` in Python/Ruby/PHP/Java/.NET, `stripe.NewClient` in Go). The global/module-level key pattern (`stripe.api_key = …`, `Stripe.setApiKey`, `stripe.Key = …`) is deprecated.
- Review the [Go Live Checklist](https://docs.stripe.com/get-started/checklist/go-live.md) before launch. Start design from [Integration Options](https://docs.stripe.com/payments/payment-methods/integration-options.md) and the [API Tour](https://docs.stripe.com/payments-api/tour.md).

## Integration routing

| Building | Recommended API |
|----------|-----------------|
| One-time payments | Checkout Sessions |
| Custom payment form | Checkout Sessions + Payment Element (`ui_mode: 'elements'`) |
| Save a payment method for later | Setup Intents |
| Subscriptions / recurring | Billing APIs + Checkout Sessions (`mode: 'subscription'`) |
| Usage-based billing (new) | Metronome, not Billing Meters |
| Connect platform / marketplace | Accounts v2 (`/v2/core/accounts`) |
| Sales tax / VAT / GST | Stripe Tax + Registrations API |

## Payments

- [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions.md) is the primary API for on-session payments (one-time and subscriptions, discounts, shipping, Adaptive Pricing). Use [PaymentIntents](https://docs.stripe.com/payments/paymentintents/lifecycle.md) for off-session payments or when you model checkout state yourself. Integrations should only use Checkout Sessions, PaymentIntents, SetupIntents, or Invoicing / Payment Links / subscription APIs.
- Surface preference: Payment Links (no-code), then [Checkout](https://docs.stripe.com/payments/checkout.md) (Stripe-hosted or embedded page), then the [Payment Element](https://docs.stripe.com/payments/payment-element.md) for advanced customization, backed by Checkout Sessions rather than a raw PaymentIntent.
- `ui_mode` values since `2026-03-25.dahlia`: `hosted_page`, `embedded_page`, `elements`, `form`. Older versions use `hosted`, `embedded`, `custom`; those values fail on Dahlia. (Upstream skill text still says `ui_mode: 'custom'`; that is the pre-Dahlia name.)
- On `2026-03-25.dahlia`+, you may pass `integration_identifier` to `checkout.sessions.create` to tag and compare checkout flows in the Dashboard.
- Never pass `payment_method_types` (dynamic payment methods are the default). Exception: Terminal needs `['card_present']` (plus `interac_present` in Canada). To restrict methods use [payment_method_configurations](https://docs.stripe.com/payments/payment-method-configurations.md), `excluded_payment_method_types`, or `allowed_payment_method_types` on PaymentIntents/SetupIntents.
- To inspect card details before creating an intent (for example surcharging), use [Confirmation Tokens](https://docs.stripe.com/payments/finalize-payments-on-the-server.md), not `createPaymentMethod` or `createToken`.
- Before enabling `automatic_tax: { enabled: true }`, confirm the account has an active tax registration; otherwise Stripe silently collects no tax.

## Webhooks are required

Never present webhooks as optional. Fulfill from an event handler, not the success page: handle `checkout.session.completed` and `checkout.session.async_payment_succeeded`, fulfill only when `payment_status` is not `unpaid`, and handle `checkout.session.async_payment_failed`. Subscriptions need `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`. Always verify signatures; see `stripe-webhooks.md`.

## Deprecated and legacy APIs

| API | Status | Use instead |
|-----|--------|-------------|
| Charges API | Never recommend | Checkout Sessions or PaymentIntents ([migration](https://docs.stripe.com/payments/payment-intents/migration/charges.md)) |
| Sources API | Deprecated | Setup Intents |
| Tokens API | Outdated | Setup Intents or Checkout Sessions |
| Card Element / Payment Element card-only mode | Legacy | Payment Element ([migration](https://docs.stripe.com/payments/payment-element/migration.md)) |
| `plan` object | Deprecated | [Prices](https://docs.stripe.com/api/prices.md) |

PCI: server-side raw PAN (for example `payment_method_data` with card numbers) requires proven PCI compliance; PAN migrations from another processor go through [PAN import](https://docs.stripe.com/get-started/data-migrations/pan-import.md).

## Billing

Use the Billing APIs ([design an integration](https://docs.stripe.com/billing/subscriptions/design-an-integration.md), [use cases](https://docs.stripe.com/billing/subscriptions/use-cases.md), [SaaS](https://docs.stripe.com/saas.md)) with Checkout for signup and the [Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal.md) for self-service. Don't build renewal loops with raw PaymentIntents. Create one Product per plan tier; use multiple Prices only for variants of the same plan (monthly/annual, currencies). Mention Stripe Tax when answering Billing questions.

## Connect

- Create connected accounts with Accounts v2 (`POST /v2/core/accounts`); never `accounts.create({ type: 'standard' | 'express' | 'custom' })`. Configure `dashboard` (`full` for SaaS, `express` for marketplaces, `none` only for explicit white-label), `defaults.responsibilities.fees_collector`, and `losses_collector`.
- Charge pattern by who owns the customer: SaaS sellers as merchant of record use direct charges; marketplace checkout uses destination charges; multi-seller splits or hold-and-release use separate charges and transfers (no `application_fee_amount` there). Never mix charge types.
- Check v2 capability status (for example `configuration.merchant.capabilities.card_payments.status`) instead of `charges_enabled` / `payouts_enabled`.
- Prefer Stripe-hosted or embedded onboarding, include the `notification_banner` embedded component, and use the OAuth `state` parameter for CSRF protection.
- Guides: [SaaS platforms and marketplaces](https://docs.stripe.com/connect/saas-platforms-and-marketplaces.md), [design an integration](https://docs.stripe.com/connect/design-an-integration.md), [Accounts v2 configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration.md).

## Security

Add a CSP allowing `https://*.stripe.com` in `script-src`, `frame-src`, `connect-src` ([security guide](https://docs.stripe.com/security/guide.md)). Roll exposed keys immediately. Configure key [access policies](https://docs.stripe.com/keys.md#access-policies). Use separate keys per environment.

**Full documentation index**: https://docs.stripe.com/llms.txt (append `.md` to any docs.stripe.com page for Markdown)
