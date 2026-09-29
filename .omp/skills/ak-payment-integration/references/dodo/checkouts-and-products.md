# Dodo Payments Checkouts and Products

Products, checkout sessions, redirects, payment links, overlay/inline checkout and discounts. Verified 2026-09-26 against https://docs.dodopayments.com/developer-resources/checkout-session, https://docs.dodopayments.com/developer-resources/integration-guide and `dodopayments` SDK 2.52.0 types (`src/resources/checkout-sessions.ts`, `src/resources/products/products.ts`).

## Products

Create in Dashboard → Products (most teams do) or via `POST /products`.

```typescript
import DodoPayments from 'dodopayments';

const client = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  environment: 'test_mode',            // SDK default is live_mode
});

const product = await client.products.create({
  name: 'Pro Monthly',
  tax_category: 'saas',
  price: {
    type: 'recurring_price',
    currency: 'USD',
    price: 1900,                         // smallest unit: $19.00
    payment_frequency_count: 1,
    payment_frequency_interval: 'Month', // Day | Week | Month | Year
    subscription_period_count: 1,
    subscription_period_interval: 'Year',
    trial_period_days: 14,
  },
  metadata: { plan: 'pro' },
});
// product.product_id -> "pdt_..."
```

| Price `type` | Use |
|--------------|-----|
| `one_time_price` | Single purchase; supports `pay_what_you_want`, `suggested_price`, `purchasing_power_parity`, `tax_inclusive` |
| `recurring_price` | Subscription; billing frequency plus subscription period (term) |
| `usage_based_price` | Metered billing tied to meters (see `subscriptions-and-billing.md`) |

- Other product fields: `description`, `addons` (add-on IDs for seats/extras), `entitlements`, `credit_entitlements`, `digital_product_delivery`, `brand_id`, `pricing_mode` (localized pricing).
- Product-level `license_key_*` fields are deprecated in the SDK; attach a License Key entitlement instead.
- Manage: `products.update`, `products.archive` / `unarchive`, `products.images`, `products.localizedPrices`, `products.shortLinks`.
- Product collections group products so the customer picks one at checkout (`product_collection_id` on the session, with an empty `product_cart`).

Sources: https://docs.dodopayments.com/features/products, https://docs.dodopayments.com/api-reference/products/post-products

## Checkout Sessions (recommended)

`POST /checkouts` (`client.checkoutSessions.create`) returns a hosted `checkout_url`. `POST /payments` and `POST /subscriptions` (dynamic payment links) are deprecated for new integrations.

```typescript
const session = await client.checkoutSessions.create({
  product_cart: [{ product_id: 'pdt_123', quantity: 1 }],
  customer: { email: 'customer@example.com', name: 'Jane Doe' }, // or { customer_id: 'cus_...' }
  return_url: 'https://example.com/billing/return',
  cancel_url: 'https://example.com/pricing',
  metadata: { user_id: 'user_42', order_id: 'order_123' },
});
// { session_id: "cks_...", checkout_url: "https://test.checkout.dodopayments.com/session/cks_..." }
```

| Field | Notes |
|-------|-------|
| `product_cart[]` (required) | `product_id`, `quantity`; optional `addons`, `amount` (PWYW, smallest unit), `credit_entitlements` overrides. One-time and subscription products can be mixed |
| `customer` | `{ customer_id }` to attach, or `{ email, name?, phone_number? }` to create |
| `billing_address`, `minimal_address` | Pre-fill address; minimal mode collects only country (and ZIP where tax needs it) |
| `billing_currency` | Force a currency |
| `allowed_payment_method_types` | Restrict methods (keep cards as a fallback) |
| `subscription_data` | `trial_period_days` (0-10000, overrides product), `on_demand` |
| `discount_codes` | Up to 20 stacked codes, applied in order; singular `discount_code` is deprecated and cannot be combined |
| `feature_flags` | e.g. `allow_discount_code`, `allow_currency_selection`, `redirect_immediately`, `require_phone_number`, `always_create_new_customer` |
| `customization`, `custom_fields` | Theme and extra form fields |
| `confirm` | Finalize at creation: all required fields needed, session lives 15 min; response adds `payment_id`, `client_secret`, `publishable_key` |
| `payment_method_id` | Charge a saved method; requires `confirm: true` and an existing `customer_id` |
| `show_saved_payment_methods`, `short_link`, `tax_id`, `metadata` | As named |

- Each `checkout_url` works **once** and expires after 24 hours (15 minutes with `confirm: true`). Create a new session per customer and attempt; reusing a paid session returns `CHECKOUT_SESSION_CONSUMED`.
- `POST /checkouts/preview` (`checkoutSessions.preview`) prices a cart (tax, discounts) without creating a session.
- `GET /checkouts/{id}` returns only `id`, `created_at`, `payment_id`, `payment_status`, `customer_email`, `customer_name` (no metadata).
- Session metadata is copied to the resulting payment; read it from the payment or webhook `data.metadata`.

