# Lemon Squeezy Checkouts and Products

Stores, products, variants, prices, discounts and checkouts (hosted, overlay, API). Verified 2026-09-26 against https://docs.lemonsqueezy.com/api and the developer guide.

## Catalog Model

```
User ─ Store ─ Product ─ Variant ─ Price
                 │          └─ Files, license key settings
                 └─ Discounts, Customers, Orders, Subscriptions, Webhooks
```

- **Store:** `GET /v1/stores`. Store ID is needed for checkouts, webhooks and discounts (Settings → Stores, or the API).
- **Product:** container with `status` (`draft` | `published`), `buy_now_url`, `pay_what_you_want`.
- **Variant:** the purchasable unit (e.g. "Monthly", "Yearly"). Checkouts target a variant. `status` is `pending` | `draft` | `published`; a lone `pending` variant is the product's default variant and is not shown as a separate option.
- **Price:** pricing model per variant. `category` (`one_time`, `subscription`, `lead_magnet`, `pwyw`), `scheme` (`standard`, `package`, `graduated`, `volume`), `usage_aggregation` (`sum`, `last_during_period`, `last_ever`, `max`), `renewal_interval_unit` (`day`, `week`, `month`, `year`), trial interval, `setup_fee`, `tax_code` (`eservice`, `ebook`, `saas`).
- Pricing fields on Variant objects are deprecated in favour of Price objects (API changelog 2023-08-23).

**Products, variants and prices are read-only in the API** (list/retrieve only). Create and edit them in the dashboard, then store their IDs in config per mode (test and live IDs differ).

```bash
curl "https://api.lemonsqueezy.com/v1/variants?filter[product_id]=$PRODUCT_ID" \
  -H 'Accept: application/vnd.api+json' -H 'Content-Type: application/vnd.api+json' \
  -H "Authorization: Bearer $LEMONSQUEEZY_API_KEY"
```

Sources: https://docs.lemonsqueezy.com/api/products/the-product-object, https://docs.lemonsqueezy.com/api/variants/the-variant-object, https://docs.lemonsqueezy.com/api/prices/the-price-object

## Checkout URLs

```
https://[STORE].lemonsqueezy.com/checkout/buy/[VARIANT_ID]
```

- Share links contain `/checkout/buy/`. Opening one converts it to a single-use, per-customer cart URL (`/checkout/?cart=`); never store or share the cart URL.
- Query parameters prefill and customize share links: `checkout[email]`, `checkout[name]`, `checkout[billing_address][country]` (ISO 3166-1 alpha-2), `[state]`, `[zip]`, `checkout[tax_number]`, `checkout[discount_code]`, `checkout[custom][user_id]=123`, `quantity`, `embed=1`, `logo=0`, `button_color=%23111111`.
- Custom prices cannot be set by URL; use the API.

Sources: https://docs.lemonsqueezy.com/guides/developer-guide/taking-payments, https://docs.lemonsqueezy.com/help/checkout/prefilled-checkout-fields

## Create a Checkout (API)

`POST /v1/checkouts` with required `store` and `variant` relationships. Response `data.attributes.url` is the checkout URL (signed; expires with `expires_at` if set).

```bash
curl -X POST "https://api.lemonsqueezy.com/v1/checkouts" \
  -H 'Accept: application/vnd.api+json' -H 'Content-Type: application/vnd.api+json' \
  -H "Authorization: Bearer $LEMONSQUEEZY_API_KEY" \
  -d '{
  "data": {
    "type": "checkouts",
    "attributes": {
      "checkout_data": {
        "email": "user@example.com",
        "custom": { "user_id": "user_123", "order_id": "order_123" }
      },
      "product_options": {
        "redirect_url": "https://example.com/billing/success",
        "enabled_variants": [11]
      },
      "checkout_options": { "embed": true, "locale": "en" },
      "expires_at": "2026-10-01T00:00:00Z"
    },
    "relationships": {
      "store":   { "data": { "type": "stores",   "id": "1" } },
      "variant": { "data": { "type": "variants", "id": "11" } }
    }
  }
}'
```

### Attributes

| Attribute | Purpose |
|-----------|---------|
| `custom_price` | Positive integer in minor units, excludes tax; for subscriptions it is kept for all renewals until the variant changes |
| `product_options` | `name`, `description`, `media`, `redirect_url`, `receipt_button_text`, `receipt_link_url`, `receipt_thank_you_note`, `enabled_variants` (empty = all variants shown) |
| `checkout_options` | `embed` (overlay), `media`, `logo`, `desc`, `discount`, `skip_trial`, `subscription_preview`, color overrides (`button_color`, `background_color`, ...), `locale` (ISO 639 code, e.g. `en`, `vi`); `dark` is deprecated |
| `checkout_data` | Prefill `email`, `name`, `billing_address.country`, `billing_address.zip`, `tax_number`, `discount_code`; `custom` object; `variant_quantities: [{ variant_id, quantity }]` |
| `preview` | `true` returns a `preview` object (subtotal, discount, tax, total, USD equivalents); only available on create |
| `test_mode` | Create the checkout in test mode |
| `expires_at` | ISO 8601; `null` = perpetual (safe to cache) |

