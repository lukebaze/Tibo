# Lemon Squeezy SDKs

Official JavaScript SDK, Laravel package, community SDKs and Lemon.js. Versions checked on npm and GitHub on 2026-09-26.

## Package Status

| Package | Latest | Last release | Status |
|---------|--------|--------------|--------|
| `@lemonsqueezy/lemonsqueezy.js` (npm, GitHub `lmsqueezy/lemonsqueezy.js`) | 4.0.0 | 2024-11-05 | Official; no release or commit since. Not archived |
| `lemonsqueezy/laravel` (Composer, GitHub `lmsqueezy/laravel`) | 1.9.0 | 2026-03-20 | Official; PHP 8.1+, Laravel 10+ |
| Lemon.js (`https://app.lemonsqueezy.com/js/lemon.js`) | CDN | n/a | Browser overlay library, no API key |

Community SDKs listed on https://docs.lemonsqueezy.com/api (Go, Ruby, Rust, Swift, Python, PHP, Elixir, Java) are unofficial; review them before use.

**Gaps in the JS SDK 4.0.0** (it predates these API additions): no affiliates endpoints, no `customer_updated`/`affiliate_activated` in webhook event types, no `locale` checkout option, no webhook signature helper. Call the REST API directly for those, and verify webhooks with `node:crypto` (see `webhooks.md`).

## JavaScript SDK

```bash
npm install @lemonsqueezy/lemonsqueezy.js   # Node >= 20; ESM + CJS builds
```

```typescript
import {
  lemonSqueezySetup,
  createCheckout,
  getSubscription,
  updateSubscription,
  cancelSubscription,
} from '@lemonsqueezy/lemonsqueezy.js';

lemonSqueezySetup({
  apiKey: process.env.LEMONSQUEEZY_API_KEY,          // server-side only
  onError: (error) => console.error('Lemon Squeezy error:', error.message),
});

const { data, error, statusCode } = await createCheckout(
  process.env.LEMONSQUEEZY_STORE_ID!,
  variantId,
  {
    checkoutData: { email: user.email, custom: { user_id: user.id, order_id: order.id } },
    productOptions: { redirectUrl: 'https://example.com/billing/success' },
    checkoutOptions: { embed: true },
  }
);
if (error) throw error;
const checkoutUrl = data.data.attributes.url;
```

- Functions return `{ statusCode, data, error }` and **do not throw** on API errors; always check `error`. `data` is the raw JSON:API document (`data.data.attributes`).
- Option keys are camelCase in the SDK and converted to snake_case on the wire.
- The API key is stored in module-global state by `lemonSqueezySetup`; call it once at startup. Never import this package in browser code (full account access).
- Test vs live mode is decided by the key; `createCheckout` also accepts `testMode`.

### Common Functions

| Area | Functions |
|------|-----------|
| Catalog (read-only) | `listStores`, `getStore`, `listProducts`, `getProduct`, `listVariants`, `getVariant`, `listPrices`, `getPrice`, `listFiles` |
| Checkout | `createCheckout`, `getCheckout`, `listCheckouts` |
| Customers | `createCustomer`, `updateCustomer`, `getCustomer`, `listCustomers`, `archiveCustomer` |
| Orders | `getOrder`, `listOrders`, `generateOrderInvoice`, `issueOrderRefund(orderId, amount)` |
| Subscriptions | `getSubscription`, `listSubscriptions`, `updateSubscription`, `cancelSubscription` |
| Billing | `listSubscriptionInvoices`, `generateSubscriptionInvoice`, `issueSubscriptionInvoiceRefund`, `updateSubscriptionItem`, `getSubscriptionItemCurrentUsage`, `createUsageRecord` |
| Discounts | `createDiscount`, `deleteDiscount`, `listDiscounts`, `listDiscountRedemptions` |
| Licenses | `activateLicense`, `validateLicense`, `deactivateLicense` (no API key needed), `updateLicenseKey`, `listLicenseKeys`, `listLicenseKeyInstances` |
| Webhooks | `createWebhook`, `updateWebhook`, `deleteWebhook`, `listWebhooks` |
| User | `getAuthenticatedUser` |

