# Polar Subscriptions

Subscription lifecycle, plan changes, trials, pause/resume, cancellation and dunning.

Examples use the stable TypeScript SDK (`@polar-sh/sdk` 0.x). All mutations go through `PATCH /v1/subscriptions/{id}` (`polar.subscriptions.update`), except revoke (`DELETE`).

## Lifecycle States

`status` values:
- `incomplete` / `incomplete_expired` - Initial payment not completed
- `trialing` - In trial, benefits granted, not yet charged
- `active` - Paid and current (also while `cancel_at_period_end` or `pause_at_period_end` is pending)
- `past_due` - Renewal payment failed, dunning in progress
- `unpaid` - Recovery failed
- `paused` - Pause took effect; billing stopped, benefits revoked
- `canceled` - Ended (after period end, immediate revoke, or failed recovery)

Flags: `cancel_at_period_end`, `pause_at_period_end`, `resumes_at`, `ends_at`, `ended_at`, `past_due_at`, `pending_update`.

By default a customer can have one active subscription per organization; enable **Allow multiple subscriptions** in organization settings if needed.

## API Operations

### List Subscriptions
```typescript
const result = await polar.subscriptions.list({
  externalCustomerId: "user_123",
  active: true,
  // also: productId, customerId, status, cancelAtPeriodEnd, metadata, page, limit
});
for await (const page of result) {
  console.log(page.result.items);
}
```

### Get Subscription
```typescript
const subscription = await polar.subscriptions.get({ id: subscriptionId });
```

### Create (free products only)
`POST /v1/subscriptions/` subscribes an existing customer to a **free** recurring product (no order, no charge). Paid subscriptions always go through checkout.

## Upgrades & Downgrades

### Change Plan
```typescript
await polar.subscriptions.update({
  id: subscriptionId,
  subscriptionUpdate: {
    productId: "new_product_id",
    prorationBehavior: "prorate"
  }
});
```
- New product must share the subscription currency; PWYW products aren't valid targets
- Not allowed on canceled / scheduled-to-cancel subscriptions (uncancel first)
- Non-seat → seat-based allowed (immediate only); seat → non-seat not allowed
- Trialing subscriptions keep a recomputed trial

### Proration Behaviors (`proration_behavior`)

- `invoice` - Apply now, charge/credit the prorated difference immediately
- `prorate` - Apply now, carry the difference to the next invoice (promoted to `invoice` if the interval changes)
- `next_period` - Schedule as `pending_update`, applied at next cycle, no proration
- `reset` - Preview, paid plans only: apply now, charge full new price, restart the cycle

**Notes:**
- Organization default set in **Settings → Subscriptions**; also applies to customer-initiated portal changes
- Proration is per-second over the real period length
- For `invoice`/`prorate`, if the immediate payment fails the API errors and the subscription is unchanged
- A new update supersedes a pending `next_period` update

### Change Seats
```typescript
await polar.subscriptions.update({
  id: subscriptionId,
  subscriptionUpdate: { seats: 25, prorationBehavior: "invoice" }
});
```

### Customer-Initiated Changes
Customer Portal settings control self-service: plan changes, seat management, pause/resume. Cancel at period end and payment method updates are always available.

## Trials

### Configuration
- Product: `trialInterval` (`day` | `week` | `month` | `year`) + `trialIntervalCount`
- Checkout Link / Checkout Session trial overrides the product trial
- `allowTrial: false` on a checkout disables it

```typescript
const checkout = await polar.checkouts.create({
  products: ["product_id"],
  trialInterval: "day",
  trialIntervalCount: 7
});
```

### Manage Trial on a Subscription
```typescript
// Add/extend: future date (active → trialing)
await polar.subscriptions.update({
  id: subscriptionId,
  subscriptionUpdate: { trialEnd: new Date("2026-12-01T00:00:00Z") }
});
// End now: REST body {"trial_end": "now"} (SDK 0.49 types trialEnd as Date only)
// → charges synchronously; becomes active only if payment succeeds
```

### Trial Behavior
- Payment method collected at checkout, not charged until trial end
- Benefits granted during trial
- Reminder email before conversion (3 days before for trials of 3+ days)
- Optional **Prevent trial abuse** (email alias + card fingerprint)

## Cancellations

### Cancel at Period End
```typescript
await polar.subscriptions.update({
  id: subscriptionId,
  subscriptionUpdate: {
    cancelAtPeriodEnd: true,
    customerCancellationReason: "too_expensive" // optional, only if customer-provided
  }
});
// Status stays active until current_period_end
// Webhooks now: subscription.updated, subscription.canceled
// At period end: subscription.updated, subscription.revoked (status canceled)
```

