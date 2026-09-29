# SePay Overview

Vietnamese payment automation platform between your application and banks.
Verified against developer.sepay.vn on 2026-09-26.

## Product Surfaces

| Surface | Use it for | Auth | Notifications |
|---------|-----------|------|---------------|
| **Bank-transfer automation** (Webhooks + SePay API) | Own VietQR/bank-transfer checkout, reconciliation, order VAs | API Token (Bearer) | Webhooks |
| **Payment Gateway** (Cổng thanh toán) | Hosted checkout: VietQR, NAPAS QR (VietQRPay), Visa/Mastercard/JCB | Basic `merchant_id:secret_key` | IPN |
| **OAuth2 API** | Third-party apps acting on a SePay user's data | OAuth2 access token | Webhooks (managed via API) |
| **Bank Hub** | Platforms linking end-user bank accounts (hosted link) | Bank Hub token | IPN |

**Payment methods (gateway):** `BANK_TRANSFER` (VietQR), `NAPAS_BANK_TRANSFER` (NAPAS QR), `CARD`. Recurring payments are announced as "coming soon" (not live).

**Banks:** The VietQR bank list (`https://vietqr.app/banks.json`, also served at `https://qr.sepay.vn/banks.json`) lists 54 banks, 23 flagged `supported` for SePay automation. SePay publishes no official "44+" figure; check `banks.json` and the [webhook bank list](https://developer.sepay.vn/en/sepay-webhooks/tai-khoan-ngan-hang) instead of hardcoding a count.

## Authentication

### API Token (SePay API)

1. Dashboard → Company settings → API Access → "+ Add API"
2. Name it, status "Active", copy the token (shown in full once)

```
Authorization: Bearer {API_TOKEN}
```

- Token is a 64-char alphanumeric string with full company access (no scopes)
- Live and Test mode tokens are separate and never cross environments

### Payment Gateway (Basic Auth)

```
Authorization: Basic base64(merchant_id:secret_key)
Content-Type: application/json
```

Sandbox and production each have their own `merchant_id`/`secret_key` pair.

### OAuth2 (third-party apps)

- Authorize: `https://my.sepay.vn/oauth/authorize`
- Token: `https://my.sepay.vn/oauth/token`
- API base: `https://my.sepay.vn/api/v1` (`/bank-accounts`, `/transactions`, `/webhooks`, `/me`, `/companies`)
- Scopes (space-separated): `bank-account:read`, `transaction:read`, `webhook:read`, `webhook:write`, `webhook:delete`, `profile`, `company`

**1. Authorization request:**
```
GET https://my.sepay.vn/oauth/authorize?response_type=code&client_id={CLIENT_ID}
  &redirect_uri={REDIRECT_URI}&scope=bank-account:read%20transaction:read&state={CSRF_TOKEN}
```

**2. Code exchange (server-side, form-encoded):**
```
POST https://my.sepay.vn/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code={CODE}&redirect_uri={REDIRECT_URI}
&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}
```

**3. Refresh:**
```
POST https://my.sepay.vn/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token={REFRESH_TOKEN}&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}
```

Access token lives 1 hour; refresh token about 1 month. Refresh before expiry or on 401. Never expose `client_secret`; validate `state`.

## Payment Gateway Flow (one-time)

1. Customer checks out; merchant creates an order record
2. Merchant builds the checkout form and HMAC-SHA256 signature (see `sdk.md`)
3. Browser POSTs the form to `/v1/checkout/init`; SePay validates the signature
4. SePay redirects (302) to its payment page; customer picks a method
5. Bank/card network returns the result
6. SePay sends the IPN to the merchant (see `webhooks.md`) and redirects the customer to `success_url`/`error_url`/`cancel_url`
7. Merchant confirms the order from the IPN, not from the redirect

## Environments

| | Sandbox / Test mode | Production |
|---|---|---|
| SePay API v2 | `https://userapi-sandbox.sepay.vn/v2` | `https://userapi.sepay.vn/v2` |
| Gateway checkout form | `https://pay-sandbox.sepay.vn/v1/checkout/init` | `https://pay.sepay.vn/v1/checkout/init` |
| Gateway REST API | `https://pgapi-sandbox.sepay.vn` | `https://pgapi.sepay.vn` |

- **Test mode** (dashboard): isolated bank accounts, VAs, webhooks, API tokens and simulated transactions. Quotas: 500 simulated transactions/day (reset 00:00 Vietnam time), 50 bank accounts, 100 VAs per account, 50 webhooks, 50 API tokens. Webhook SSL verification is disabled in Test mode.
- **Gateway sandbox:** activate Payment Gateway at my.sepay.vn to get sandbox credentials immediately.
- **Go-live:** VietQR activates online in about 30 minutes; NAPAS QR and cards need approval of about 3-5 days to 2 weeks.

## Rate Limits

- SePay API: **3 requests/second per IP**, checked before authentication (v1 and v2 body text; the page header banner still says 2 req/s, so budget for 2 req/s to be safe).
- HTTP 429 → wait for `Retry-After` (v2) or `x-sepay-userapi-retry-after` (legacy v1), in seconds.

```javascript
if (res.status === 429) {
  const wait = Number(res.headers.get('retry-after') ?? res.headers.get('x-sepay-userapi-retry-after') ?? 1);
  await new Promise(r => setTimeout(r, wait * 1000));
  return retry();
}
```

## Outbound IPs (webhooks, IPN, callbacks)

Allowlist all of them and recheck [the IP page](https://developer.sepay.vn/en/dia-chi-ip) periodically:

```
IPv4: 172.236.138.20  172.233.83.68  171.244.35.2  151.158.108.68
      151.158.109.79  103.255.238.139  45.57.137.67
IPv6: 2400:8905::2000:8cff:fe98:45cd  2600:3c15::2000:8aff:fedd:874b
```

## Support

- Email: info@sepay.vn
- Hotline: 02873.059.589 (sepay.vn)
- Docs: https://developer.sepay.vn/en (raw markdown: append `.md`; index at `/llms.txt`)
- User guide: https://docs.sepay.vn
- GitHub: https://github.com/sepayvn

## Next Steps

- **API integration:** `api.md`
- **SDK / gateway checkout:** `sdk.md`
- **Webhooks and IPN:** `webhooks.md`
- **QR generation:** `qr-codes.md`
