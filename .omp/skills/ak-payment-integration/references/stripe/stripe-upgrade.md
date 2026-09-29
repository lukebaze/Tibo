---
name: upgrade-stripe
description: Guide for upgrading Stripe API versions, webhook endpoints, server-side SDKs, Stripe.js, and mobile SDKs
---

# Upgrading Stripe Versions

Derived from Stripe's official `upgrade-stripe` agent skill (github.com/stripe/ai, synced 2026-09-26).

**Full documentation index**: https://docs.stripe.com/llms.txt

## Choose a target API version

If the user names a target, use it. Otherwise look up the current version on [API versioning](https://docs.stripe.com/api/versioning.md) (the sentence beginning "The current version is"), for example with `stripe docs /api/versioning`.

Bundled fallback: **`2026-08-26.dahlia`** (verified 2026-09-26). Stable versions ship monthly, so a fallback older than a month is probably stale; use it only when docs.stripe.com is unreachable, say the latest version is unverified, and never guess a newer name.

Before changing anything, compare the target with every place the integration pins a version: client config, per-request overrides, and webhook endpoints / event destinations. Don't move a pin to an older version or from stable to preview unless asked. Report pins that already match as unchanged.

## Understanding Stripe API Versioning

Versions are date-based: `2026-08-26.dahlia`, `2025-12-15.clover`, `2025-08-27.basil`, `2024-12-18.acacia`. Since `2024-09-30.acacia`, Stripe ships monthly releases with no breaking changes; twice a year a new major (Acacia, Basil, Clover, Dahlia) opens with a version containing breaking changes. Monthly upgrades within a major are safe without code changes.

**Backward-compatible** (no code updates): new resources, new optional params, new response properties, longer opaque IDs, new webhook event types.

**Breaking** (code updates): field renames/removals, behavior changes, removed endpoints or params. Example: `2026-03-25.dahlia` renamed Checkout `ui_mode` values (`hosted` → `hosted_page`, `embedded` → `embedded_page`, `custom` → `elements`).

Review the [API changelog](https://docs.stripe.com/changelog.md) and [API upgrades guide](https://docs.stripe.com/upgrades.md).

## Server-Side SDK Versioning

See [Set a Stripe API version](https://docs.stripe.com/sdks/set-version.md).

### Dynamically-Typed Languages (Ruby, Python, PHP, Node.js)

Unpinned, current majors send the API version that was latest when the SDK release shipped (older majors used the account default). Pin explicitly anyway:

```javascript
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-08-26.dahlia',
});
// per request
await stripe.paymentIntents.retrieve('pi_xxx', { apiVersion: '2026-08-26.dahlia' });
```

```python
from stripe import StripeClient
client = StripeClient(api_key, stripe_version="2026-08-26.dahlia")
```

```ruby
client = Stripe::StripeClient.new(api_key, stripe_version: '2026-08-26.dahlia')
```

```php
$stripe = new \Stripe\StripeClient(['api_key' => $key, 'stripe_version' => '2026-08-26.dahlia']);
```

### Strongly-Typed Languages (Java, Go, .NET)

The API version is fixed to the SDK release. Don't override it (responses may not match the types); upgrade to an SDK release that targets the new version. Preview versions need the matching `beta` SDK release in every language ([SDK versioning](https://docs.stripe.com/sdks/versioning.md)).

## Stripe.js Versioning

See [Stripe.js versioning](https://docs.stripe.com/sdks/stripejs-versioning.md). Stripe.js is evergreen with biannual majors (Acacia, Basil, Clover, Dahlia).

```html
<script src="https://js.stripe.com/dahlia/stripe.js"></script>
```

npm: each `@stripe/stripe-js` major pins one Stripe.js version (v9 = dahlia, v8 = clover). Versioned Stripe.js uses its own release train's API version and you can't override it; keep the server on the same train. `js.stripe.com/v3` stays supported but is no longer recommended.

Dahlia Stripe.js breaking renames: `initCheckout` → `initCheckoutElementsSdk`, `initEmbeddedCheckout` → `createEmbeddedCheckoutPage`, React `CheckoutProvider` → `CheckoutElementsProvider`; removed `handleCardPayment`, `confirmPaymentIntent`, `handleCardSetup`, `confirmSetupIntent`, `createSource`, `retrieveSource`.

Migrating from v3: identify the current API version, review the changelog, optionally move the API version up gradually, then switch Stripe.js.

## Mobile SDK Versioning

See [Mobile SDK versioning](https://docs.stripe.com/sdks/mobile-sdk-versioning.md). iOS and Android use semver; fixes land only on the latest major. React Native uses `0.x.y` (minor = breaking + features, patch = critical fixes). Mobile SDKs work with any backend API version unless documented otherwise.

## Upgrade Checklist

1. Review the changelog between current and target versions
2. Check the upgrades guide for migration notes
3. Update the SDK package (`npm update stripe`, `pip install --upgrade stripe`; Go: bump the `/vNN` import path)
4. Update the pinned `apiVersion` / `stripe_version`
5. Test with the `Stripe-Version` header before switching defaults
6. Webhooks: for each snapshot-event destination, check its API version ([webhook versioning](https://docs.stripe.com/webhooks/versioning.md)). A v2 event destination's `snapshot_api_version` can't be changed after creation: create and test a replacement, accept both signing secrets during cutover, then disable the old one. Thin-event destinations are unversioned and need no change.
7. Update Stripe.js script tag or npm major
8. Update mobile SDKs
9. Store Stripe object IDs in columns that fit up to 255 characters (case-sensitive collation)

## Testing API Version Changes

```bash
curl https://api.stripe.com/v1/customers \
  -u "$STRIPE_TEST_KEY:" \
  -H "Stripe-Version: 2026-08-26.dahlia"
```

## Important Notes

- Moving supported event types from snapshot to [thin events](https://docs.stripe.com/webhooks/migrate-snapshot-to-thin-events.md) removes webhook payload versioning; API calls that fetch the full event or object stay versioned. Thin events for v1 resources are in private preview.
- Webhook handlers must ignore unfamiliar event types gracefully.
- Multiple API versions coexist, enabling staged adoption.
- For 72 hours after upgrading the account default, you can roll back in [Workbench](https://dashboard.stripe.com/workbench/overview).