Sources: https://docs.dodopayments.com/developer-resources/checkout-session, https://docs.dodopayments.com/api-reference/metadata

## Return URL

After payment the customer is redirected to `return_url` with query parameters:

| Parameter | When |
|-----------|------|
| `payment_id` | One-time payments |
| `subscription_id` | Subscriptions |
| `status` | Always (`succeeded`, `active`, `failed`, ...) |
| `license_key` | Product issues license keys (comma-separated if several) |
| `email` | Customer has an email |

These parameters are **unsigned**. Treat the return page as UX only: show "processing", then confirm via webhook or `client.payments.retrieve(payment_id)` / `client.subscriptions.retrieve(subscription_id)` on the server before granting access. The query string can carry license keys and emails, so keep it out of analytics, logs and third-party referrers.

## Static Payment Links (no code)

```text
https://checkout.dodopayments.com/buy/{product_id}?quantity=1&redirect_url=https://example.com/success&email=a%40example.com&disableEmail=true&metadata_orderId=123
```

- Test mode uses the test checkout host. Payment links use `redirect_url`; sessions use `return_url`.
- Pre-fill `fullName`/`firstName`/`lastName`, `email`, `country`, `addressLine`, `city`, `state`, `zipCode`; lock them with `disable<Field>=true`.
- `paymentCurrency`, `showCurrencySelector`, `showDiscounts`, `paymentAmount` (PWYW only, **major units**), `metadata_*`.
- Anyone can edit the URL, so never trust link parameters for price or entitlement decisions.

Source: https://docs.dodopayments.com/developer-resources/integration-guide#payment-links

## Overlay and Inline Checkout

Both consume a checkout-session URL created on your server, using the `dodopayments-checkout` browser package.

```typescript
import { DodoPayments } from 'dodopayments-checkout';

DodoPayments.Initialize({
  mode: 'test',                 // 'live' in production
  displayType: 'overlay',       // or 'inline'
  onEvent: (event) => {
    // e.g. event.event_type === 'checkout.breakdown' (inline: live tax/total updates)
  },
});

DodoPayments.Checkout.open({
  checkoutUrl: session.checkout_url,        // fetched from your backend
  // elementId: 'dodo-inline-checkout',     // required for inline
});
```

- Initialize once at app load, not per click.
- Client events are UX signals only; fulfil from webhooks.
- Native apps: open `checkout_url` with the mobile checkout SDKs (Android, iOS, React Native, Flutter); they hold no API key.

Sources: https://docs.dodopayments.com/developer-resources/overlay-checkout, https://docs.dodopayments.com/developer-resources/inline-checkout, https://docs.dodopayments.com/developer-resources/mobile-integration

## Customers

- `client.customers.create({ email, name, metadata })` → `cus_...`; `update`, `retrieve`, `list`.
- Pass `{ customer_id }` in checkout to reuse a customer and saved payment methods.
- Store `customer.customer_id` from the first webhook on your user record; needed for the portal, usage events and credit balances.

## Discounts

- `client.discounts.create({ type: 'percentage' | 'flat', amount, code?, ... })`: optional `starts_at`/`expires_at`, `customer_eligibility` (`any`, `first_time`, `existing`, `specific`), `currency_options`, `subscription_cycles`, `usage_limit`, `per_customer_usage_limit`, `restricted_to` (product IDs); look up with `discounts.retrieveByCode(code)`. For `percentage`, `amount` is in basis points (`540` = 5.4%, `10000` = 100%); confirm `flat` units in the create-discount reference. Codes are uppercased; omit `code` to get a random 16-character one.
- Apply with `discount_codes` on the session or let customers enter codes (`feature_flags.allow_discount_code`).
- Plan changes also accept `discount_codes`.

Source: https://docs.dodopayments.com/features/discount-codes

## Checklist

1. Create products in test mode; copy to live before launch.
2. Create a session per attempt on the server; never expose the API key to the browser.
3. Put your user/order ID in `metadata`; store `session_id` against the pending order.
4. Grant access only after a verified webhook (see `webhooks.md`).
5. Test success, decline (`4000 0000 0000 0002`) and abandoned sessions.

## Resources

- Checkout sessions: https://docs.dodopayments.com/developer-resources/checkout-session
- Create session API: https://docs.dodopayments.com/api-reference/checkout-sessions/create
- Products: https://docs.dodopayments.com/features/products
- Pay what you want: https://docs.dodopayments.com/developer-resources/dynamic-pricing-checkout
