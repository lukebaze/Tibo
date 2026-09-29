# Polar Products & Pricing

Product management, pricing models, and usage-based billing.

Examples use the stable TypeScript SDK (`@polar-sh/sdk` 0.x, camelCase fields). REST/JSON uses snake_case.

## Billing Cycles

**Options:**
- One-time: Charged once, lifetime access
- Recurring: `recurringInterval` = `day` | `week` | `month` | `year`, plus `recurringIntervalCount` (e.g. every 3 months)

**Important:** Billing cycle and interval are locked at creation. For monthly + yearly, create two products and offer both at checkout.

## Pricing Types

Each price has an `amountType`:
- `fixed` - Set amount (`priceAmount` in cents, `0` = free price)
- `custom` - Pay what you want (`minimumAmount`, optional `maximumAmount`, `presetAmount`)
- `free` - No charge
- `metered_unit` / `metered_tiers` - Usage-based, tied to a meter (subscriptions only)
- `seat_based` - Per-seat with volume or graduated tiers
- `unit_based` - Quantity bought up front with tiered rates

**Important:** Pricing type is locked at creation. Fixed amounts can be changed; existing subscribers are grandfathered.

**Stacking:** A product may combine one fixed price with one seat-based price; metered prices stack on top (e.g. base fee + usage).

**Multi-currency:** Prices in several currencies (`priceCurrency`); a price in the organization default currency is required. Currency is picked from customer geolocation (forward `customer_ip_address` when creating checkouts server-side).

## Advanced Pricing Models

### Seat-Based Pricing
- Billing customer buys N seats, assigns them to members by email or external ID
- Works for subscriptions (seats while active) and one-time (perpetual seats)
- Tier models: fixed per seat, graduated, volume (default)
- Benefits are granted to members when a seat is claimed, not at purchase
- Webhooks: `customer_seat.assigned`, `customer_seat.claimed`, `customer_seat.revoked`

**Configuration:**
```typescript
const product = await polar.products.create({
  name: "Team Plan",
  recurringInterval: "month",
  prices: [{
    amountType: "seat_based",
    priceCurrency: "usd",
    seatTiers: {
      seatTierType: "volume", // or "graduated"
      tiers: [/* see API reference: ProductPriceSeatTier */]
    }
  }]
});
```

### Usage-Based Billing

**Architecture:** Events → Meters → Metered Prices (+ optional Meter Credits)

**1. Events:** Usage data from your application (immutable once ingested)
```typescript
await polar.events.ingest({
  events: [{
    name: "api_call",
    externalCustomerId: "user_123",
    metadata: { tokens: 1000, model: "gpt-4.1" }
  }]
});
```
- Optional `externalId` (dedup), `parentId`, backdated `timestamp`
- Events count toward the billing period in which Polar receives them

**2. Meters:** Filter & aggregate events
```typescript
const meter = await polar.meters.create({
  name: "API Tokens",
  filter: {
    conjunction: "and",
    clauses: [{ property: "name", operator: "eq", value: "api_call" }]
  },
  aggregation: { func: "sum", property: "tokens" } // count | sum | avg | min | max | unique
});
```
- `unit`: `scalar` | `token` | `custom` (display only)
- Filters/aggregation can't change once the meter has processed events or purchases

**3. Metered Prices:** Billing based on usage
```typescript
await polar.products.update({
  id: productId,
  productUpdate: {
    prices: [
      { id: existingFixedPriceId }, // keep existing prices
      {
        amountType: "metered_unit",
        meterId: meter.id,
        priceCurrency: "usd",
        unitAmount: 0.01, // cents per unit, up to 12 decimals
        capAmount: 10000 // optional cap in cents
      }
    ]
  }
});
```

**Credits:**
- Meter Credits benefit (`meter_credit`) pre-pays units; overage is billed only if a metered price exists
- Credited each cycle (subscriptions) or once (one-time), optional rollover
- Balance: Customer State `active_meters` or Customer Meters API (`polar.customerMeters.list`)
- Polar never blocks usage; enforce limits in your app

**Ingestion Strategies (`@polar-sh/ingestion`):** LLM, S3, Stream, Delta Time

## Product Features

### Metadata
```typescript
const product = await polar.products.create({
  name: "Pro Plan",
  recurringInterval: "month",
  prices: [{ amountType: "fixed", priceCurrency: "usd", priceAmount: 2000 }],
  metadata: { tier: "pro" }
});
```

### Custom Fields
Defined once at organization level (types: text, number, date, checkbox, select), then attached per product:
```typescript
const field = await polar.customFields.create({
  type: "text",
  slug: "company_name",
  name: "Company Name",
  properties: { formLabel: "Company name" }
});

await polar.products.update({
  id: productId,
  productUpdate: {
    attachedCustomFields: [{ customFieldId: field.id, required: true }]
  }
});
```

Values appear on the order/subscription in `custom_field_data`.

### Trials
- Product-level: `trialInterval` (`day` | `week` | `month` | `year`) + `trialIntervalCount`
- Checkout Link / Checkout Session trial overrides the product trial
- Payment method collected at checkout; charged when the trial ends

```typescript
const product = await polar.products.create({
  name: "Pro Plan",
  recurringInterval: "month",
  trialInterval: "day",
  trialIntervalCount: 14,
  prices: [{ amountType: "fixed", priceCurrency: "usd", priceAmount: 2000 }]
});
```

## Product Operations

### Create Product
```typescript
const product = await polar.products.create({
  name: "Pro Plan",
  description: "Professional features",
  recurringInterval: "month", // omit (null) for one-time
  prices: [{ amountType: "fixed", priceCurrency: "usd", priceAmount: 2000 }]
});
// organizationId is only required when not using an organization token
```

### List Products
```typescript
const result = await polar.products.list({ isArchived: false, limit: 100 });
for await (const page of result) {
  console.log(page.result.items);
}
```

### Update Product
```typescript
await polar.products.update({
  id: productId,
  productUpdate: { name: "Pro Plan Updated", description: "New description" }
});
```

### Archive / Delete Product
```typescript
await polar.products.update({ id: productId, productUpdate: { isArchived: true } });
// Unarchive with isArchived: false
// DELETE /v1/products/{id} works only for products without orders,
// subscriptions, trials or discounts
```

### Update Benefits
```typescript
await polar.products.updateBenefits({
  id: productId,
  productBenefitsUpdate: { benefits: [benefitId1, benefitId2] }
});
```

## Important Constraints

1. **Locked after creation:** billing cycle/interval and pricing type
2. **Price changes don't affect existing subscribers** (grandfathered); migrate per subscription via plan change
3. **Delete only unused products**; archive everything else (hidden from new checkouts, renewals continue)
4. **Metadata vs Custom Fields:** metadata is internal; custom fields are collected from customers
5. **Benefit changes propagate** to existing customers (added = granted, removed = revoked)

## Best Practices

1. **Product Strategy:**
   - Plan billing cycle and pricing type before creation
   - One product per tier/interval; show variants side by side at checkout
   - Use Duplicate Product for yearly variants or pricing tests

2. **Pricing Changes:**
   - Change fixed amounts in place for new buyers
   - Move existing subscribers deliberately via plan change

3. **Usage-Based:**
   - Send an `externalId` per event for deduplication
   - Keep meter filters narrow and stable
   - Enforce balances in your app; show usage in the Customer Portal

4. **Custom Fields:**
   - Collect only necessary information
   - Use required checkboxes for legal terms

5. **Trials:**
   - Enable "Prevent trial abuse" in subscription settings
   - Polar emails trial-conversion reminders (3 days before for trials of 3+ days)
