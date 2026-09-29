# Paddle Products, Prices and Checkout

Catalog (products and prices), Paddle.js overlay/inline checkout, transactions and payment links. Verified 2026-09-26 against https://developer.paddle.com and the OpenAPI spec (`PaddleHQ/paddle-openapi`, `v1/openapi.yaml`).

## Data Model

```
Product (pro_)  ──< Price (pri_)            catalog: what you sell and for how much
Customer (ctm_) ──< Address (add_), Business (biz_)
Transaction (txn_)  items[] = { price_id, quantity }   every purchase, invoice and renewal
Subscription (sub_) created automatically when a transaction with recurring prices completes
Adjustment (adj_)   refund / credit / chargeback against a billed or completed transaction
```

All revenue flows through transactions. Checkout opened with items creates a transaction; recurring items make Paddle create a subscription on payment. Source: https://developer.paddle.com/build/transactions/create-transaction

## Products

`POST /products` requires `name` and `tax_category`.

- `tax_category`: `digital-goods`, `ebooks`, `implementation-services`, `professional-services`, `saas`, `software-programming-services`, `standard`, `training-services`, `website-hosting`. Only `standard` and `saas` are enabled by default; request others in the dashboard.
- Optional: `description`, `image_url`, `custom_data`, `type` (`standard` catalog item or `custom` one-off).
- Products and prices are archived (`status: archived`), never deleted.

## Prices

`POST /prices` requires `product_id`, `description` (internal) and `unit_price`.

```json
{
  "product_id": "pro_01...",
  "description": "Pro monthly",
  "name": "Monthly",
  "unit_price": { "amount": "1500", "currency_code": "USD" },
  "billing_cycle": { "interval": "month", "frequency": 1 },
  "trial_period": { "interval": "day", "frequency": 7 },
  "tax_mode": "account_setting",
  "unit_price_overrides": [
    { "country_codes": ["IN"], "unit_price": { "amount": "90000", "currency_code": "INR" } }
  ],
  "quantity": { "minimum": 1, "maximum": 100 },
  "custom_data": { "plan": "pro" }
}
```

- `amount` is a string of minor units (`"1500"` = 15.00 USD).
- Omit `billing_cycle` for a one-time charge. `interval`: `day`, `week`, `month`, `year`.
- Trials live on the price and require a `billing_cycle`: free trial (no `trial_period.unit_price`), paid trial (set `trial_period.unit_price`; same `price_id` renews at the base price), cardless trial (`requires_payment_method: false`, public early access).
- `unit_price_overrides` set country-specific prices; otherwise Paddle converts currency automatically at checkout.
- `quantity` defaults to 1-100.
- All recurring items in one checkout or subscription must share the same billing interval.

Source: OpenAPI `POST /prices`; https://developer.paddle.com/build/products/create-products-prices

Non-catalog ("custom") items: transactions and subscription updates also accept an inline price (for an existing product) or inline price + product instead of a `price_id`, for one-off quotes. Source: OpenAPI `POST /transactions` `items` oneOf.

## Paddle.js (client)

Paddle.js v2 is the only way to render Paddle Checkout on your site. It authenticates with a **client-side token**, never an API key.

```html
<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
<script>
  Paddle.Environment.set('sandbox'); // remove for live
  Paddle.Initialize({
    token: 'test_xxxxxxxxxxxxxxxxxxxxxxxxxxx', // client-side token (placeholder)
    eventCallback(event) {
      if (event.name === 'checkout.completed') {
        // UI only: show a thank-you state. Fulfil from webhooks, not from here.
      }
    },
  });
</script>
```

npm alternative (typed wrapper that still loads the script from the CDN):

```typescript
import { initializePaddle, type Paddle } from '@paddle/paddle-js';

const paddle: Paddle | undefined = await initializePaddle({
  environment: 'sandbox',              // 'production' | 'sandbox'
  token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!,
});
```

- Always load from `https://cdn.paddle.com/`; do not self-host the script.
- Initialize on pricing/checkout pages, on the default payment link page, and (for Retain) on public and logged-in pages. Logged-in pages pass `pwCustomer: { id: 'ctm_...' }` for Retain.

Source: https://developer.paddle.com/paddle-js/about/include-paddlejs, https://github.com/PaddleHQ/paddle-js-wrapper

## Opening Checkout

```javascript
Paddle.Checkout.open({
  settings: {
    displayMode: 'overlay',          // or 'inline' with frameTarget/frameInitialHeight/frameStyle
    theme: 'light',
    locale: 'en',
    successUrl: 'https://example.com/billing/success',
    allowLogout: false,              // lock the prefilled email
  },
  items: [{ priceId: 'pri_01...', quantity: 1 }],   // or: transactionId: 'txn_01...'
  customer: { email: 'user@example.com' },          // or { id: 'ctm_...' } for known customers
  customData: { userId: 'user_123' },               // copied to the transaction and subscription
  discountCode: 'LAUNCH20',
});
```