Reasons: `too_expensive`, `missing_features`, `switched_service`, `unused`, `customer_service`, `low_quality`, `too_complex`, `other`.

### Revoke Immediately (irreversible)
```typescript
await polar.subscriptions.revoke({ id: subscriptionId });
// Status canceled now, benefits revoked, no automatic refund
// Webhooks: subscription.updated, subscription.canceled, subscription.revoked
```

### Uncancel
```typescript
await polar.subscriptions.update({
  id: subscriptionId,
  subscriptionUpdate: { cancelAtPeriodEnd: false }
});
// Only before the end date; fires subscription.uncanceled
```

## Pause & Resume

```typescript
// Pause at period end (optional automatic resume date)
await polar.subscriptions.update({
  id: subscriptionId,
  subscriptionUpdate: { pauseAtPeriodEnd: true, resumesAt: new Date("2026-11-01T00:00:00Z") }
});

// Resume now: new period starts, customer charged immediately
await polar.subscriptions.update({
  id: subscriptionId,
  subscriptionUpdate: { resume: true }
});
```
Webhooks: `subscription.paused` when the pause takes effect, `subscription.resumed` + `order.created` on resume.

## Reschedule Renewal
```typescript
await polar.subscriptions.update({
  id: subscriptionId,
  subscriptionUpdate: { currentBillingPeriodEnd: new Date("2026-07-15T00:00:00Z") }
});
```

## Renewals

Sequence: `subscription.cycled` → `subscription.updated` → `order.created` (`pending`) → `order.updated` → `order.paid`.

```typescript
switch (event.type) {
  case 'subscription.cycled':
    // New billing period (also fires on trial conversion; check status)
    await extendAccess(event.data);
    break;
  case 'order.paid':
    if (event.data.billingReason === 'subscription_cycle') {
      await recordRenewalPayment(event.data);
    }
    break;
}
```

### Failed Renewals (dunning)
- Status → `past_due` (`past_due_at` set), customer emailed a portal link
- Retries at +2, +7, +14, +21 days from first failure; immediate retry when the payment method is updated
- All retries fail (or hard decline like `lost_card`) → subscription revoked, benefits revoked
- Optional org **grace period** (Immediately default, 2/7/14/21 days) delays benefit revocation while `past_due`
- Webhooks: `subscription.past_due`, `subscription.updated`

## Discounts

```typescript
await polar.subscriptions.update({
  id: subscriptionId,
  subscriptionUpdate: { discountId: "discount_id" } // null removes it
});
// Applies from the next billing cycle
```

Discount types: `percentage` (`basis_points`, 1000 = 10%) or `fixed` (`amount` in cents). Duration: `once`, `forever`, `repeating` (`duration_in_months`).

## Customer Portal

### Pre-authenticated Portal Link
```typescript
app.get('/portal', async (req, res) => {
  const session = await polar.customerSessions.create({
    externalCustomerId: req.user.id // or customerId
  });
  res.redirect(session.customerPortalUrl);
});
```
Customer sessions are short-lived: create one per click, don't store the URL. Default portal: `https://polar.sh/<org-slug>/portal` (email OTP login).

### Portal Features
- View orders, invoices, subscriptions, benefits (license keys, downloads)
- Cancel at period end, update payment method (always)
- Change plan, seats, pause/resume (if enabled)

## Metadata

```typescript
await polar.subscriptions.update({
  id: subscriptionId,
  subscriptionUpdate: { metadata: { tier: "pro" } }
});

const result = await polar.subscriptions.list({ metadata: { tier: "pro" } });
```

## Best Practices

1. **Lifecycle Management:**
   - Gate access on Customer State or `customer.state_changed`, or sync `subscription.*` events
   - `subscription.updated` is the catch-all for status transitions

2. **Upgrades/Downgrades:**
   - Pick a proration default per org; override per call
   - Use `next_period` for downgrades without credits

3. **Trials:**
   - Enable trial abuse prevention
   - Show trial end date in your UI

4. **Cancellations:**
   - Prefer cancel at period end; revoke only for abuse/chargebacks
   - Record customer-provided reasons only

5. **Failed Payments:**
   - Configure a grace period
   - Link `past_due` customers to the portal to update their card

## Common Patterns

### Subscription Status Check
```typescript
async function hasActiveSubscription(userId: string) {
  const state = await polar.customers.getStateExternal({ externalId: userId });
  return state.activeSubscriptions.length > 0;
}
```

### Past-due Banner
```typescript
if (event.type === 'subscription.updated' && event.data.status === 'past_due') {
  await showUpdatePaymentBanner(event.data.customer.externalId);
}
```