Source: https://docs.lemonsqueezy.com/api/checkouts/create-checkout

### Flow

1. User clicks Buy → your server creates (or reuses) a pending order row → creates a checkout with `checkout_data.custom` holding your IDs.
2. Redirect to `url`, or open it in the overlay with Lemon.js.
3. Grant access only from verified webhooks (`order_created`, `subscription_created`, `subscription_payment_success`), not from the redirect.

Don't create a checkout on every page load of a high-traffic page; the docs recommend caching the response.

## Custom Data

- Pass via URL (`checkout[custom][user_id]=123`) or API (`checkout_data.custom`).
- It is never shown to the customer and is saved permanently.
- Webhooks for Order, Subscription and License key objects return it in `meta.custom_data`. URL-passed values arrive as strings.
- Keep it minimal: IDs only, no PII or secrets.

Source: https://docs.lemonsqueezy.com/help/checkout/passing-custom-data

## Checkout Overlay (Lemon.js)

```html
<script src="https://app.lemonsqueezy.com/js/lemon.js" defer></script>
<a class="lemonsqueezy-button" href="https://[STORE].lemonsqueezy.com/checkout/buy/[VARIANT_ID]?embed=1">Buy</a>
```

```javascript
// After the server returns an API-created checkout URL
LemonSqueezy.Setup({
  eventHandler: (event) => {
    if (event.event === 'Checkout.Success') {
      // event.data is the Order object: show a "processing" state only;
      // fulfil from the verified webhook
    }
  },
});
LemonSqueezy.Url.Open(checkoutUrl);
```

- Methods: `LemonSqueezy.Setup(options)`, `LemonSqueezy.Refresh()` (re-bind buttons in SPAs), `LemonSqueezy.Url.Open(url)`, `LemonSqueezy.Url.Close()`, `LemonSqueezy.Affiliate.GetID()`, `LemonSqueezy.Affiliate.Build(url)`
- Events: `Checkout.Success`, `PaymentMethodUpdate.Mounted`, `PaymentMethodUpdate.Closed`, `PaymentMethodUpdate.Updated`
- `Url.Open` also opens a subscription's `urls.update_payment_method` in an overlay
- Browser events are client-side and forgeable; they are UX signals only

Sources: https://docs.lemonsqueezy.com/guides/developer-guide/lemonjs, https://docs.lemonsqueezy.com/help/lemonjs/methods

## After Checkout

- Confirmation modal button links to My Orders by default; `product_options.redirect_url` (or the product's "Button link") changes it to a "Continue" button.
- The redirect carries no documented signature or order parameter, so it proves nothing. Look up the order by your custom data once the webhook arrives.
- Receipts can be customized per product or per checkout (`receipt_*` options).

## Discounts

`POST /v1/discounts` (relationship `store`; optional `variants` when `is_limited_to_products`):

| Field | Values |
|-------|--------|
| `code` | Uppercase letters and numbers, 3-256 chars |
| `amount` + `amount_type` | `percent` or `fixed` (minor units) |
| `duration` | `once` (default), `repeating` (+ `duration_in_months`), `forever` |
| Limits | `is_limited_redemptions` + `max_redemptions`, `starts_at`, `expires_at` |

Apply with `checkout_data.discount_code` or `checkout[discount_code]`. Discount usage: `/v1/discount-redemptions`. There is no discount update endpoint; delete and recreate. Source: https://docs.lemonsqueezy.com/api/discounts/create-discount

## Orders

- `status`: `pending`, `failed`, `paid`, `refunded`, `partial_refund`, `fraudulent`
- Useful fields: `identifier` (UUID), `order_number`, `customer_id`, `total`/`total_usd`, `tax`, `tax_inclusive`, `refunded_amount`, `first_order_item` (`product_id`, `variant_id`, `quantity`), `urls.receipt`, `test_mode`
- `POST /v1/orders/:id/generate-invoice` produces a downloadable invoice; send `name`, `address`, `city`, `zip_code`, `country` (`state` for US/CA), which the docs mark as required
- Always check `first_order_item.variant_id` (and `store_id`) against your catalog before fulfilling; any store can send a customer an order for another product

Source: https://docs.lemonsqueezy.com/api/orders/the-order-object

## Customers

- `POST /v1/customers` and `PATCH /v1/customers/:id` create or update customers (store-scoped)
- Customer objects include `urls.customer_portal` (signed, 24 h) when the customer has a subscription
- The `customer_updated` webhook (added 2026-02-25) syncs profile changes

## Resources

- Taking payments guide: https://docs.lemonsqueezy.com/guides/developer-guide/taking-payments
- Checkouts API: https://docs.lemonsqueezy.com/api/checkouts/create-checkout
- Lemon.js: https://docs.lemonsqueezy.com/help/lemonjs
