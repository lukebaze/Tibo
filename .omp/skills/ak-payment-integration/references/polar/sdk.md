# Polar SDK Usage

Official SDKs (TypeScript, Python) and framework adapters.

**Status (Sep 2026):**
- Stable: `@polar-sh/sdk` 0.x (npm `latest`), `polar-sdk` 0.x (PyPI). Speakeasy-generated; source now lives in the `polarsource/polar` monorepo.
- Preview: SDK 1.0 (npm `next` / `pip install --pre`), bound to a dated API version (`2026-04`). Breaking API changes are opt-in via `Polar-Version`.
- Go (`polar-go`) and PHP (`polar-php`) SDKs are archived/unmaintained; call the REST API directly from those languages.

## TypeScript/JavaScript

**Installation:**
```bash
npm install @polar-sh/sdk
```

**Configuration:**
```typescript
import { Polar } from '@polar-sh/sdk';

const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN, // polar_oat_...
  server: "production" // or "sandbox"
});
```

**Usage (camelCase fields; mutations take `{ id, <resource>Update }`):**
```typescript
// Products
const product = await polar.products.create({
  name: "Pro Plan",
  recurringInterval: "month",
  prices: [{ amountType: "fixed", priceCurrency: "usd", priceAmount: 2000 }]
});
const one = await polar.products.get({ id: product.id });

// Checkouts
const checkout = await polar.checkouts.create({
  products: [product.id],
  successUrl: "https://example.com/success?checkout_id={CHECKOUT_ID}",
  externalCustomerId: "user_123"
});

// Subscriptions
const subs = await polar.subscriptions.list({ externalCustomerId: "user_123", active: true });
await polar.subscriptions.update({ id: subId, subscriptionUpdate: { metadata: { plan: "pro" } } });

// Orders
const order = await polar.orders.get({ id: orderId });

// Customers (by your user ID)
const customer = await polar.customers.getExternal({ externalId: "user_123" });
const state = await polar.customers.getStateExternal({ externalId: "user_123" });

// Portal link
const session = await polar.customerSessions.create({ externalCustomerId: "user_123" });
// session.customerPortalUrl

// Events (usage-based)
await polar.events.ingest({
  events: [{ name: "api_call", externalCustomerId: "user_123", metadata: { tokens: 1000 } }]
});
```

**Pagination:** list methods return an async iterable of pages.
```typescript
const result = await polar.products.list({ limit: 100 });
for await (const page of result) {
  for (const product of page.result.items) console.log(product.name);
}
// Raw REST: ?page=&limit= (max 100); response.pagination { total_count, max_page }
```

### SDK 1.0 (preview)
```bash
npm install @polar-sh/sdk@next
```
```typescript
import { createPolar, webhooks } from "@polar-sh/sdk/2026-04";

const polar = createPolar({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  environment: "sandbox" // or "production"
});
// webhooks.validateEvent is async and supports both webhook signing schemes
```
Preview APIs may change between alpha releases; pin the exact version.

## Python

**Installation:**
```bash
pip install polar-sdk              # stable 0.x
pip install --pre polar-sdk        # 1.0 preview: from polar.v2026_04 import Polar, PolarAsync
```

**Configuration:**
```python
import os
from polar_sdk import Polar

polar = Polar(
    access_token=os.environ["POLAR_ACCESS_TOKEN"],
    server="production",  # or "sandbox"
)
```

**Sync Usage (snake_case; create/update take `request=` dicts):**
```python
checkout = polar.checkouts.create(request={
    "products": ["product_id"],
    "success_url": "https://example.com/success?checkout_id={CHECKOUT_ID}",
    "external_customer_id": "user_123",
})

res = polar.subscriptions.list(external_customer_id="user_123", active=True)
while res is not None:
    for sub in res.result.items:
        print(sub.id)
    res = res.next()

polar.events.ingest(request={
    "events": [{"name": "api_call", "external_customer_id": "user_123", "metadata": {"tokens": 1000}}],
})
```

**Async Usage (stable):**
```python
import asyncio, os
from polar_sdk import Polar

async def main():
    async with Polar(access_token=os.environ["POLAR_ACCESS_TOKEN"]) as polar:
        res = await polar.products.list_async(limit=10)

asyncio.run(main())
```

## Framework Adapters

Maintained: **Next.js**, **Nuxt**, **TanStack Start**, **Laravel** (community), **BetterAuth**.
Deprecated (no longer maintained): Astro, Deno, Elysia, Express, Fastify, Hono, Remix, Supabase, SvelteKit; use the core SDK instead.

### Next.js (`@polar-sh/nextjs`)

