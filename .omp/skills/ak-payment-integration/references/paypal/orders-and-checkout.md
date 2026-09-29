# PayPal Orders and Checkout

Orders v2 (create, approve, capture/authorize), Payments v2 (capture, void, refund), JS SDK v6 buttons and Card Fields, and vaulting. Verified 2026-09-26 against the OpenAPI specs `checkout_orders_v2.json` (v2.32) and `payments_payment_v2.json` (v2.12), https://developer.paypal.com/checkout, https://developer.paypal.com/sdk/js/reference, https://developer.paypal.com/guides/node-express and `@paypal/paypal-server-sdk` 2.5.0 source.

## Flow (server-owned amounts)

1. Buyer clicks the PayPal button → browser calls **your** `POST /api/orders` with an item/cart ID (never an amount)
2. Server looks up the price, calls `POST /v2/checkout/orders`, returns `{ orderId }`
3. Buyer approves in the PayPal popup/modal/redirect → SDK calls `onApprove({ orderId, payerId })`
4. Browser calls your `POST /api/orders/:orderId/capture` → server calls `POST /v2/checkout/orders/{id}/capture`
5. Server checks the **capture** status and amount, then fulfils; `PAYMENT.CAPTURE.COMPLETED` webhook is the backstop (see `webhooks.md`)

Approval alone moves no money. If the buyer closes the popup, the order stays uncaptured.

## Endpoints

| Call | Endpoint | Notes |
|------|----------|-------|
| Create order | `POST /v2/checkout/orders` | `intent` (`CAPTURE`/`AUTHORIZE`) + `purchase_units[]` required |
| Show order | `GET /v2/checkout/orders/{id}` | |
| Update order | `PATCH /v2/checkout/orders/{id}` | JSON Patch; before capture only |
| Confirm payment source | `POST /v2/checkout/orders/{id}/confirm-payment-source` | |
| Authorize order | `POST /v2/checkout/orders/{id}/authorize` | `intent: AUTHORIZE` orders |
| Capture order | `POST /v2/checkout/orders/{id}/capture` | `intent: CAPTURE` orders |
| Capture authorization | `POST /v2/payments/authorizations/{id}/capture` | partial allowed, `final_capture` |
| Reauthorize / void | `POST /v2/payments/authorizations/{id}/reauthorize` / `.../void` | |
| Show capture | `GET /v2/payments/captures/{id}` | |
| Refund capture | `POST /v2/payments/captures/{id}/refund` | empty body = full refund |
| Show refund | `GET /v2/payments/refunds/{id}` | |

Order `status`: `CREATED`, `SAVED`, `APPROVED`, `VOIDED`, `COMPLETED`, `PAYER_ACTION_REQUIRED`.
Capture `status`: `COMPLETED`, `DECLINED`, `PARTIALLY_REFUNDED`, `PENDING`, `REFUNDED`, `FAILED`.
Refund `status`: `CANCELLED`, `FAILED`, `PENDING`, `COMPLETED`.
Add `Prefer: return=representation` for the full resource (default is `return=minimal`: `id`, `status`, links).

## Create and Capture (server SDK)

```typescript
import { randomUUID } from 'crypto';
import {
  ApiError, CheckoutPaymentIntent, Client, Environment, OrdersController, PaypalExperienceUserAction,
} from '@paypal/paypal-server-sdk';

const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: process.env.PAYPAL_CLIENT_ID!,
    oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET!,
  },
  environment: process.env.PAYPAL_ENV === 'live' ? Environment.Production : Environment.Sandbox,
});
const orders = new OrdersController(client);

export async function createOrder(localOrder: { id: string; total: string; currency: string }) {
  const { result } = await orders.createOrder({
    paypalRequestId: `${localOrder.id}:create`,        // stable per action → safe retries
    prefer: 'return=minimal',
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [{
        referenceId: localOrder.id,
        customId: localOrder.id,                        // echoed on captures and in webhooks
        invoiceId: localOrder.id,                       // must be unique if the account enforces it
        amount: { currencyCode: localOrder.currency, value: localOrder.total }, // e.g. "19.99"
      }],
      paymentSource: {
        paypal: { experienceContext: { userAction: PaypalExperienceUserAction.PayNow } },
      },
    },
  });
  return result.id; // store against localOrder.id
}

export async function captureOrder(orderId: string, localOrderId: string) {
  try {
    const { result } = await orders.captureOrder({
      id: orderId,
      paypalRequestId: `${localOrderId}:capture`,
      prefer: 'return=representation',
    });
    const capture = result.purchaseUnits?.[0]?.payments?.captures?.[0];
    return { orderStatus: result.status, captureId: capture?.id, captureStatus: capture?.status, amount: capture?.amount };
  } catch (err) {
    if (err instanceof ApiError) {
      // err.statusCode, err.result (name, debug_id, details[].issue); log debug_id only
    }
    throw err;
  }
}
```

