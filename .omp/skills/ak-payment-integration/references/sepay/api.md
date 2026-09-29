# SePay API Reference

Verified against developer.sepay.vn on 2026-09-26.

| API | Base URL | Auth |
|-----|----------|------|
| SePay API v2 (recommended) | `https://userapi.sepay.vn/v2` (sandbox `https://userapi-sandbox.sepay.vn/v2`) | `Authorization: Bearer {API_TOKEN}` |
| SePay API v1 (legacy, deprecated) | `https://my.sepay.vn/userapi/` | `Authorization: Bearer {API_TOKEN}` |
| Payment Gateway API | `https://pgapi.sepay.vn` (sandbox `https://pgapi-sandbox.sepay.vn`) | `Authorization: Basic base64(merchant_id:secret_key)` |
| OAuth2 API | `https://my.sepay.vn/api/v1` | `Authorization: Bearer {ACCESS_TOKEN}` |

Rate limit: 3 req/s per IP (see `overview.md`); HTTP 429 carries `Retry-After`.

## SePay API v2

Unified envelope, UUID ids, integer amounts, real HTTP status codes (401, 404, 422 with `error_code`, 429).

```json
{
  "status": "success",
  "data": [ ... ],
  "meta": { "pagination": { "total": 150, "per_page": 20, "current_page": 1, "last_page": 8, "has_more": true } }
}
```

Pagination: `page`, `per_page` (default 20, max 100); loop until `has_more` is false. Use `since_id` (UUID) for incremental polling.

### Transactions

```
GET /v2/transactions
GET /v2/transactions/{uuid}
```

