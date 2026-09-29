# SePay SDK Integration

Official Payment Gateway SDKs (Node.js, PHP) and the Laravel webhook package.
Verified against developer.sepay.vn, npm, Packagist and github.com/sepayvn on 2026-09-26.

| Package | Registry | Version | Scope |
|---------|----------|---------|-------|
| `sepay-pg-node` | npm | 1.0.0 | Gateway checkout + order API |
| `sepay/sepay-pg` | Packagist (repo `sepayvn/sepay-pg-php`) | 1.0.0 | Gateway checkout + order API |
| `sepayvn/laravel-sepay` | Packagist | v1.2.2 | Bank-transfer webhook receiver |

No official SDK exists for the SePay API v2 or webhook verification outside Laravel; call REST directly.

## Checkout Form and Signature (no SDK)

POST an HTML form to `https://pay.sepay.vn/v1/checkout/init` (sandbox `https://pay-sandbox.sepay.vn/v1/checkout/init`).

| Field | Required | Notes |
|-------|----------|-------|
| `merchant` | yes | Merchant ID (field name is `merchant`, not `merchant_id`) |
| `currency` | yes | `VND` only |
| `order_amount` | yes | Integer VND, > 0 for `PURCHASE` |
| `operation` | yes | `PURCHASE` |
| `order_description` | yes | Description |
| `order_invoice_number` | yes | Unique per order |
| `payment_method` | no | `CARD`, `BANK_TRANSFER`, `NAPAS_BANK_TRANSFER`; omitted → single enabled method or a picker |
| `customer_id` | no | Your customer id |
| `success_url`, `error_url`, `cancel_url` | no | Public URLs (browser redirects, not payment proof) |
| `signature` | yes | See below |

**Signature:** take the signable fields (`merchant, env, operation, payment_method, order_amount, currency, order_invoice_number, order_description, customer_id, agreement_id, agreement_name, agreement_type, agreement_payment_frequency, agreement_amount_per_payment, success_url, error_url, cancel_url, order_id`, as in the official Node SDK) that are present, **in the same order as the form inputs**, join as `field=value` with commas, then `base64(HMAC_SHA256(secret_key, string))`. There is no timestamp and no key sorting; reordering inputs breaks the signature.

```javascript
import crypto from 'node:crypto';

const SIGNED = ['merchant', 'env', 'operation', 'payment_method', 'order_amount', 'currency',
  'order_invoice_number', 'order_description', 'customer_id',
  'agreement_id', 'agreement_name', 'agreement_type',
  'agreement_payment_frequency', 'agreement_amount_per_payment',
  'success_url', 'error_url', 'cancel_url', 'order_id'];

function signFields(fields, secretKey) {
  const data = Object.keys(fields)            // insertion order == form order
    .filter(k => SIGNED.includes(k) && fields[k] !== undefined)
    .map(k => `${k}=${fields[k]}`)
    .join(',');
  return crypto.createHmac('sha256', secretKey).update(data).digest('base64');
}
```

Render inputs in the same key order and append `signature` last. SePay answers with a 302 to `/v1/checkout`.

## Node.js SDK (sepay-pg-node)

```bash
npm i sepay-pg-node
```

Requires Node.js 16+.

```javascript
import { SePayPgClient } from 'sepay-pg-node';

const client = new SePayPgClient({
  env: 'sandbox', // or 'production'
  merchant_id: process.env.SEPAY_MERCHANT_ID,
  secret_key: process.env.SEPAY_SECRET_KEY,
});

const fields = client.checkout.initOneTimePaymentFields({
  operation: 'PURCHASE',
  payment_method: 'BANK_TRANSFER',
  order_invoice_number: 'DH0001',
  order_amount: 10000,
  currency: 'VND',
  order_description: 'Payment for order DH0001',
  success_url: 'https://example.com/success',
  error_url: 'https://example.com/error',
  cancel_url: 'https://example.com/cancel',
});
// returns the same fields plus `merchant` and `signature`
```

```jsx
<form action={client.checkout.initCheckoutUrl()} method="POST">
  {Object.keys(fields).map(k => <input type="hidden" name={k} value={fields[k]} key={k} />)}
  <button type="submit">Pay Now</button>
</form>
```

**Order API** (Basic auth handled by the SDK):

```javascript
await client.order.all({ per_page: 20, q: 'DH', order_status: 'CAPTURED',
  from_created_at: '2025-10-01', to_created_at: '2025-10-13', sort: { created_at: 'desc' } });
await client.order.retrieve('DH0001');        // by order_invoice_number
await client.order.voidTransaction('DH0001'); // card payments only
await client.order.cancel('DH0001');          // QR payments
```

