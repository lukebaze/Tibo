# PayFS Webhooks

Transaction and order notifications, `X-Client-API-Key` auth, `X-PayFS-Signature`
HMAC verification, retries and idempotency. Verified 2026-09-26 against
https://docs.payfs.vn/vi/developers/webhooks, `/vi/developers/webhook-signature` and
`/vi/developers/quickstart`. The documented signature test vector reproduces.

## Setup

1. Client Portal → open the Workspace → notifications → create webhook (type HTTP)
2. Paste a public URL; PayFS generates a **Webhook API Key** and a **webhook secret** for it
3. Select events (below). Telegram-type webhooks are separate and can run alongside HTTP ones
4. Delivery history (request body, your status code, attempt count) is in the Client
   Portal; check it first when a transaction seems missing

No sandbox and no "send test" button are documented. Test with a small real transfer
into a connected account, or sign fixtures locally with `payfs-webhook-verify.js`.

## Events

| Event | When | Payload |
|-------|------|---------|
| `transaction.credit` | Money in | Transaction |
| `transaction.debit` | Money out | Transaction |
| `order.success` | Order paid | Order |
| `order.failed` | Order payment failed | Order |

The event name is **not** in the body or headers. Infer it from `transfer_type`
(transaction) or `status` (order). How PayFS orders are created is not documented.

### Transaction payload

```json
{
  "account_id": "1418079746853494784",
  "amount": 14000,
  "bank": "MB",
  "bank_account_number": "0933723830",
  "content": "NGUYEN VAN A chuyen tien  Ma giao dich  Trace773231",
  "transaction_date": "2025-09-15T15:02:00.000Z",
  "transaction_id": "1418108930751619072",
  "transfer_type": "credit"
}
```

| Field | Notes |
|-------|-------|
| `transaction_id` | String, globally unique → dedup key |
| `account_id` | PayFS bank-account id (string) |
| `amount` | Integer VND, always positive; use `transfer_type` for direction |
| `transfer_type` | `credit` (in) or `debit` (out) |
| `content` | Raw transfer memo from the bank |
| `transaction_date` | ISO 8601, **UTC** (convert before comparing with Vietnam local dates) |
| `bank_account_number` | Receiving or sending account number |
| `bank` | `MB`, `ACB` or `OCB` |

IDs are 19-digit strings; keep them as strings (they exceed `Number.MAX_SAFE_INTEGER`).
No virtual-account field is documented, so VA matching relies on `bank_account_number`
(assumption; confirm with a real VA delivery).

### Order payload

```json
{
  "order_id": "1418108930751619072",
  "amount": 250000,
  "status": "success",
  "customer_email": "khachhang@example.com",
  "created_at": "2025-09-15T15:02:00.000Z"
}
```

Only `order_id`, `amount`, `status` are required. The failed status value is not
spelled out (presumably `failed`).

## Headers

| Header | Example | Meaning |
|--------|---------|---------|
| `X-Client-API-Key` | `pk_1234...` | Webhook API Key. Checking it is **required** |
| `X-PayFS-Signature` | `86f02cef...` | HMAC-SHA256, raw 64-char hex, **no `sha256=` prefix** |
| `X-PayFS-Timestamp` | `1758173916` | UNIX seconds, part of the signed string |
| `X-PayFS-Webhook-ID` | `1418108...` | Webhook **endpoint** id (not a per-delivery id) |
| `X-PayFS-Attempt` | `1` | Attempt number |

Node frameworks lowercase header names: read `x-client-api-key`.

## Signature Scheme

```
sorted = JSON with object keys sorted alphabetically, recursively (arrays keep order)
data   = timestamp + "." + JSON.stringify(sorted)
sig    = hex(HMAC_SHA256(key = webhook secret, message = data))
```

- The signature covers a **canonical re-serialization**, not the raw bytes. Parse the
  body, sort keys, `JSON.stringify` without spaces, then sign.
- Keep the dot between timestamp and JSON. Compare in constant time; check lengths
  first because `timingSafeEqual` throws on unequal lengths.
- Signatures expire after **5 minutes**. The docs' sample rejects only old
  timestamps; rejecting `|now - ts| > 300` also blocks future-dated replays.
- Verify API key **and** signature for anything that moves money.

**Test vector** (from the docs, reproduced 2026-09-26):

```
secret    whsec_example_secret_do_not_use_in_production
timestamp 1758173916
body      the transaction payload above, keys already sorted, no spaces
signature 86f02cefae56d51f72a00e04bf9d5a96b40cfe6902d54e495234c447ec706c5e
```