After capture:
- `captureStatus === 'COMPLETED'` and `amount` equals your stored total/currency → fulfil once (idempotent on your order ID)
- `PENDING` (e.g. eCheck, unaccepted currency, review; see `status_details.reason`) → mark pending, fulfil on `PAYMENT.CAPTURE.COMPLETED`
- `DECLINED`/`FAILED` → do not fulfil
- `422` with `details[0].issue === 'INSTRUMENT_DECLINED'` → let the buyer choose another funding source (restart the session); `ORDER_ALREADY_CAPTURED` on a retry → fetch the order and reconcile
- A `5xx`/timeout → retry once with the same `paypalRequestId`, then reconcile via `GET /v2/checkout/orders/{id}`

Store `captureId`: refunds and most webhooks reference the capture, not the order. `supplementary_data.related_ids.order_id` on the capture links back to the order.

## Create Order (REST)

```bash
curl -X POST https://api-m.sandbox.paypal.com/v2/checkout/orders \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "PayPal-Request-Id: order_123:create" \
  -d '{
    "intent": "CAPTURE",
    "purchase_units": [{
      "reference_id": "order_123",
      "custom_id": "order_123",
      "amount": { "currency_code": "USD", "value": "19.99" }
    }],
    "payment_source": { "paypal": { "experience_context": {
      "user_action": "PAY_NOW",
      "shipping_preference": "NO_SHIPPING",
      "return_url": "https://example.com/paypal/return",
      "cancel_url": "https://example.com/paypal/cancel"
    } } }
  }'
```

- `return_url`/`cancel_url` are needed for redirect flows (SDK `presentationMode: "redirect"` or following the `payer-action` link yourself).
- Field limits (OpenAPI): `description` truncated after 127 chars, `soft_descriptor` after 22, `custom_id`/`invoice_id` max 127.
- Use `amount.breakdown` (`item_total`, `tax_total`, `shipping`, `discount`) when sending `items`; totals must add up exactly.

## Authorize Now, Capture Later

- Create with `intent: AUTHORIZE`, then `POST /v2/checkout/orders/{id}/authorize` after approval → `purchase_units[0].payments.authorizations[0].id`
- Capture with `POST /v2/payments/authorizations/{id}/capture` (optional `amount` for partial, `final_capture: true` on the last one, `invoice_id`)
- Funds are held up to **29 days**; capture success is highest within the **3-day honor period**; reauthorize on days 4-29; void (`/void`) if you can't fulfil
- Sandbox authorizations don't expire; use negative testing

Source: https://developer.paypal.com/checkout/delay-capture

## Refunds (Payments v2)

```typescript
import { PaymentsController } from '@paypal/paypal-server-sdk';
const payments = new PaymentsController(client);

// Insert the refund row (amount, status 'pending') first; reuse its id when retrying
await payments.refundCapturedPayment({
  captureId,                                   // from the capture, not the order ID
  paypalRequestId: `refund:${refundRow.id}`,   // one key per logical refund; reuse it on retries
  prefer: 'return=representation',
  body: { amount: { currencyCode: 'USD', value: '5.00' }, noteToPayer: 'Partial refund' }, // omit body for a full refund
});
```

- Response status `COMPLETED` or `PENDING` (→ `PAYMENT.REFUND.PENDING`, later `PAYMENT.CAPTURE.REFUNDED` or `PAYMENT.REFUND.FAILED`)
- Multiple partial refunds are allowed up to the captured amount; the capture then shows `PARTIALLY_REFUNDED`/`REFUNDED`
- Whether PayPal returns its fee on refund is country/policy dependent; recheck the fee page

## JS SDK v6 (client)

Load the core script once (sandbox shown; live is `https://www.paypal.com/web-sdk/v6/core`):

```html
<script async src="https://www.sandbox.paypal.com/web-sdk/v6/core" onload="onPayPalLoaded()"></script>
<paypal-button id="paypal-button" hidden></paypal-button>
<script>
  async function onPayPalLoaded() {
    const sdk = await window.paypal.createInstance({
      clientId: PAYPAL_CLIENT_ID,               // public; served by your /api/config
      components: ['paypal-payments'],          // venmo-payments, googlepay-payments, applepay-payments, fastlane, paypal-messages, card-fields
      pageType: 'checkout',
    });
    const methods = await sdk.findEligibleMethods({ currencyCode: 'USD' });
    if (!methods.isEligible('paypal')) return;

    const session = sdk.createPayPalOneTimePaymentSession({
      onApprove: async ({ orderId }) => {
        const res = await fetch(`/api/orders/${orderId}/capture`, { method: 'POST' });
        const data = await res.json();          // show result; server already verified it
      },
      onCancel: () => { /* re-enable UI; order stays uncaptured */ },
      onError: (err) => { console.error(err.code); },
    });

    const button = document.getElementById('paypal-button');
    button.addEventListener('click', () =>
      session.start({ presentationMode: 'auto' }, createOrder()), // must resolve to { orderId }
    );
    button.removeAttribute('hidden');
  }

  async function createOrder() {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: 'pro-plan' }),
    });
    return res.json();                          // { orderId }
  }
</script>
```

