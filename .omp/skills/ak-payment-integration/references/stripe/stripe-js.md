# Stripe.js Reference

Client-side JavaScript library for secure payment collection. Current release train: **Dahlia** (verified 2026-09-26).

## Installation

Load Stripe.js from `js.stripe.com` (never bundle or self-host it). Include it on every page of the shopping flow, not only checkout, so Stripe's fraud detection sees more signals.

```html
<script src="https://js.stripe.com/dahlia/stripe.js"></script>
```

Or via npm (each `@stripe/stripe-js` major loads one fixed Stripe.js version: v9 = `dahlia`, v8 = `clover`, v7 = `basil`, v6 = `acacia`):

```bash
npm install @stripe/stripe-js
```

```javascript
import { loadStripe } from '@stripe/stripe-js';
const stripe = await loadStripe('pk_test_...');
```

`js.stripe.com/v3/` is still supported (evergreen) but no longer recommended for new integrations.

## Initialization

```javascript
const stripe = Stripe('pk_test_...', {
  locale: 'auto',             // optional, default 'auto'
  stripeAccount: 'acct_xxx',  // Connect only
});
```

- Create one Stripe instance per key/options and reuse it.
- `apiVersion` is only accepted on Stripe.js v3. Versioned Stripe.js (acacia, basil, clover, dahlia) pins its own API version, and you can't override it. Keep the server API version on the same release train (for example `dahlia` Stripe.js with `2026-0x-xx.dahlia` on the server).

## Checkout Sessions + Elements (recommended custom UI)

Server: create the session with `ui_mode: 'elements'` (named `custom` before `2026-03-25.dahlia`) and a `return_url`, then return `session.client_secret`.

```javascript
const checkout = stripe.initCheckoutElementsSdk({
  clientSecret,                      // string or Promise<string>
  elementsOptions: { appearance: { theme: 'stripe' } },
});
checkout.createPaymentElement().mount('#payment-element');

const { type, actions } = await checkout.loadActions();
if (type === 'success') {
  const result = await actions.confirm();
  if (result.type === 'error') showError(result.error.message);
}
```

- `initCheckoutElementsSdk` replaced `initCheckout` in Dahlia; calling the old name throws `IntegrationError`. React: `CheckoutElementsProvider` from `@stripe/react-stripe-js/checkout` (was `CheckoutProvider`).
- Other session-bound elements: `checkout.createContactDetailsElement()`, `createBillingAddressElement()`, `createShippingAddressElement()`, `createCurrencySelectorElement()`.
- Checkout form (`ui_mode: 'form'`) uses `stripe.initCheckoutFormSdk()` (beta access per stripe-js types).

## Embedded Checkout (prebuilt page in your site)

Server: `ui_mode: 'embedded_page'` (was `embedded`) plus `return_url`.

```javascript
const checkout = await stripe.createEmbeddedCheckoutPage({ fetchClientSecret });
checkout.mount('#checkout');
```

`createEmbeddedCheckoutPage` replaced `initEmbeddedCheckout` in Dahlia (same options and return type). On clover or older Stripe.js, keep the old name.

## Payment Element with PaymentIntents (when not using Checkout Sessions)

```javascript
const elements = stripe.elements({ clientSecret: 'pi_xxx_secret_xxx', appearance });
elements.create('payment').mount('#payment-element');

const { error } = await stripe.confirmPayment({
  elements,
  confirmParams: { return_url: 'https://example.com/complete' },
});
if (error) { /* show error.message to the customer */ }
```

To inspect payment details before creating an intent, use Confirmation Tokens, not `createPaymentMethod`/`createToken`. Dahlia removed `handleCardPayment`, `confirmPaymentIntent`, `handleCardSetup`, `confirmSetupIntent`, `createSource`, `retrieveSource`.

## Element Types

| Element | Use Case |
|---------|----------|
| `payment` | Full payment form (recommended) |
| `expressCheckout` | Apple Pay, Google Pay, Link buttons (replaces `paymentRequestButton`) |
| `address` | Shipping/billing address |
| `contactDetails` | Email + Link authentication (renamed from `linkAuthentication`, which still works) |
| `paymentMethodMessaging` | BNPL messaging |
| `card`, `cardNumber`/`cardExpiry`/`cardCvc` | **Legacy**. Don't use for new work; migrate to `payment` |

## Appearance API

```javascript
const appearance = {
  theme: 'stripe', // 'stripe' | 'night' | 'flat'
  variables: { colorPrimary: '#0570de', colorBackground: '#ffffff', borderRadius: '4px' },
  rules: { '.Input': { border: '1px solid #ccc' } },
};
```

Dahlia: `elements.update()` returns a Promise; `layout.radios` no longer accepts booleans.

## Security

- Load only from `https://js.stripe.com`; only publishable keys (`pk_`) client-side
- Add CSP allowing `https://*.stripe.com` in `script-src`, `frame-src`, `connect-src`
- Never log card details; use HTTPS in production
- A client redirect or `confirm()` result never proves payment. Fulfill from verified webhooks

## Resources

- Full docs: https://docs.stripe.com/js
- Versioning: https://docs.stripe.com/sdks/stripejs-versioning
- Checkout Sessions + Elements quickstart: https://docs.stripe.com/payments/quickstart-checkout-sessions
- Appearance: https://docs.stripe.com/elements/appearance-api
