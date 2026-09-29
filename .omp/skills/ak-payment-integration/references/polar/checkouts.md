# Polar Checkouts

Checkout flows, embedded checkout, and session management.

Examples use the stable TypeScript SDK (`@polar-sh/sdk` 0.x, camelCase). REST bodies use snake_case.

## Checkout Approaches

### 1. Checkout Links
- Long-lived shareable URLs; each visit creates a fresh Checkout Session
- Created via dashboard or API; can preset discount, trial, seats, metadata
- Share the link URL, never a generated session URL (sessions expire)

**Create via API:**
```typescript
const link = await polar.checkoutLinks.create({
  paymentProcessor: "stripe", // required, only "stripe" supported
  products: ["product_id_1", "product_id_2"],
  successUrl: "https://example.com/success?checkout_id={CHECKOUT_ID}"
});
// Share: link.url
```

**Query params on a link URL:** `product_id` (preselect), `customer_email`, `customer_name`, `discount_code`, `amount` (PWYW), `locale`, `theme=light|dark`, `custom_field_data.{slug}`, `reference_id`, `utm_source|medium|campaign|content|term` (stored in metadata)

### 2. Checkout Sessions (API)
- Created server-side for per-customer, dynamic flows

**Create Session:**
```typescript
const checkout = await polar.checkouts.create({
  products: ["product_id"], // product IDs; first is preselected
  successUrl: "https://example.com/success?checkout_id={CHECKOUT_ID}",
  externalCustomerId: "user_123",
  customerEmail: "user@example.com",
  customerIpAddress: clientIp, // when calling from a backend/proxy
  metadata: { source: "web" }
});

// Redirect to: checkout.url
```

**Response (subset):**
```json
{
  "id": "…",
  "url": "https://polar.sh/checkout/…",
  "client_secret": "…",
  "status": "open",
  "expires_at": "…"
}
```

### 3. Embedded Checkout
- Inline overlay on your site via `@polar-sh/checkout`
- Works with a Checkout Link or a session URL created with `embed_origin`
- Allowed hosts must be listed in **Settings → Preferences → Embedding**
- Apple Pay / Google Pay in embeds require domain validation (email Polar support)

**Code snippet (no build step):**
```html
<a href="__CHECKOUT_LINK_OR_SESSION_URL__" data-polar-checkout data-polar-checkout-theme="light">
  Purchase
</a>
<script defer data-auto-init
  src="https://cdn.jsdelivr.net/npm/@polar-sh/checkout@latest/dist/embed.global.js"></script>
```

**Library:**
```typescript
import { PolarEmbedCheckout } from "@polar-sh/checkout/embed";

const checkout = await PolarEmbedCheckout.create(sessionUrl, {
  theme: "dark",
  onLoaded: () => console.log("loaded")
});

checkout.addEventListener("success", (event) => {
  // event.preventDefault() to stop the automatic redirect
  if (!event.detail.redirect) showSuccessMessage();
});
checkout.addEventListener("close", () => {});
checkout.addEventListener("confirmed", () => {}); // payment processing
```

**Server-side (create session for embedding):**
```typescript
app.post('/api/create-checkout', async (req, res) => {
  const checkout = await polar.checkouts.create({
    products: [req.body.productId],
    embedOrigin: "https://example.com",
    externalCustomerId: req.user.id
  });

  res.json({ url: checkout.url });
});
```

## Configuration Parameters

### Required
- `products` - Array of product IDs (customer picks one; true multi-product bundles are not supported)
- Deprecated forms: `product_price_id` and `product_id` (use `products`)

