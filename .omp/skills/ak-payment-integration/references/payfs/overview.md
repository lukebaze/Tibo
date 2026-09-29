# PayFS Overview

Vietnamese bank-transaction notification platform ("ghi nhận biến động số dư").
PayFS watches your own bank account and POSTs a webhook when money moves. It is
**not** a payment gateway or Merchant of Record: customers transfer straight into
your account, PayFS only reads the transaction.

Verified against https://docs.payfs.vn (`/llms.txt`, `/llms-full.txt`, Vietnamese
only) and https://payfs.vn on 2026-09-26. Docs are young and small (about 35 pages,
most user-guide); the developer surface is 4 pages.

## What It Is

| Item | Value | Source |
|------|-------|--------|
| Operator | Công ty cổ phần Pay5S (tax code 0318747756), Ho Chi Minh City | `/vi/getting-started/what-is-payfs` |
| Model | Read-only bank-transaction feed + webhooks; funds never pass through PayFS | `/vi`, payfs.vn |
| Currency | VND only (`amount` is a positive integer in VND) | `/vi/developers/webhooks` |
| Integration | REST API (`/v1.1`) + HTTP webhooks + Telegram bot notifications | `/vi/developers/*` |
| SDKs | None released (PHP/Python/Node SDK, WordPress plugin, Laravel package "not released") | `/vi/getting-started/what-is-payfs` |
| Sandbox | None documented; docs say test with a real small transfer | `/vi/developers/quickstart` |

## Bank Connection Modes

Each **Workspace** (isolated tenant: own bank accounts, webhooks, transactions,
members) has a Banking Mode fixed at creation by its entity type.

| Mode | Banks | Who can use it | Notes |
|------|-------|----------------|-------|
| **Open Banking** | MBBank (`MB`), ACB (`ACB`), OCB (`OCB`) | Individual, household business, enterprise | Direct bank API; OTP from the bank to link; detailed transaction data |
| **NAPAS** | All Vietnamese banks | Enterprise only | Wider coverage, "less detailed" data (docs); onboarding via PayFS |

- Entity type and Banking Mode **cannot be changed**; a wrong choice means a new Workspace.
- **Main Bank Account** anchors the connection; **Virtual Accounts** (provider-issued
  numbers under a main account) let you give each customer/order its own receiving
  number so matching does not depend on the transfer memo.
- Bank status `Maintenance`/`Discontinued` blocks new connections only; existing
  connections keep receiving transactions.
- A KienLong Bank page exists but is marked "temporarily hidden"; payfs.vn marketing
  lists it as a 4th Open Banking bank. Treat KienLong as unconfirmed.

Source: https://docs.payfs.vn/vi/bank-accounts/organization

## Authentication

Two independent credentials. Do not mix them up.

| Credential | Direction | Transport |
|------------|-----------|-----------|
| **API Token** | You call PayFS | `Authorization: Bearer <token>` |
| **Webhook API Key** + **Webhook secret** | PayFS calls you | `X-Client-API-Key` header + HMAC signature (see `webhooks.md`) |

