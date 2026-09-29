# PayPal SDKs

Official server SDKs, browser SDK packages, and migration off the deprecated Node SDKs. Versions and repo activity checked 2026-09-26 on npm, PyPI and GitHub (`paypal/*-Server-SDK` repos, last pushed 2026-08-21). Code facts come from `@paypal/paypal-server-sdk` 2.5.0 source (`src/`) and README.

## Which Package

| Need | Package (checked 2026-09-26) | Status |
|------|------------------------------|--------|
| Node/TypeScript server | `@paypal/paypal-server-sdk` 2.5.0 | Current, APIMatic-generated, Node ≥ 14.17 |
| Python server | `paypal-server-sdk` 2.4.0 (PyPI) | Current |
| Java / .NET / PHP / Ruby server | `paypal/PayPal-{Java,Dotnet,PHP,Ruby}-Server-SDK` | Current (see each repo for package name) |
| Browser (JS SDK v6 loader) | `@paypal/paypal-js` 11.1.1 (`@paypal/paypal-js/sdk-v6`) | Current |
| React | `@paypal/react-paypal-js` 10.5.1 | Current |
| Node server (legacy) | `@paypal/checkout-server-sdk` 1.0.3 | **Deprecated** on npm → use `@paypal/paypal-server-sdk` |
| Node server (legacy v1) | `paypal-rest-sdk` 1.8.1 | **Deprecated** (Payments v1 era) |

## Coverage of the Server SDK

The README says it "contains only 5 of PayPal's API endpoints" (API families):

| Controller | Methods |
|------------|---------|
| `OrdersController` | `createOrder`, `getOrder`, `patchOrder`, `confirmOrder`, `authorizeOrder`, `captureOrder`, `createOrderTracking`, `updateOrderTracking` |
| `PaymentsController` | `getAuthorizedPayment`, `captureAuthorizedPayment`, `reauthorizePayment`, `voidPayment`, `getCapturedPayment`, `refundCapturedPayment`, `getRefund` |
| `SubscriptionsController` | `createBillingPlan`, `listBillingPlans`, `getBillingPlan`, `patchBillingPlan`, `activateBillingPlan`, `deactivateBillingPlan`, `updateBillingPlanPricingSchemes`, `createSubscription`, `listSubscriptions`, `getSubscription`, `patchSubscription`, `reviseSubscription`, `suspendSubscription`, `cancelSubscription`, `activateSubscription`, `captureSubscription`, `listSubscriptionTransactions` |
| `VaultController` (US only) | `createPaymentToken`, `listCustomerPaymentTokens`, `getPaymentToken`, `deletePaymentToken`, `createSetupToken`, `getSetupToken` |
| `TransactionSearchController` | `searchTransactions`, `searchBalances` |

**Not covered:** Catalog Products (`/v1/catalogs/products`, needed before creating a plan), Webhooks v1 (management and `verify-webhook-signature`), Disputes, Invoicing, Payouts. Call those with plain HTTPS plus an OAuth token (see `overview.md`), and verify webhooks with `scripts/paypal-webhook-verify.js` (see `webhooks.md`).

## Install and Initialize

```bash
npm install @paypal/paypal-server-sdk
```

```typescript
import { Client, Environment, LogLevel } from '@paypal/paypal-server-sdk';

export const paypal = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: process.env.PAYPAL_CLIENT_ID!,
    oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET!,
  },
  environment: process.env.PAYPAL_ENV === 'live' ? Environment.Production : Environment.Sandbox,
  timeout: 15_000,                       // ms; SDK default 0 = no timeout
  logging: { logLevel: LogLevel.Warn },  // never logBody in production
});
```

- `Environment.Sandbox` is the **default**; production must be set explicitly. Base URIs in source: `https://api-m.sandbox.paypal.com` / `https://api-m.paypal.com`.
- The client fetches and refreshes the OAuth token itself. Create one client per process and reuse it.
- The README's logging example sets `logRequest: { logBody: true }`; bodies contain payer names, emails and addresses, so keep bodies out of production logs.
- `Client.fromEnvironment(process.env)` reads **`O_AUTH_CLIENT_ID`**, **`O_AUTH_CLIENT_SECRET`**, `ENVIRONMENT`, `TIMEOUT`, `MAX_NUMBER_OF_RETRIES`, etc. (not `PAYPAL_*` names). Map your variables explicitly as above, or name them to match. `Client.fromJsonConfig(json)` is the file-based variant.

Controllers wrap the client: `new OrdersController(paypal)`, `new PaymentsController(paypal)`, `new SubscriptionsController(paypal)`. Order and capture code: `orders-and-checkout.md`.

## Conventions