`issueOrderRefund` and `issueSubscriptionInvoiceRefund` require `amount` in the SDK, although the API treats it as optional (omitted = full refund). Pass the full amount for a full refund.

Source: SDK `src/index.ts`, `src/orders/index.ts`, `src/internal/fetch/index.ts` at https://github.com/lmsqueezy/lemonsqueezy.js

### Subscription Examples

```typescript
// Upgrade now and charge the prorated difference immediately
await updateSubscription(subscriptionId, { variantId: 11, invoiceImmediately: true });

// Cancel at period end (status → cancelled, access until ends_at)
await cancelSubscription(subscriptionId);

// Resume during the grace period
await updateSubscription(subscriptionId, { cancelled: false });

// Fresh signed portal URL (valid 24 h) on "Billing" click
const { data: sub } = await getSubscription(subscriptionId);
redirect(sub!.data.attributes.urls.customer_portal);
```

### License Keys From a Desktop/CLI App

```typescript
import { activateLicense, validateLicense } from '@lemonsqueezy/lemonsqueezy.js';

const { data, error } = await activateLicense(licenseKey, hostname);
if (error || !data?.activated) throw new Error(data?.error ?? 'Activation failed');
if (data.meta.store_id !== EXPECTED_STORE_ID || data.meta.product_id !== EXPECTED_PRODUCT_ID) {
  throw new Error('License key belongs to another product');
}
saveInstanceId(data.instance!.id);   // needed for validate/deactivate
```

The License API needs no API key, so it is safe to call from a distributed app; never embed the main API key there.

## Laravel

```bash
composer require lemonsqueezy/laravel
php artisan vendor:publish --tag="lemon-squeezy-migrations"   # see README for the full install steps
php artisan migrate
```

```ini
LEMON_SQUEEZY_API_KEY=your-api-key
LEMON_SQUEEZY_SIGNING_SECRET=your-webhook-signing-secret
LEMON_SQUEEZY_STORE=your-store-id
```

- Billable trait, `lemon_squeezy_customers` and `lemon_squeezy_subscriptions` tables, checkout helpers
- Ships a webhook route at `/lemon-squeezy/webhook`; exclude `lemon-squeezy/*` from CSRF. Signature middleware runs when `LEMON_SQUEEZY_SIGNING_SECRET` is set; always set it in production.
- `php artisan lmsqueezy:listen` creates a temporary webhook through a tunnel (not supported on Windows)

Source: https://github.com/lmsqueezy/laravel (README, `src/Http/Middleware/VerifyWebhookSignature.php`)

## Lemon.js

```html
<script src="https://app.lemonsqueezy.com/js/lemon.js" defer></script>
```

Adds `window.LemonSqueezy` for overlays and events (`Setup`, `Refresh`, `Url.Open`, `Url.Close`, `Affiliate.GetID`, `Affiliate.Build`). Details: `checkouts-and-products.md`. Source: https://docs.lemonsqueezy.com/help/lemonjs

## Planning for Stripe Managed Payments

Lemon Squeezy's team now builds Stripe Managed Payments (see `overview.md`). No official migration tool or guide was found on 2026-09-26. To keep a future move cheap:

- Keep Lemon Squeezy calls behind one billing module (create checkout, get subscription, cancel, portal URL, verify webhook).
- Store provider-neutral state (plan, status, period end) alongside Lemon Squeezy IDs.
- Managed Payments is Stripe Checkout/Payment Links with `managed_payments: { enabled: true }`; see `references/stripe/` and https://docs.stripe.com/payments/managed-payments.

## Resources

- JS SDK: https://github.com/lmsqueezy/lemonsqueezy.js (wiki for per-function usage)
- npm: https://www.npmjs.com/package/@lemonsqueezy/lemonsqueezy.js
- Laravel: https://github.com/lmsqueezy/laravel
- SDK list: https://docs.lemonsqueezy.com/api