### Optional
- `success_url` - Absolute URL; supports `{CHECKOUT_ID}` placeholder
- `return_url` - Shows a back button to this URL
- `external_customer_id` / `customer_id` - Link to an existing or new customer (email field is then locked)
- `customer_email`, `customer_name`, `customer_billing_address`, `customer_tax_id`, `is_business_customer`
- `customer_ip_address` - Forward the buyer IP for currency/tax country detection
- `customer_metadata` - Copied to the created customer
- `discount_id` - Pre-apply a discount
- `allow_discount_codes` - Allow code entry (default `true`)
- `require_billing_address` - Full address instead of country only
- `trial_interval` + `trial_interval_count` - Override product trial; `allow_trial: false` disables it
- `seats`, `min_seats`, `max_seats` / `units`, `min_units`, `max_units` - Seat/unit-based pricing
- `amount` - Pay-what-you-want amount
- `prices` - Ad-hoc prices per product ID (session-only, `source: "ad_hoc"`)
- `subscription_id` - Upgrade an existing free subscription
- `embed_origin` - Origin of the embedding page
- `locale`, `currency`
- `metadata` - Copied to the resulting order/subscription
- `custom_field_data` - Pre-fill custom fields

### Success URL Placeholder
```typescript
{
  successUrl: "https://example.com/success?checkout_id={CHECKOUT_ID}"
}
// Polar replaces {CHECKOUT_ID} with the actual checkout ID
```

## Ad-hoc Prices

```typescript
const checkout = await polar.checkouts.create({
  products: ["product_id"],
  prices: {
    product_id: [{ amountType: "fixed", priceAmount: 10000, priceCurrency: "usd" }]
  }
});
```

## Discount Application

### Pre-apply Discount
```typescript
const checkout = await polar.checkouts.create({
  products: ["product_id"],
  discountId: "discount_id",
  successUrl: "https://example.com/success"
});
```

### Allow Customer Codes
```typescript
{
  allowDiscountCodes: false // default true; a discountId still applies
}
```

## Checkout States

- `open` - Ready for payment
- `expired` - Session expired without completion (`checkout.expired` webhook)
- `confirmed` - Customer confirmed, payment processing
- `succeeded` - Payment succeeded, order created
- `failed` - Payment failed

## Events

**Webhook Events:**
- `checkout.created`, `checkout.updated`, `checkout.expired`
- `order.created` - Order created (may still be `pending`)
- `order.paid` - Payment collected; use this for fulfillment

**Handle Success:**
```typescript
import { validateEvent } from '@polar-sh/sdk/webhooks';

// Raw body required for signature verification
app.post('/webhook/polar', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = validateEvent(req.body, req.headers, process.env.POLAR_WEBHOOK_SECRET);

  if (event.type === 'order.paid') {
    await fulfillOrder(event.data);
  }

  res.status(202).send('');
});
```

## Best Practices

1. **Success URL:**
   - Absolute URL with `{CHECKOUT_ID}` placeholder
   - Treat the redirect as UX only; fulfill on `order.paid` webhook or verified API state

2. **External Customer ID:**
   - Set on every checkout from your authenticated user ID
   - Use Customer State by external ID for access checks

3. **Server-side creation:**
   - Forward `customer_ip_address`, otherwise currency/tax country uses your server IP

4. **Embedded Checkout:**
   - List every host (including staging/preview) under Embedding settings
   - Set `embed_origin` on API-created sessions
   - Blank embed with a `frame-ancestors` console error means the host isn't allowed

5. **Metadata:**
   - Store your order ID/tracking info; keys max 40 characters

6. **Error Handling:**
   - Create a new session when one expires
   - Log failures with the checkout ID

## Framework Examples

### Next.js (`@polar-sh/nextjs`)
```typescript
// app/checkout/route.ts
import { Checkout } from "@polar-sh/nextjs";

export const GET = Checkout({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  successUrl: process.env.SUCCESS_URL,
  server: "sandbox" // omit or "production" in prod
});
// Link to /checkout?products=<productId>&customerExternalId=<userId>
```

### Next.js server action (SDK directly)
```typescript
'use server'
import { polar } from '@/lib/polar';

export async function createCheckout(productId: string) {
  const checkout = await polar.checkouts.create({
    products: [productId],
    successUrl: `${process.env.NEXT_PUBLIC_URL}/success?checkout_id={CHECKOUT_ID}`,
    externalCustomerId: await getCurrentUserId()
  });
  return checkout.url;
}
```

### Laravel (`danestves/laravel-polar`, community-maintained)
```php
// Billable model; see package docs for full API
return $request->user()->checkout(['product_id_123']);
```