API Token facts (`/vi/developers/api-token`):
- Created in Client Portal (https://portal.payfs.vn) → **API Token**; set name and
  expiry, pick Workspaces, then per-Workspace permissions
- Permissions: Workspace (view/change/delete/manage members), Bank account
  (view/change/delete), Webhook (view/change/delete)
- Effective permission never exceeds the creating user's current role; demoting the
  user narrows the token
- Rotate (old value dies immediately) or revoke; one token per system, least privilege,
  keep in env vars, never log

## API

| Item | Value |
|------|-------|
| Base URL | `https://api.payfs.vn/v1.1` (always put the version in the path) |
| Environments | One; separate dev/prod by using separate Workspaces |
| Documented endpoints | Only the sample `GET /v1.1/transactions` |

```bash
curl https://api.payfs.vn/v1.1/transactions \
  -H "Authorization: Bearer $PAYFS_API_TOKEN" \
  -H "Content-Type: application/json"
```

**Caveats (checked 2026-09-26):**
- No API reference, OpenAPI file, query parameters, pagination or response schema is published.
- `/vi/workspace/switch` says every API request names the Workspace in the path, which
  the sample URL does not do.
- An unauthenticated `GET /v1.1/transactions` returns `404 {"error":"Not Found"}`
  rather than `401`, so the sample path may not be the real route.
- Payment links, order creation and QR generation are advertised on payfs.vn but have
  **no documented API**. Do not invent endpoints; ask PayFS support for a spec.

Treat webhooks as the integration contract and the API as unverified until PayFS
publishes a reference.

### Error Envelope

```json
{
  "success": false,
  "error": {
    "code": "AUTHENTICATION_ERROR",
    "errorCode": 20001,
    "message": "Authentication failed",
    "traceId": "trace_01HK...",
    "messageKey": "auth/authentication-error"
  },
  "meta": { "timestamp": "2026-08-23T02:02:55.371Z" }
}
```

| HTTP | `error.code` | Action |
|------|--------------|--------|
| 401 | `AUTHENTICATION_ERROR` | Token wrong, expired or revoked; check `Bearer` format |
| 403 | `INSUFFICIENT_PERMISSIONS` | Token lacks rights on that Workspace |
| 429 | `RATE_LIMIT_ERROR` | Back off exponentially; no numeric limit is published |

Log `error.traceId` for support tickets.

## Pricing (Open Banking)

Monthly subscription per account plus a per-transaction overage. Not a percentage of
the amount. Workspace is never locked on overage.

| Plan | VND/month | Transactions/month | Workspaces | Overage per transaction |
|------|-----------|--------------------|------------|-------------------------|
| Free | 0 | 30 | 1 | 650 |
| P1 | 199,000 | 500 | 2 | 400 |
| P2 | 699,000 | 2,000 | 5 | 350 |
| P3 | 2,999,000 | 10,000 | 10 | 300 |
| VIP1 | 5,000,000 | 20,000 | 100 | 250 |

- Source: https://docs.payfs.vn/vi/pricing/service-packages (checked 2026-09-26).
- payfs.vn/bang-gia-openbanking also lists **VIP2** (10,000,000 VND, 50,000
  transactions, 200 VND overage) and says the Free plan allows 1 bank account per
  Workspace. Prices exclude VAT.
- **NAPAS** pricing is only on marketing pages (payfs.vn/bang-gia-napas): per-MCC,
  e.g. 0.35% + 100 VND per successful transaction for general merchants, from 0.15%
  for preferential industries, fixed fees for education/utilities, 1-2 week onboarding.
  Not in the docs; get a written quote.
- A "transaction" is counted per bank transaction PayFS records; whether debit
  (money-out) events count toward the quota is not documented.

All features are available on every plan; plans only change limits.

## PayFS vs SePay

| Aspect | PayFS | SePay |
|--------|-------|-------|
| Category | Bank-transaction webhooks only | Bank-transfer automation **plus** hosted gateway (VietQR, NAPAS QR, cards) |
| Banks (direct) | 3 via Open Banking; all via NAPAS (enterprise) | 23 banks flagged `supported` in `banks.json` (see `sepay/overview.md`) |
| Test environment | None | Test mode + gateway sandbox |
| Webhook auth | API key header (required) + HMAC over sorted-key JSON (recommended) | None / API key / HMAC over raw body / OAuth2 |
| Success response | Any 2xx within 30 s | 200/201 with `{"success": true}` within 30 s |
| Timestamps | `transaction_date` ISO 8601 UTC | `transactionDate` Vietnam local time |
| QR / checkout API | Not documented | VietQR image URLs, checkout form, order VAs |
| Refund API | None | VietinBank enterprise only |
| SDKs | None | Node.js, PHP, Laravel |
| Pricing | Subscription + per-transaction overage | See SePay pricing |

Choose PayFS for simple, flat-priced credit notifications on MB/ACB/OCB accounts (or all
banks via NAPAS for enterprises) when you generate your own VietQR. Choose SePay when
you need a sandbox, a hosted checkout, cards, or broader direct bank coverage.

## Unverified Marketing Claims

payfs.vn claims "15+ banks", "SDKs for Laravel, WordPress, NodeJS, Python, PHP, Java",
enabled 2FA, "ISO 27001 Certified", "PCI DSS Compliant", "SBV Approved", a free
sandbox, and mobile apps. The docs contradict several of these (3 Open Banking banks,
SDKs/2FA/mobile app "not released"). Rely on the docs, not the landing page.

## Support

- Docs: https://docs.payfs.vn/vi (index `/llms.txt`, full text `/llms-full.txt`; no `.md` pages, no English)
- Client Portal: https://portal.payfs.vn
- Technical support: support@payfs.vn; partnerships: info@payfs.vn
- Hotline/Zalo: 08228 85558
- Community: Telegram and Discord links on the docs home page

## Next Steps

- **Webhook verification, retries, idempotency:** `webhooks.md`
- **Order matching with VietQR and virtual accounts:** `payment-matching.md`
