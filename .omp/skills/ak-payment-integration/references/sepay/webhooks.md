# SePay Webhooks and IPN

Two notification channels. Verified against developer.sepay.vn on 2026-09-26.

- **Webhooks:** bank-transaction events (VietQR/bank transfer, order VAs). Configure at my.sepay.vn → Integrations → Webhooks.
- **IPN:** Payment Gateway order events. Configure at Payment Gateway → Configuration → IPN.

## Webhook Setup (4-step wizard)

1. **Basics:** name, HTTPS URL (public DNS; localhost/private IPs rejected), event type (`Money in`, `Money out`, `Both`), Content-Type (default `application/json`; form-urlencoded and multipart also possible), auto retry on/off
2. **Accounts:** all accounts or specific accounts, VA mode per account (all / selected / none), payment-code prefix filter (case-sensitive), "skip transactions without code"
3. **Security:** `None`, `API Key`, `HMAC-SHA256` (recommended), `OAuth 2.0`
4. **Alerts:** consecutive-failure threshold (1-20, default 3) to Telegram, Slack or Discord

Use the row menu **Test send** to post a sample payload (`id` is a mock value such as `0`). "Money out" works only for Sacombank, TPBank, VietinBank with memo-based VAs.

## Payload

```json
{
  "id": 92704,
  "gateway": "Vietcombank",
  "transactionDate": "2024-07-02 11:08:33",
  "accountNumber": "1017588888",
  "subAccount": "",
  "code": "SEVN63DC8E5C",
  "content": "SEVN63DC8E5C chuyen tien",
  "transferType": "in",
  "description": "NGUYEN VAN A chuyen tien",
  "transferAmount": 5000000,
  "accumulated": 105000000,
  "referenceCode": "FT24012345678"
}
```

| Field | Notes |
|-------|-------|
| `id` | SePay transaction id; identical across retries and replays → dedup key |
| `gateway` | Bank name |
| `transactionDate` | `YYYY-MM-DD HH:mm:ss`, Vietnam time |
| `accountNumber` | Bank account number |
| `subAccount` | Matched VA (official VA number or memo-based TKP id); `""` when none |
| `code` | Payment code extracted by your Payment code structure config; `null` when none (check `=== null`) |
| `content` | Raw transfer memo |
| `transferType` | `in` or `out` |
| `description` | Full bank description; may be empty |
| `transferAmount` | Integer VND, always positive |
| `accumulated` | Balance after the transaction; `0` if the bank does not report it |
| `referenceCode` | Bank reference; may be empty |

## Authentication

| Mode | What SePay sends | Verify |
|------|------------------|--------|
| None | nothing | Testing only |
| API Key | `Authorization: Apikey {API_KEY}` | Timing-safe compare |
| HMAC-SHA256 | `X-SePay-Signature: sha256={hex}`, `X-SePay-Timestamp: {unix_seconds}` | Recompute over raw body |
| OAuth 2.0 | `Authorization: Bearer {access_token}` issued by **your** token endpoint | Validate your own token |

Secrets (API key, HMAC secret, OAuth client secret) are shown in full only once; afterwards only the last 4 chars.

**HMAC-SHA256 signing:** `hex(HMAC_SHA256(secret, "{timestamp}.{raw_body}"))`, prefixed with `sha256=`. Use the raw request bytes (not re-serialized JSON). Reject timestamps more than 5 minutes from now.

**OAuth 2.0:** SePay first calls your token endpoint with `grant_type=client_credentials` (form-encoded, "Standard"), falling back to a JSON `{"clientId","clientSecret"}` "Custom" format. Standard response: `{"access_token","expires_in","refresh_token"?}`. If the token endpoint fails, the webhook is never delivered.

## Response Contract

Success requires all three:

1. HTTP **200 or 201** (202, 204, redirects count as failure)
2. JSON body exactly `{"success": true}`
3. Within **30 seconds** (connect timeout 15 s)

Acknowledge first, then process asynchronously.

## Retry Policy

With auto retry enabled, SePay retries on connection errors, timeouts and non-2xx statuses on a Fibonacci schedule: 1, 1, 2, 3, 5, 8, 13 minutes. That is 8 attempts total (initial + 7 retries) over about 33 minutes; then the delivery is marked Failed and alerts fire. Recover later with manual **Replay** / Incidents or API reconciliation. Ordering is not guaranteed; sort by `transactionDate`.

## Deduplication

Duplicates come from retries, manual replays (even of successful deliveries), and multiple webhooks pointing at one URL. Enforce a `UNIQUE` constraint on `id` and insert-ignore:

```sql
CREATE TABLE sepay_transactions (
  sepay_id BIGINT NOT NULL UNIQUE,
  amount_in BIGINT NOT NULL DEFAULT 0,
  body JSON NOT NULL
);
```

## Node.js/Express (HMAC-SHA256)