- **Request objects are camelCase** and map to the REST snake_case fields: `purchaseUnits`, `paymentSource.paypal.experienceContext`, `userAction`, `vaultId`, `customId`, `invoiceId`. Enums are exported: `CheckoutPaymentIntent.Capture`, `PaypalExperienceUserAction.PayNow`, `StoreInVaultInstruction.OnSuccess`, `PaypalPaymentTokenUsageType.Merchant`.
- **Headers are parameters:** `paypalRequestId` (idempotency; the SDK does **not** generate one), `prefer` (`return=minimal` / `return=representation`), `paypalMockResponse` (sandbox error simulation), `paypalAuthAssertion`, `paypalPartnerAttributionId`, `paypalClientMetadataId` (per operation; check the method signature).
- **Responses:** each call returns an `ApiResponse` with `result` (typed body), `statusCode` and `headers`.

```typescript
import { ApiError, PaymentsController } from '@paypal/paypal-server-sdk';

try {
  const { result } = await new PaymentsController(paypal).getCapturedPayment({ captureId });
  return result.status; // 'COMPLETED' | 'PENDING' | ...
} catch (err) {
  if (err instanceof ApiError) {
    const body = err.result as { name?: string; debug_id?: string; details?: { issue?: string }[] };
    console.error('paypal error', err.statusCode, body?.name, body?.details?.[0]?.issue, body?.debug_id);
  }
  throw err;
}
```

Typed subclasses (`CustomError`, `DefaultError`, `SubscriptionError`, `SearchError`, `OAuthProviderError`) all extend `ApiError`; `CustomError.result` follows the REST error schema (`name`, `message`, `debug_id`, `details[]`, `links[]`). Branch on `details[].issue`, log `debug_id`.

## Retries

Source defaults (`DEFAULT_RETRY_CONFIG`): `maxNumberOfRetries: 0` (off), `retryOnTimeout: true`, `retryInterval: 1`, `backoffFactor: 2`, `maximumRetryWaitTime: 0`, statuses `408, 413, 429, 500, 502, 503, 504, 521, 522, 524`, methods **`GET` and `PUT` only**.

```typescript
new Client({
  // ...credentials, environment
  httpClientOptions: { retryConfig: { maxNumberOfRetries: 2 } },
});
```

POSTs (create order, capture, refund) are never retried by the SDK even when retries are on. Retry them yourself with the **same** `paypalRequestId`, so PayPal returns the original result instead of charging twice.

## Migrating from Deprecated Node SDKs

`@paypal/checkout-server-sdk` (request-class style) → `@paypal/paypal-server-sdk` (controller style):

| Old (`checkout-server-sdk`) | New (`paypal-server-sdk`) |
|-----------------------------|---------------------------|
| `new core.SandboxEnvironment(id, secret)` + `new core.PayPalHttpClient(env)` | `new Client({ clientCredentialsAuthCredentials, environment })` |
| `new orders.OrdersCreateRequest()`; `request.requestBody({ intent, purchase_units })`; `client.execute(request)` | `ordersController.createOrder({ body: { intent, purchaseUnits }, paypalRequestId })` |
| `new orders.OrdersCaptureRequest(id)` | `ordersController.captureOrder({ id, paypalRequestId })` |
| `new payments.CapturesRefundRequest(captureId)` | `paymentsController.refundCapturedPayment({ captureId, body, paypalRequestId })` |
| `request.prefer('return=representation')` / `PayPal-Request-Id` set in `request.headers` | `prefer` / `paypalRequestId` parameters |
| `response.result` (snake_case JSON) | `response.result` (camelCase typed model) |

Checklist:
1. Replace snake_case request bodies with camelCase models; response field names change the same way (`purchase_units` → `purchaseUnits`), so update every reader.
2. Add `paypalRequestId` to every create/capture/refund call.
3. Add your own HTTP calls for anything outside the five controllers (catalog products, webhook management).
4. `paypal-rest-sdk` users are also on Payments v1 (`/v1/payments/payment`) and v1 billing agreements; that is an API migration to Orders v2 and Subscriptions v1, not just an SDK swap.
5. Test the full flow in sandbox, including webhook handling, before switching environments.

## Browser Packages

- `@paypal/paypal-js` 11.1.1: `import { loadCoreSdkScript } from '@paypal/paypal-js/sdk-v6'`, with `environment: 'sandbox' | 'production'` required. Use the `sdk-v6` subpath for new work (v5 is deprecated).
- `@paypal/react-paypal-js` 10.5.1: React bindings.
- Or include the script tag directly (`https://www.paypal.com/web-sdk/v6/core`; sandbox `https://www.sandbox.paypal.com/web-sdk/v6/core`).

Usage: `orders-and-checkout.md` (JS SDK v6 section).

## Official Samples

- Server SDK (Express): https://github.com/paypaldev/example-node-express (check its dependency versions before copying)
- JS SDK v6: https://github.com/paypal-examples/v6-web-sdk-sample-integration
- Server SDK source/docs: https://github.com/paypal/PayPal-TypeScript-Server-SDK (`doc/controllers/*.md`), index repo https://github.com/paypal/PayPal-Server-SDKs