Filters: `q`, `bank_account_id`, `va_id`, `bank_brand_name`, `transaction_date_from`/`_to` (`YYYY-MM-DD HH:mm:ss`), `amount_in_min`/`_max`, `amount_out_min`/`_max`, `reference_number`, `transaction_content`, `transfer_type`, `webhook_success`, `since_id`, `*_sort`, `fields`.

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "transaction_date": "2025-02-20 14:15:00",
  "account_number": "0123456789",
  "va": "VA001",
  "transfer_type": "in",
  "amount_in": 500000,
  "amount_out": 0,
  "accumulated": 1500000,
  "transaction_content": "Thanh toan don hang #123",
  "reference_number": "FT26069ABC",
  "code": "ABC123",
  "bank_brand_name": "ACB",
  "bank_account_id": "f9e8d7c6-b5a4-3210-fedc-ba0987654321",
  "va_id": "a2b3c4d5-e6f7-8901-bcde-f12345678901",
  "webhook_success": 1
}
```

`webhook_success` makes reconciliation easy: list transactions whose webhook failed and replay them.

### Bank Accounts and Virtual Accounts

```
GET /v2/bank-accounts                     # filters: bank_short_name, active, q, accumulated_min/max, last_transaction_from/to
GET /v2/bank-accounts/{uuid}
GET /v2/bank-accounts/{uuid}/va           # virtual accounts
GET /v2/bank-accounts/{uuid}/terminals    # Vietcombank terminal IDs (tid)
```

### Order VAs (per-order virtual account)

Each order gets its own VA, so matching does not depend on transfer content. Supported: BIDV (enterprise), Sacombank (personal/household), Vietcombank (enterprise/household), VietinBank (enterprise). Works in production and sandbox.

```
POST   /v2/bank-accounts/{ba_uuid}/orders
GET    /v2/bank-accounts/{ba_uuid}/orders
GET    /v2/bank-accounts/{ba_uuid}/orders/{order_uuid}
DELETE /v2/bank-accounts/{ba_uuid}/orders/{order_uuid}          # only Pending orders
POST   /v2/bank-accounts/{ba_uuid}/orders/{order_uuid}/va       # extra VA
DELETE /v2/bank-accounts/{ba_uuid}/orders/{order_uuid}/va/{va}  # only Unpaid VAs
```

Create body: `amount`, `order_code` (6-50 chars, 6-15 for Vietcombank), `duration` (seconds), `with_qrcode` (0/1), `qrcode_template` (`compact`/`qronly`), plus bank-specific `tid` (Vietcombank, required), `va_prefix` (Sacombank, required), `va_holder_name` (BIDV enterprise only).

| Bank | `amount` | Partial payment |
|------|----------|-----------------|
| BIDV | Optional | Supported |
| Sacombank, Vietcombank | Required | No (exact amount only) |
| VietinBank | Required | Underpayment → `Partially`; overpayment not matched |

Response (abridged): `id`, `order_code`, `va_number`, `amount`, `status` (`Pending`, `Paid`, `Partially`, `Cancelled`), `expired_at`, `qr_code` (base64 PNG), `qr_code_url`. Payment confirmation still arrives via webhook.

### Refunds (VietinBank enterprise only)

```
POST /v2/bank-accounts/{ba_uuid}/orders/{order_uuid}/refund
POST /v2/transactions/{transaction_id}/refund
GET  /v2/bank-accounts/{ba_uuid}/refunds
GET  /v2/bank-accounts/{ba_uuid}/refunds/{refund_id}
```

`X-Idempotency-Key` header is required (reuse with a different payload → `409`). Omit `refund_amount` to refund the full remainder of that collection payment. Other banks return `422 unsupported_bank`.

## SePay API v1 (legacy)

Deprecated but still working; v1 and v2 can run in parallel during migration. Auth errors return HTTP 200 with an empty body, and business errors also return 200, so always inspect the body.

```
GET /userapi/transactions/list          # account_number, transaction_date_min/max, since_id, limit (default/max 5000), reference_number, amount_in, amount_out
GET /userapi/transactions/details/{id}
GET /userapi/transactions/count
GET /userapi/bankaccounts/list          # short_name, last_transaction_date_min/max, since_id, limit, accumulated_min/max
GET /userapi/bankaccounts/details/{id}
GET /userapi/bankaccounts/count
```

```json
{
  "status": 200,
  "error": null,
  "messages": { "success": true },
  "transactions": [{
    "id": "49682",
    "bank_brand_name": "Vietcombank",
    "account_number": "0071000888888",
    "transaction_date": "2023-05-05 19:59:48",
    "amount_out": "0.00",
    "amount_in": "18067000.00",
    "accumulated": "1200541768.00",
    "transaction_content": "DUONG THUY ANH chuyen tien",
    "reference_number": "677760.050523.080001",
    "code": null,
    "sub_account": "VCB0011ABC004",
    "bank_account_id": "19"
  }]
}
```

v1 amounts and ids are strings; v2 amounts are integers and ids are UUIDs (v1 numeric ids do not work on v2).

## Payment Gateway API

```
GET  /v1/order                        # per_page, page, q, order_status, customer_id, created_at, from_created_at, end_created_at, sort
GET  /v1/order/detail/{order_id}
POST /v1/order/cancel                 # {"order_invoice_number": "..."}  (QR orders)
POST /v1/order/voidTransaction        # {"order_invoice_number": "..."}  (cards)
```

- `order_status`: `CAPTURED` (paid), `CANCELLED`, `AUTHENTICATION_NOT_NEEDED` (awaiting payment)
- Void only works for `payment_method=CARD`, `order_status=CAPTURED`, before settlement (before 16:00 → T+1, after 16:00 → T+2)
- Orders are created by the checkout form, not by this API (see `sdk.md`)

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 400 / 422 | Invalid or unprocessable request (`error_code` in v2) | Fix parameters |
| 401 | Missing/invalid token or credentials | Check token / Basic credentials |
| 403 | No access | Check permissions or whitelist |
| 404 | Not found | Check id (UUID on v2) |
| 429 | Rate limited (`rate_limited`) | Wait `Retry-After` seconds |
| 5xx | Server error | Retry with backoff |

## Best Practices

1. Use v2 for new code; migrate v1 by mapping `limit` → `page`/`per_page`, `transaction_date_min/max` → `_from/_to`, exact amount filters → ranges.
2. Poll with `since_id` and date windows; never page through full history repeatedly.
3. Keep calls under the rate limit with a client-side queue and honor `Retry-After`.
4. Cache bank account lists.
5. Reconcile every 15-30 minutes against webhook records (webhook retries stop after about 33 minutes).
