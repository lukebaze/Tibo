# Creem Products, Checkouts and Discounts

Products, hosted checkout sessions, success-redirect signatures, and discount codes. Verified 2026-09-26 against the OpenAPI spec and https://docs.creem.io/features/checkout/checkout-api.

## Products

`POST /v1/products` (header `Idempotency-Key` optional). Required: `name`, `description`, `price`, `currency`, `billing_type`.

| Field | Values / notes |
|-------|----------------|
| `price` | cents; `0` (free) or ≥ `100` |
| `currency` | `USD`, `EUR` |
| `billing_type` | `onetime`, `recurring` |
| `billing_period` | `once`, `every-day`, `every-month`, `every-three-months`, `every-six-months`, `every-year`, `custom` (required when recurring) |
| `recurring_interval` + `recurring_interval_count` | required with `custom` (`day` 1-365, `week` 1-52, `month` 1-24, `year`) |
| `tax_mode` / `tax_category` | `inclusive`/`exclusive`; `saas`, `digital-goods-service`, `ebooks` |
| `trial_period_days`, `trial_price` | recurring only; `trial_price` charges at checkout instead of a free card check |
| `pay_what_you_want`, `suggested_price` | `price` becomes the minimum |
| `custom_fields` | up to 3 (`custom_field` is deprecated) |
| `default_success_url`, `image_urls`, `abandoned_cart_recovery_enabled`, `usage_prices`, `features` | optional |

Other endpoints: `GET /v1/products/{id}`, `PATCH /v1/products/{id}`, `DELETE /v1/products/{id}` (archive, soft delete), `GET /v1/products/search?page_number&page_size&status`.

Editing a recurring product's price affects **new checkouts only**; existing subscriptions keep their price (see `subscriptions-and-licenses.md`). Source: https://docs.creem.io/features/subscriptions/managing

```typescript
import { Creem } from 'creem';

const creem = new Creem({
  apiKey: process.env.CREEM_API_KEY!,
  server: process.env.CREEM_SERVER === 'prod' ? 'prod' : 'test',
});

const product = await creem.products.create({
  name: 'Pro Plan',
  description: 'Monthly pro subscription',
  price: 1999,
  currency: 'USD',
  billingType: 'recurring',
  billingPeriod: 'every-month',
});
```

The SDK converts snake_case fields to camelCase. Source: https://docs.creem.io/code/sdks/typescript

## Checkout Sessions

`POST /v1/checkouts` returns `checkout_url`; redirect the customer there. Only `product_id` is required.

| Field | Notes |
|-------|-------|
| `product_id` | required |
| `request_id` | your reference (order ID / attempt ID); echoed in the redirect and on the checkout |
| `units` | seats/quantity; total = price × units |
| `custom_price` | per-unit price override in cents (product currency) |
| `discount_code` | prefill a code |
| `affiliate_code` | attribute to an affiliate |
| `customer` | `{ id }` **or** `{ email }`, plus optional `name`; prefills and locks checkout identity |
| `custom_fields` | up to 3 text/checkbox fields |
| `success_url` | per-checkout override of the product default |
| `metadata` | key/value object; delivered in webhooks |