## PHP SDK (sepay/sepay-pg)

```bash
composer require sepay/sepay-pg
```

Requires PHP 7.4+, ext-json, ext-curl, Guzzle 7.

```php
use SePay\SePayClient;
use SePay\Builders\CheckoutBuilder;

$sepay = new SePayClient(
    getenv('SEPAY_MERCHANT_ID'),
    getenv('SEPAY_SECRET_KEY'),
    SePayClient::ENVIRONMENT_SANDBOX,           // or ENVIRONMENT_PRODUCTION
    ['timeout' => 30, 'retry_attempts' => 3, 'retry_delay' => 1000] // optional config
);

$checkoutData = CheckoutBuilder::make()
    ->currency('VND')
    ->orderAmount(100000)
    ->operation('PURCHASE')
    ->orderDescription('Test payment')
    ->orderInvoiceNumber('INV_001')
    ->successUrl('https://yoursite.com/success')
    ->errorUrl('https://yoursite.com/error')
    ->cancelUrl('https://yoursite.com/cancel')
    ->build();

$formFields = $sepay->checkout()->generateFormFields($checkoutData); // fields + signature
echo $sepay->checkout()->generateFormHtml($checkoutData);            // ready-made form
```

Other helpers: `enableDebugMode()`, `setRetryAttempts()`, `setRetryDelay()`, `setLogger()`, `checkout()->verifySignature()`.

**Orders and errors:**

```php
use SePay\Exceptions\{AuthenticationException, ValidationException, NotFoundException, RateLimitException, ServerException};

try {
    $orders = $sepay->orders()->list(['per_page' => 10, 'order_status' => 'CAPTURED']);
    $order  = $sepay->orders()->retrieve('INV_001');
    $sepay->orders()->voidTransaction('INV_001'); // cards
    $sepay->orders()->cancel('INV_001');          // QR
} catch (ValidationException $e) {
    $errors = $e->getValidationErrors();          // or hasFieldError()/getFieldErrors('amount')
} catch (RateLimitException $e) {
    $retryAfter = $e->getRetryAfter();
} catch (AuthenticationException | NotFoundException | ServerException $e) {
    report($e);
}
```

## Laravel Package (sepayvn/laravel-sepay)

Receives **bank-transfer webhooks** (not gateway IPN). v1.2.2 needs PHP 8.0+ and Laravel 9-12; the `dev-lite` branch targets Laravel 7-8.

```bash
composer require sepayvn/laravel-sepay
php artisan vendor:publish --tag="sepay-migrations"
php artisan migrate
php artisan vendor:publish --tag="sepay-config"
php artisan vendor:publish --tag="sepay-views"   # optional
```

```
SEPAY_WEBHOOK_TOKEN=your_webhook_api_key
SEPAY_MATCH_PATTERN=SE
```

Configure the SePay webhook with **API Key** auth pointing at `https://your-domain/api/sepay/webhook`. The controller reads the key after `Apikey ` in `Authorization`, stores the transaction (dedupes on `id`), extracts the id after `SEPAY_MATCH_PATTERN` from `content` (for example `SE123` → `123`), and fires the event.

```php
<?php

namespace App\Listeners;

use SePay\SePay\Events\SePayWebhookEvent;

class SePayWebhookListener
{
    public function handle(SePayWebhookEvent $event): void
    {
        if ($event->sePayWebhookData->transferType === 'in') {
            // $event->info is the id extracted after the match pattern
            Order::where('code', $event->info)->update(['status' => 'paid']);
        }
    }
}
```

Laravel 11+ auto-discovers listeners in `app/Listeners`; for older versions register `SePayWebhookEvent::class => [SePayWebhookListener::class]` in `EventServiceProvider`.

**Caveat:** the package controller answers `204 No Content`, while SePay's current contract counts only 200/201 with `{"success": true}` as success. Check Delivery logs for retries, or wrap the route to return `{"success": true}`. It also supports API Key auth only (no HMAC).

## Best Practices

1. Keep `merchant_id`, `secret_key`, webhook secrets in environment variables; sandbox and production pairs differ.
2. Confirm orders from IPN/webhooks, never from `success_url` redirects.
3. Keep the form field order identical to the signing order.
4. Make `order_invoice_number` unique; use it for retrieve/cancel/void.
5. Test the full flow in sandbox / Test mode before switching to production hosts.