```javascript
import crypto from 'node:crypto';

app.post('/webhook/sepay', express.raw({ type: '*/*' }), async (req, res) => {
  const body = req.body.toString('utf8');
  const signature = req.get('x-sepay-signature') ?? '';
  const timestamp = Number(req.get('x-sepay-timestamp') ?? 0);

  if (Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return res.status(401).json({ success: false, message: 'Request expired' });
  }
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.SEPAY_WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  const tx = JSON.parse(body);
  const [result] = await db.query('INSERT IGNORE INTO sepay_transactions (sepay_id, amount_in, body) VALUES (?, ?, ?)',
    [tx.id, tx.transferType === 'in' ? tx.transferAmount : 0, body]);
  if (result.affectedRows === 1) queue.push(tx); // first delivery only; retries are acknowledged

  return res.status(200).json({ success: true });
});
```

For API Key mode, compare `Authorization` against `Apikey ${process.env.SEPAY_WEBHOOK_API_KEY}` with `timingSafeEqual`.

## PHP (HMAC-SHA256)

```php
<?php
$body = file_get_contents('php://input');
$ts = (int) ($_SERVER['HTTP_X_SEPAY_TIMESTAMP'] ?? 0);
$sig = $_SERVER['HTTP_X_SEPAY_SIGNATURE'] ?? '';
$expected = 'sha256=' . hash_hmac('sha256', $ts . '.' . $body, getenv('SEPAY_WEBHOOK_SECRET'));

if (abs(time() - $ts) > 300 || !hash_equals($expected, $sig)) {
    http_response_code(401);
    exit;
}

$data = json_decode($body, true);
$stmt = $pdo->prepare('INSERT IGNORE INTO sepay_transactions (sepay_id, amount_in, body) VALUES (?, ?, ?)');
$stmt->execute([$data['id'], $data['transferType'] === 'in' ? $data['transferAmount'] : 0, $body]);

header('Content-Type: application/json');
echo json_encode(['success' => true]);
```

## Security Checklist

1. HTTPS with a valid, complete certificate chain (self-signed rejected on Live)
2. HMAC-SHA256 (or at least API Key) with timing-safe comparison
3. Allowlist SePay outbound IPs (see `overview.md`)
4. Validate `transferAmount`, `accountNumber` and `code` against the order
5. Store the raw payload before processing
6. Reconcile via API every 15-30 minutes

## Payment Gateway IPN

SePay POSTs JSON to your IPN URL (public HTTPS). With auth type `SECRET_KEY` it adds `X-Secret-Key: {secret_key}`; compare it timing-safely.

```json
{
  "timestamp": 1757058220,
  "notification_type": "ORDER_PAID",
  "order": {
    "id": "e2c195be-c721-47eb-b323-99ab24e52d85",
    "order_id": "NPSETVI00101000042R",
    "order_status": "CAPTURED",
    "order_currency": "VND",
    "order_amount": "50000.00",
    "order_invoice_number": "INV_001",
    "custom_data": [],
    "order_description": "Payment for order INV_001"
  },
  "transaction": {
    "id": "384c66dd-41e6-4316-a544-b4141682595c",
    "payment_method": "CARD",
    "transaction_id": "68ba94ac80123",
    "transaction_type": "PAYMENT",
    "transaction_status": "APPROVED",
    "transaction_amount": "50000",
    "transaction_currency": "VND"
  },
  "customer": { "id": "bae12d2f-0580-4669-8841-cc35cf671613", "customer_id": "CUST_001" }
}
```

- `notification_type`: `ORDER_PAID`, `TRANSACTION_VOID`
- `transaction_type`: `PAYMENT`, `REFUND`; `transaction_status`: `APPROVED`, `DECLINED`
- Match by `order.order_invoice_number`, check amount and status, dedupe on `transaction.id`
- Respond HTTP 200 (SePay's sample returns `{"success": true}`)

## OAuth2 Webhook Management API

Base `https://my.sepay.vn/api/v1`; scopes `webhook:read`, `webhook:write`, `webhook:delete`.

```
GET    /api/v1/webhooks            # filters: webhook_url, api_key, active, page, limit
GET    /api/v1/webhooks/{id}
POST   /api/v1/webhooks
PATCH  /api/v1/webhooks/{id}
DELETE /api/v1/webhooks/{id}
```

```json
{
  "bank_mode": "single",
  "bank_account_id": 123,
  "name": "My Webhook",
  "event_type": "In_only",
  "authen_type": "HMAC_SHA256",
  "secret_key": "<generated secret>",
  "request_content_type": "Json",
  "webhook_url": "https://example.com/webhook/sepay",
  "is_verify_payment": 1,
  "skip_if_no_code": 1,
  "prefix_filters": ["DH"],
  "retry_conditions": { "non_2xx_status_code": 1 }
}
```

- `event_type`: `All`, `In_only`, `Out_only`
- `authen_type`: `No_Authen`, `Api_Key` (+ `api_key`), `HMAC_SHA256` (+ `secret_key`), `OAuth2.0` (+ `oauth2_access_token_url`, `oauth2_client_id`, `oauth2_client_secret`)
- `request_content_type` (non-OAuth): `Json`, `multipart_form-data`, `application_x-www-form-urlencoded`
- Optional: `bank_mode` (`single`/`multi`/`all`), `bank_account_ids`, `va_mode` (`all`/`list`/`none`), `only_va`, `bank_sub_account_ids`, `alert_threshold`, `alert_event_types`, `alert_channel_ids`, `active`