Source: OpenAPI `CreateCheckoutRequest` (https://docs.creem.io/api-reference/endpoint/create-checkout)

```bash
curl -X POST https://test-api.creem.io/v1/checkouts \
  -H "x-api-key: $CREEM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "prod_xxx",
    "request_id": "order_123",
    "success_url": "https://example.com/billing/success",
    "customer": { "email": "user@example.com" },
    "metadata": { "referenceId": "user_123" }
  }'
# → { "id": "ch_...", "checkout_url": "https://checkout.creem.io/ch_...", "status": "pending", ... }
```

```typescript
const checkout = await creem.checkouts.create({
  productId: 'prod_xxx',
  requestId: orderId,
  successUrl: 'https://example.com/billing/success',
  customer: { email: user.email },
  metadata: { referenceId: user.id },
});
return Response.redirect(checkout.checkoutUrl, 303);
```

- Retrieve: `GET /v1/checkouts?checkout_id=...` (SDK `creem.checkouts.retrieve(id)`). Status: `pending`, `processing`, `completed`, `expired`.
- Completed checkout objects include `order`, `subscription`, `customer`, `product`, `metadata`, and `license_keys` (only when the product issues keys).
- Create checkouts server-side from trusted state. Never let the browser choose price, units, discount, customer or `referenceId` for authenticated billing (see the Next.js adapter warning in `sdk-and-cli.md`).

## Success Redirect

After payment the customer lands on `success_url` with query parameters:

`checkout_id`, `order_id`, `customer_id`, `subscription_id`, `product_id`, `request_id` (when set), `signature`.

`order_id` is absent for subscription-only checkouts and `subscription_id` for one-time payments. Source: https://docs.creem.io/features/checkout/checkout-api

**The redirect is UX, not proof of payment.** Fulfil from webhooks (`checkout.completed`, `subscription.paid`). Use the redirect signature only to trust what you render on the success page.

### Redirect signature

`signature = hex(SHA-256("k1=v1|k2=v2|...|salt={API_KEY}"))`

- Parameters in the order they appear in the redirect URL (not sorted)
- Skip `signature` itself and any empty or `null` value
- Salt is the API key of the same environment
- Plain SHA-256 (not HMAC)

```typescript
import crypto from 'crypto';

export function verifyCreemRedirect(rawQuery: string, apiKey: string): boolean {
  const params = new URLSearchParams(rawQuery); // iteration keeps URL order
  const provided = params.get('signature') ?? '';
  const parts: string[] = [];
  for (const [key, value] of params) {
    if (key === 'signature' || value === '' || value === 'null') continue;
    parts.push(`${key}=${value}`);
  }
  parts.push(`salt=${apiKey}`);
  const expected = crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  return /^[0-9a-f]{64}$/.test(provided) && // hex check first: timingSafeEqual throws on length mismatch
    crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
}

// Next.js route handler
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!verifyCreemRedirect(url.search.slice(1), process.env.CREEM_API_KEY!)) {
    return new Response('Invalid signature', { status: 401 });
  }
  // Show "processing" until the webhook marks the order paid
}
```

The docs' TypeScript sample compares with `===`; the Python and Go samples use constant-time compares, as above. Source: https://docs.creem.io/features/checkout/checkout-api#verifying-redirect-signatures

## Other Checkout Options

- **Payment links:** share a product link from the dashboard, no code. https://docs.creem.io/features/checkout/checkout-link
- **Embedded checkout** and **custom fields / localization / branding:** https://docs.creem.io/features/checkout/embedded-checkout, https://docs.creem.io/features/checkout/checkout-custom-fields
- **Product bundles** enable self-service plan switching in the portal. https://docs.creem.io/features/product-bundles

## Discounts

`POST /v1/discounts`. Required: `name`, `type`, `duration`, `applies_to_products`.

| Field | Notes |
|-------|-------|
| `type` | `percentage` (with `percentage`) or `fixed` (with `amount` + `currency`) |
| `code` | optional; generated when empty |
| `duration` | `forever`, `once`, `repeating` (+ `duration_in_months` for subscriptions) |
| `expiry_date`, `max_redemptions` | optional limits |

```typescript
const discount = await creem.discounts.create({
  name: 'Launch Sale',
  code: 'LAUNCH20',
  type: 'percentage',
  percentage: 20,
  duration: 'once',
  maxRedemptions: 100,
  appliesToProducts: ['prod_xxx'],
});

await creem.discounts.get(undefined, 'LAUNCH20'); // by code
await creem.discounts.delete(discount.id);
```

- Get: `GET /v1/discounts?discount_id=` or `?discount_code=`; search: `GET /v1/discounts/search` (filters: `product_id`, `status`, `type`, `created_after`, `created_before`)
- Delete: `DELETE /v1/discounts/{id}/delete`
- Status values: `active`, `draft`, `scheduled`, `expired`, `deleted`
- Apply at checkout with `discount_code`

Source: OpenAPI `CreateDiscountRequestEntity`, https://docs.creem.io/features/discounts

## Customers

- `GET /v1/customers?customer_id=` or `?email=`; `GET /v1/customers/list`; `POST /v1/customers` (`email`, `name`, optional `metadata`, `external_id`); `PATCH /v1/customers`
- Per-customer lists: `/v1/customers/{id}/orders`, `/subscriptions`, `/licenses`
- Portal link: `POST /v1/customers/billing` → `customer_portal_link` (see `subscriptions-and-licenses.md`)

## Resources

- Checkout API guide: https://docs.creem.io/features/checkout/checkout-api
- Create checkout: https://docs.creem.io/api-reference/endpoint/create-checkout
- Create product: https://docs.creem.io/api-reference/endpoint/create-product
- Discounts: https://docs.creem.io/features/discounts