### Canonicalization traps

- **Non-ASCII text:** `JSON.stringify` leaves characters such as Vietnamese diacritics
  unescaped. The docs' PHP sample uses `json_encode(..., JSON_UNESCAPED_SLASHES)`,
  which escapes them as `\uXXXX`, so PHP and Node disagree on such memos. Add
  `JSON_UNESCAPED_UNICODE` in PHP to match the Node output (inference; confirm with a
  real delivery containing diacritics).
- **Empty objects:** PHP decodes `{}` to `[]` and re-encodes `[]`; avoid PHP
  canonicalization when payloads may contain empty objects.
- **Key order:** use plain code-unit sort (JS `Array.prototype.sort()`), not locale sort.

## Node.js / Express

```javascript
const PayfsWebhookVerifier = require('./payfs-webhook-verify');

const verifier = new PayfsWebhookVerifier(process.env.PAYFS_WEBHOOK_SECRET, {
  apiKey: process.env.PAYFS_WEBHOOK_API_KEY,
});

app.post('/webhooks/payfs', express.raw({ type: '*/*' }), async (req, res) => {
  const result = verifier.process(req.body, req.headers);
  if (!result.success) return res.status(401).json({ error: result.error });

  const { event } = result;
  // UNIQUE(transaction_id) or UNIQUE(order_id, status); insert-ignore returns false on repeat
  const firstDelivery = await recordOnce('payfs', event.id, req.body.toString('utf8'));
  if (firstDelivery) await queue.push(event); // match and fulfil in a worker
  return res.status(200).json({ status: 'ok' });
});
```

Without the script: compare `X-Client-API-Key` with `crypto.timingSafeEqual`, then
apply the scheme above to `JSON.parse(rawBody)`.

## PHP

```php
<?php
function payfs_sort($v) {
    if (!is_array($v)) return $v;
    if (array_is_list($v)) return array_map('payfs_sort', $v);
    ksort($v, SORT_STRING);
    return array_map('payfs_sort', $v);
}

$raw = file_get_contents('php://input');
$key = $_SERVER['HTTP_X_CLIENT_API_KEY'] ?? '';
$sig = $_SERVER['HTTP_X_PAYFS_SIGNATURE'] ?? '';
$ts  = (int) ($_SERVER['HTTP_X_PAYFS_TIMESTAMP'] ?? 0);

$canonical = json_encode(payfs_sort(json_decode($raw, true)),
    JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
$expected = hash_hmac('sha256', $ts . '.' . $canonical, getenv('PAYFS_WEBHOOK_SECRET'));

if (!hash_equals(getenv('PAYFS_WEBHOOK_API_KEY'), $key)
    || abs(time() - $ts) > 300
    || !hash_equals($expected, strtolower($sig))) {
    http_response_code(401);
    exit;
}
```

`array_is_list` needs PHP 8.1+.

## Response Contract and Retries

| Item | Value |
|------|-------|
| Success | Any **2xx** (no body contract) |
| Timeout per attempt | 30 s (slow answer = failure, will be retried) |
| Max attempts | 10 |
| First retry delay | 10 s |
| Backoff factor | 2 |

- The table is labelled "defaults"; whether it is configurable is not documented.
- Delays grow 10 s, 20 s, 40 s, ... If 10 includes the first attempt, the last retry
  lands about 85 minutes after the first (derived, not stated).
- Recommended codes: `200` processed, `401` bad/missing API key, `400` invalid
  payload, `500` temporary failure (PayFS retries).
- Returning 401/400 is also a non-2xx, so expect retries for those too.
- Open question: whether each retry gets a fresh `X-PayFS-Timestamp`. If PayFS reused
  the original one, retries after 5 minutes would fail verification. Watch
  `X-PayFS-Attempt` in logs before tightening alerts.

Acknowledge fast, then process in a background queue.

## Idempotency

- Dedupe transactions on `transaction_id` with a DB/Redis unique key, not process memory.
- For orders, use `order_id` + `status` (a failed then successful order is two facts).
- Duplicates come from retries and from two webhooks pointing at one URL.
- Delivery order is not documented as guaranteed; compare `transaction_date` when it matters.

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| Signature never matches | Missing dot, unsorted keys, stripping a `sha256=` prefix, wrong secret, body mutated before parse |
| "Signature expired" | Server clock drift (use NTP) or processing longer than 5 min before verifying |
| Header missing | Read lowercase `x-client-api-key` |
| Webhook never called | URL not public, event not selected, firewall; check delivery history |