```bash
npm install @polar-sh/nextjs zod
```

**Checkout route:**
```typescript
// app/checkout/route.ts
import { Checkout } from "@polar-sh/nextjs";

export const GET = Checkout({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  successUrl: process.env.SUCCESS_URL,
  server: "sandbox" // omit in production
});
// /checkout?products=<id>&customerExternalId=<userId>&customerEmail=...
```

**Customer portal route:**
```typescript
// app/portal/route.ts
import { CustomerPortal } from "@polar-sh/nextjs";

export const GET = CustomerPortal({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  getCustomerId: async (req) => await lookupPolarCustomerId(req),
  server: "sandbox"
});
```

**Webhook route:**
```typescript
// app/api/webhook/polar/route.ts
import { Webhooks } from "@polar-sh/nextjs";

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  onOrderPaid: async (payload) => { /* fulfill */ },
  onPayload: async (payload) => { /* catch-all */ }
});
```

For server actions, create a plain `new Polar({...})` client (see TypeScript above).

### Laravel (`danestves/laravel-polar`, community-maintained)

```bash
composer require danestves/laravel-polar
php artisan polar:install
```

```php
// Billable model trait, then:
return $request->user()->checkout(['product_id_123']);
```
Webhooks arrive on `polar/*` (exclude from CSRF); listen to `Danestves\LaravelPolar\Events\WebhookHandled` or typed events. See the package README for config keys.

### Express / other Node frameworks (core SDK)

```javascript
import express from 'express';
import { Polar } from '@polar-sh/sdk';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';

const app = express();
const polar = new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN });

// Register the webhook route BEFORE express.json() and keep the raw body
app.post('/webhook/polar', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = validateEvent(req.body, req.headers, process.env.POLAR_WEBHOOK_SECRET);
    enqueue(event);
    res.status(202).send('');
  } catch (err) {
    if (err instanceof WebhookVerificationError) return res.status(403).send('');
    // Valid signature but unknown event type for this SDK version: acknowledge, don't 5xx
    console.warn('Unparsed Polar event', req.headers['webhook-id'], err);
    res.status(202).send('');
  }
});

app.post('/checkout', express.json(), async (req, res) => {
  const checkout = await polar.checkouts.create({
    products: [req.body.productId],
    successUrl: 'https://example.com/success?checkout_id={CHECKOUT_ID}',
    externalCustomerId: req.user.id
  });
  res.json({ url: checkout.url });
});
```
See `webhooks.md` for signing-scheme caveats of the stable `validateEvent`.

## BetterAuth Integration

```bash
npm install better-auth @polar-sh/better-auth @polar-sh/sdk
```

```typescript
import { betterAuth } from "better-auth";
import { polar, checkout, portal, usage, webhooks } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";

const polarClient = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  server: "sandbox"
});

export const auth = betterAuth({
  plugins: [
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({ products: [{ productId: "product_id", slug: "pro" }], successUrl: "/success?checkout_id={CHECKOUT_ID}" }),
        portal(),
        usage(),
        webhooks({ secret: process.env.POLAR_WEBHOOK_SECRET, onOrderPaid: async (payload) => {} })
      ]
    })
  ]
});
```

**Features:** customer created on signup with `externalId` = user ID, checkout by slug, portal/state access, usage ingestion, typed webhook handlers.

## Error Handling

**TypeScript (stable):**
```typescript
import { SDKError } from "@polar-sh/sdk/models/errors/sdkerror.js";
import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound.js";

try {
  const product = await polar.products.get({ id: productId });
} catch (error) {
  if (error instanceof ResourceNotFound) {
    console.error('Product not found');
  } else if (error instanceof SDKError && error.statusCode === 429) {
    // honor Retry-After, back off
  } else {
    throw error;
  }
}
// All HTTP errors extend PolarError { statusCode, body, headers }
```

**Python (stable):**
```python
from polar_sdk import models

try:
    product = polar.products.get(id=product_id)
except models.PolarError as e:
    if e.status_code == 404:
        print("Product not found")
    elif e.status_code == 429:
        print("Rate limited")
    else:
        raise
```

## Best Practices

1. **Credentials:** OAT only server-side; separate sandbox and production tokens
2. **Rate limits:** 500 req/min (sandbox 100); back off on 429 using `Retry-After`
3. **Pagination:** iterate pages (`limit` max 100)
4. **Webhooks:** verify on the raw body; mind the signing-scheme cutoff (`webhooks.md`)
5. **Versioning:** pin SDK versions; the 1.0 preview changes shapes between alphas
6. **Testing:** develop against sandbox (`server: "sandbox"`)