Documented `Paddle.Checkout.open()` properties: `settings` (`displayMode`, `theme`, `locale`, `successUrl`, `allowLogout`, `allowDiscountRemoval`, `allowedPaymentMethods`, `showAddDiscounts`, `showAddTaxId`, `variant: 'express'`, frame options), `items` or `transactionId`, `customer` (`id`/`email`, `address`, `business`), `customerAuthToken`, `discountCode`/`discountId`, `customData`, `savedPaymentMethodId`, `upsell`. Source: https://developer.paddle.com/paddle-js/methods/paddle-checkout-open

**Overlay vs inline**

| Mode | Use when | Notes |
|------|----------|-------|
| Overlay | Fastest integration; buy buttons on marketing pages | Default for payment links |
| Inline | Checkout embedded in your page | Create `<div class="checkout-container">`, pass `frameTarget: 'checkout-container'`, `frameInitialHeight: '450'`, `frameStyle`. Your page must show totals, recurring terms and the full frame footer (Paddle is the seller) |

HTML alternative: `<a href="#" class="paddle_button" data-items='[{"priceId":"pri_01...","quantity":1}]' data-success-url="https://...">Buy</a>`.

**Linking the purchase to your user:** pass your user/order ID in `customData`; Paddle copies transaction `custom_data` onto the created subscription, and subscription `custom_data` onto renewal transactions. Keep it flat (no nesting) and do not put secrets or PII in it.

## Success Handling

- `settings.successUrl` redirects after payment; the `checkout.completed` Paddle.js event fires in the browser. Both are UX signals only: a redirect or client event does not prove payment.
- Grant access from webhooks: `transaction.completed` (or `transaction.paid`) for one-time purchases, `subscription.created` / `subscription.updated` for subscriptions. See `webhooks.md`.
- Optional server check: `GET /transactions/{id}` and confirm `status` is `paid` or `completed`, and the amount and currency match your order.

Source: https://developer.paddle.com/build/checkout/handle-success-post-checkout

## Transactions

Status lifecycle (OpenAPI `TransactionStatus`): `draft` → `ready` → (`billed`) → `paid` → `completed`; also `canceled`, `past_due`.

| Status | Meaning |
|--------|---------|
| `draft` | Missing customer/address (checkout just opened with items) |
| `ready` | Has everything needed to bill |
| `billed` | Locked financial record (invoice issued, or items locked for checkout); set via API |
| `paid` | Payment captured; brief interim state while Paddle computes fees and links the subscription |
| `completed` | Processing finished; safe final state |
| `past_due` | Renewal or invoice payment failed |
| `canceled` | Canceled draft/ready/billed transaction; set via API |

**Server-created transactions** (sales-assisted, prefilled carts, fixed prices):

```typescript
const txn = await paddle.transactions.create({
  items: [{ priceId: 'pri_01...', quantity: 1 }],
  customerId: 'ctm_01...',            // optional; checkout can collect it
  customData: { orderId: 'order_123' },
});
// Open it: Paddle.Checkout.open({ transactionId: txn.id }), or send txn.checkout.url
```

- `checkout.url` = your **default payment link** + `?_ptxn=txn_...`. That page must include Paddle.js, which opens the checkout automatically. Set and get approval for the default payment link first (Checkout → Checkout settings); transactions cannot be created without one.
- Manually-collected transactions (`collection_mode: manual`) are invoices; set `billing_details.enable_checkout: true` to include a payment link.
- Paddle.js-opened checkouts create the transaction for you; you only need the API path when the server must fix items, prices or customer up front.

Source: https://developer.paddle.com/build/transactions/pass-transaction-checkout, https://developer.paddle.com/build/transactions/default-payment-link

## Localized Pricing Pages

- Browser: `Paddle.PricePreview({ items: [{ priceId, quantity }], address?: { countryCode } })` returns localized totals (IP-based location when omitted) and is not rate limited.
- Server: `POST /pricing-preview` (1,000 req/min per IP).
- Format amounts from the returned formatted fields or divide minor units by the currency's decimals (0 for JPY, KRW, CLP, VND).

Source: https://developer.paddle.com/paddle-js/methods/paddle-pricepreview

## Discounts

`POST /discounts` creates percentage, flat or flat-per-seat discounts, optionally with a `code` customers can enter. Pass `discountCode` or `discountId` to `Paddle.Checkout.open()`, or `discount_id` on a transaction. Source: OpenAPI `/discounts`; https://developer.paddle.com/build/products/offer-discounts-promotions-coupons

## Payment Methods

Cards, PayPal, Apple Pay, Google Pay and local methods (Alipay, WeChat Pay, iDEAL, Bancontact, BLIK, MB WAY, Pix, UPI, Korean cards/wallets, bank transfer) appear by country, currency and account settings. Restrict per checkout with `settings.allowedPaymentMethods`. Source: https://developer.paddle.com/concepts/payment-methods

## Common Mistakes

- Using an API key in the browser. Only `test_`/`live_` client-side tokens belong in frontend code.
- Sending `unit_price.amount` as a number or in major units.
- Mixing sandbox tokens/price IDs with the live script environment (or forgetting `Paddle.Environment.set('sandbox')`).
- Fulfilling on `checkout.completed` in the browser or on the success URL.
- No default payment link or unapproved domain: transaction creation and payment links fail.