- `presentationMode`: `auto` (default; popup, falls back to modal), `popup`, `modal` (WebViews only), `redirect` (mobile; needs return/cancel URLs), `payment-handler` (experimental)
- Other sessions: `createVenmoOneTimePaymentSession`, `createPayLaterOneTimePaymentSession`, `createPayPalCreditOneTimePaymentSession`, `createGooglePayOneTimePaymentSession`, `createApplePayOneTimePaymentSession`, `createPayPalSavePaymentSession`, `createPayPalSubscriptionSession`
- `onError` codes include `ERR_DEV_UNABLE_TO_OPEN_POPUP` (fall back to redirect), `INSTRUMENT_DECLINED`, `ERR_INVALID_CLIENT_TOKEN`, `ERR_DOMAIN_MISMATCH`
- Auth: docs recommend `clientId` for most integrations and a server-minted **client token** (`/v1/oauth2/token` with `response_type=client_token` and `domains[]`) for Fastlane. The Card Fields page and the `createInstance` parameter table still show `clientToken`; if card fields fail with `clientId`, switch to a client token.
- npm loader: `import { loadCoreSdkScript } from '@paypal/paypal-js/sdk-v6'` (`environment: 'sandbox' | 'production'` is required and selects the script, not the client ID). React: `@paypal/react-paypal-js` 10.x wraps v6. Versions checked 2026-09-26: `@paypal/paypal-js` 11.1.1, `@paypal/react-paypal-js` 10.5.1.
- v5 (`https://www.paypal.com/sdk/js?client-id=...`, `paypal.Buttons().render()`) is marked deprecated; migrate with https://developer.paypal.com/v5-v6

Sources: https://developer.paypal.com/sdk/js/set-up, https://developer.paypal.com/sdk/js/reference, https://www.npmjs.com/package/@paypal/paypal-js

## Card Fields (Expanded Checkout)

PayPal-hosted iframes for number/expiry/CVV (PCI SAQ A-EP considerations still apply to your page), with 3D Secure handled by `submit`.

```javascript
const sdk = await window.paypal.createInstance({ clientToken, components: ['card-fields'] });
const methods = await sdk.findEligibleMethods();
if (methods.isEligible('advanced_cards')) {
  const cardSession = sdk.createCardFieldsOneTimePaymentSession();
  for (const type of ['number', 'expiry', 'cvv']) {
    document.querySelector(`#card-${type}`).appendChild(cardSession.createCardFieldsComponent({ type }));
  }
  payButton.onclick = async () => {
    const { orderId } = await createOrder();
    const { state, data } = await cardSession.submit(orderId, { billingAddress: { postalCode: '95131' } });
    if (state === 'succeeded') await fetch(`/api/orders/${data.orderId}/capture`, { method: 'POST' });
    // 'canceled' (3DS dismissed) / 'failed' (validation or processing): allow retry
  };
}
```

- Use `data.liabilityShift` to decide whether to capture after 3DS
- Available in 37 countries / 22 currencies (not Vietnam); check https://developer.paypal.com/expanded/eligibility
- Fees differ from PayPal wallet payments (see `overview.md`)

Source: https://developer.paypal.com/expanded/card-fields

## Vaulting (save payment methods)

**Save during purchase (PayPal wallet):** add a vault instruction to the order, then read the token from the capture response.

```json
"payment_source": { "paypal": {
  "attributes": { "vault": { "store_in_vault": "ON_SUCCESS", "usage_type": "MERCHANT" } },
  "experience_context": { "return_url": "https://example.com/return", "cancel_url": "https://example.com/cancel" }
} }
```

- Response: `payment_source.paypal.attributes.vault.id` (payment token) and `...vault.customer.id`; store both against your user
- Later charge (buyer not present): create order with `payment_source.paypal.vault_id` and a **mandatory** `PayPal-Request-Id`
- **Save without purchase:** `POST /v3/vault/setup-tokens` → buyer approves → `POST /v3/vault/payment-tokens`; client side uses `createPayPalSavePaymentSession` (`onApprove` gets a `billingToken`)
- Manage: `GET /v3/vault/payment-tokens?customer_id=`, `DELETE /v3/vault/payment-tokens/{id}`; events `VAULT.PAYMENT-TOKEN.CREATED|DELETED|DELETION-INITIATED`
- PayPal requires Risk Data Acquisition (FraudNet/Magnes) for customer-initiated payments with PayPal/Venmo tokens, or they are likely declined
- Server SDK `VaultController` is documented as US-only

Sources: https://developer.paypal.com/api/save-with-purchase/save-payment-methods, OpenAPI `vault_payment_tokens_v3.json`

## Checklist

- Price from your DB; compare captured `amount` to the stored order before fulfilling
- One `PayPal-Request-Id` per action, derived from your order ID
- Persist PayPal order ID, capture ID, status; treat `PENDING` as not paid
- Webhook `PAYMENT.CAPTURE.COMPLETED` fulfils orders whose browser callback never returned
- Handle `CHECKOUT.PAYMENT-APPROVAL.REVERSED` (approved but not capturable) by cancelling the local order
