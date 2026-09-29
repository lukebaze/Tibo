# Stripe SDKs Reference

Server-side SDKs for secure Stripe API integration.

## Supported Languages

Versions verified against GitHub releases on 2026-09-26; always check the registry before pinning (`npm view stripe version`, PyPI, etc.).

| Language | Package | Install | Latest (2026-09) |
|----------|---------|---------|------------------|
| Node.js (18+) | `stripe` | `npm install stripe` | 22.6.x |
| Python (3.9+) | `stripe` | `pip install stripe` | 15.6.x |
| Ruby | `stripe` | `gem install stripe` | 19.6.x |
| Go | `github.com/stripe/stripe-go/v86` | `go get -u github.com/stripe/stripe-go/v86` | 86.4.x |
| PHP | `stripe/stripe-php` | `composer require stripe/stripe-php` | 21.3.x |
| Java | `com.stripe:stripe-java` | Maven/Gradle | 33.4.x |
| .NET | `Stripe.net` | `dotnet add package Stripe.net` | 52.4.x |

The Go module path carries the major version (`/v86`); update every import when bumping majors.

## Quick Start (Node.js)

```javascript
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); // prefer an rk_ restricted key

const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [{ price: 'price_xxx', quantity: 1 }],
  success_url: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'https://example.com/cancel',
});
```

## Quick Start (Python)

```python
import os
from stripe import StripeClient

client = StripeClient(os.environ["STRIPE_SECRET_KEY"])

session = client.v1.checkout.sessions.create(params={
    "mode": "payment",
    "line_items": [{"price": "price_xxx", "quantity": 1}],
    "success_url": "https://example.com/success?session_id={CHECKOUT_SESSION_ID}",
    "cancel_url": "https://example.com/cancel",
})
```

## Quick Start (Go)

```go
import (
  "context"
  "github.com/stripe/stripe-go/v86"
)

sc := stripe.NewClient(apiKey)
c, err := sc.V1Customers.Create(context.TODO(), &stripe.CustomerCreateParams{})
```

Use the client-instance pattern in every language. The global key pattern (`stripe.api_key = …`, `Stripe.setApiKey`, `stripe.Key = …`) is deprecated.

## API Versioning

- Unpinned, current SDKs send the API version that was latest when that SDK release shipped (Node v12+, Python v6+, Ruby v9+, PHP v11+). Older majors fall back to the account default.
- Node/Python/Ruby/PHP: pin explicitly, e.g. `new Stripe(key, { apiVersion: '2026-08-26.dahlia' })`; per-request overrides are supported.
- Java/Go/.NET: the version is fixed by the SDK release; upgrade the SDK instead of overriding it.
- Breaking API changes ship as a new SDK major. See `stripe-upgrade.md` and [set-version](https://docs.stripe.com/sdks/set-version.md).

## Best Practices

1. **Keep SDKs updated** - security patches, new features
2. **Use sandbox keys** for development; never commit keys (use a secrets vault)
3. **Pin the API version** you tested against
4. **Handle errors** by type (below)
5. **Use idempotency keys** on POST requests (V4 UUID, up to 255 chars, pruned after 24h+; never PII)

## Error Handling (Node.js)

```javascript
try {
  const session = await stripe.checkout.sessions.create(params, {
    idempotencyKey: orderId,
  });
} catch (err) {
  switch (err.type) {
    case 'StripeCardError':            // payment declined/blocked (any payment method)
      break;
    case 'StripeInvalidRequestError':  // bad params or state
      break;
    case 'StripeRateLimitError':       // back off and retry
    case 'StripeConnectionError':      // network; safe to retry with same idempotency key
    case 'StripeAPIError':             // Stripe-side problem
      break;
    default:
      if (err instanceof stripe.errors.StripeError) {
        console.error(err.statusCode, err.code, err.requestId);
      } else {
        throw err;
      }
  }
}
```

Other `err.type` values: `StripeAuthenticationError`, `StripePermissionError` (restricted key lacks a permission), `StripeIdempotencyError`, `StripeSignatureVerificationError` (webhooks). Go uses `err.(*stripe.Error)` with `stripe.ErrorTypeCard`, `stripe.ErrorTypeInvalidRequest`, etc. Docs: https://docs.stripe.com/error-handling.md

## Mobile SDKs

- **iOS**: `stripe-ios` (Swift/ObjC)
- **Android**: `stripe-android` (Kotlin/Java)
- **React Native**: `@stripe/stripe-react-native`

Never ship secret or restricted keys in mobile apps; create objects on your server.

## Resources

- Full docs: https://docs.stripe.com/sdks
- API Reference: https://docs.stripe.com/api
- Community SDKs: https://docs.stripe.com/sdks#community-sdks
