# Creem Overview

Merchant of Record (MoR) for SaaS and digital products: Creem is the legal seller, handles payments, VAT/GST/sales tax, chargebacks and payouts.

Verified against https://docs.creem.io (llms.txt index, OpenAPI in `armitage-labs/creem`) on 2026-09-26.

## Core Capabilities

- Products: one-time or recurring (daily, monthly, 3-month, 6-month, yearly, or `custom` interval), free (`price: 0`), pay-what-you-want, seat/unit pricing, trials, metered usage
- Hosted checkout sessions (custom fields, discount codes, prefilled customer, metadata), payment links, embedded checkout
- Subscription lifecycle: trials, upgrades/downgrades, seat updates, pause/resume, scheduled or immediate cancel
- License keys (activate/validate/deactivate per instance), file downloads
- Customer portal (magic-link login), discounts, revenue splits, affiliates, customer credits, usage-based billing
- Webhooks signed with HMAC-SHA256 (`creem-signature`)
- TypeScript SDK with bundled MCP server, CLI, Next.js / Better Auth / Convex adapters

Sources: https://docs.creem.io/llms.txt, https://docs.creem.io/features/subscriptions/introduction

**Merchant of Record:**
- Creem calculates, collects and remits VAT/GST/sales tax in 190+ countries and issues compliant invoices
- Creem takes on chargeback handling as seller of record
- Source: https://docs.creem.io/merchant-of-record/what-is

**Payment methods (docs list, not exhaustive):** cards, Apple Pay, Google Pay; the checkout shows methods by product type, location, price and device. Source: https://docs.creem.io/merchant-of-record/finance/payment-methods

## Fees and Payouts

| Item | Amount | Source |
|------|--------|--------|
| Platform fee | 3.9% + 40¢ per successful transaction, no monthly fee | https://docs.creem.io/merchant-of-record/finance/payouts |
| Revenue splits | +2% of transaction | same |
| Affiliate platform | +2% of transaction | same |
| Abandoned cart recovery | +5% of the recovered transaction | same |
| Bank payout | 7 USD/EUR or 1% of payout, whichever is higher | same |
| USDC (Polygon) payout | 2% of payout volume | same |
| Chargeback | 25 USD/EUR each | https://docs.creem.io/merchant-of-record/finance/refunds-and-chargebacks |

- Platform fee is calculated on the total order value (tax included) and collected at order time.
- Payouts run on the 1st and 15th; minimum balance 50 USD/EUR; KYC/KYB and a payout account are required. Payments can be held 7-12 days for risk review.
- Refunds cost nothing extra, but the original transaction fee is not returned. Creem may refund within 60 days of purchase to prevent chargebacks, even under a "no refunds" policy.

Fees are dated facts; recheck https://www.creem.io/pricing before quoting them.

## Authentication

Every request sends the API key in the `x-api-key` header (OpenAPI security scheme `ApiKey`).

```bash
curl https://test-api.creem.io/v1/products/search \
  -H "x-api-key: $CREEM_API_KEY"
```

- Keys live in Dashboard → Developers (toggle **Test Mode** at the bottom of the sidebar for test keys)
- Key prefixes: `creem_test_` (test) and `creem_` (live), per https://creem.io/SKILL.md
- Keys can be full-access or scoped (`<resource>:read|write`, e.g. `products:read`, `webhooks:write`, `events:write`, `affiliates:read`). A call outside the key's scopes returns `403`. Source: https://docs.creem.io/ai/for-agents/mcp-server
- Keep keys server-side only: never in client bundles, public repos or logs. Source: https://docs.creem.io/api-reference/introduction
- Load keys from environment variables or a secret store; never paste them into chat, prompts or committed config

## Base URLs and Test Mode

| Environment | API base | SDK `server` |
|-------------|----------|--------------|
| Production | `https://api.creem.io/v1` | `"prod"` (default) |
| Test | `https://test-api.creem.io/v1` | `"test"` |

- Environments are fully isolated: separate keys, products, customers, webhooks and signing secrets. A test key against `api.creem.io` fails authentication (`401`/`403`).
- Hosted checkout URLs look like `https://checkout.creem.io/ch_...`.
- Source: https://docs.creem.io/getting-started/test-mode, https://docs.creem.io/api-reference/error-codes

**Test cards** (any future expiry, any CVC):

| Card | Result |
|------|--------|
| `4111 1111 1111 1111` | Success |
| `4507 9900 0000 0028` | Declined |
| `4507 9900 0000 0010` | Insufficient funds |
| `4507 9900 0000 0044` | Incorrect CVC |

Source: https://docs.creem.io/api-reference/introduction

## Money and Currency

- Amounts are integers in cents (`1999` = 19.99). Product `price` must be `0` or at least `100`.
- Product currencies (OpenAPI enum): `USD`, `EUR`.
- Tax: `tax_mode` `inclusive` | `exclusive`; `tax_category` `saas` | `digital-goods-service` | `ebooks`.
- Source: OpenAPI `CreateProductRequestEntity` (https://docs.creem.io/api-reference/endpoint/create-product)

## Errors

```json
{
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": 400,
  "error": "Bad Request",
  "message": ["product_id must be a string"],
  "timestamp": 1706889600000
}
```

| Status | Meaning |
|--------|---------|
| 400 | Validation error, malformed JSON, or duplicate resource |
| 401 | Missing API key |
| 403 | Invalid key, wrong environment, or missing scope |
| 404 | Resource not found (often: test ID used against production) |
| 429 | Rate limit exceeded |
| 500 | Internal error |

Log `trace_id` (not the payload) and include it in support requests. Source: https://docs.creem.io/api-reference/error-codes

## Rate Limits

The API documents `429` but publishes no numeric limit. Back off on `429`, and keep bulk jobs (exports, reconciliation) serialized. The SDK supports configurable retry strategies (`retryConfig`). Source: https://docs.creem.io/api-reference/introduction, https://docs.creem.io/code/sdks/typescript

## Idempotency

- `POST /v1/products` accepts an optional `Idempotency-Key` header: retries return the originally created product.
- Customer-credit credit/debit/transaction writes take an `idempotency_key` body field; usage events dedupe on `event_id`.
- Checkout creation takes `request_id`; the Next.js and Better Auth adapters describe `requestId` as the checkout idempotency key. The OpenAPI only says it tracks the request, so still guard duplicate purchases in your own order table.
- Sources: OpenAPI `POST /v1/products`, https://docs.creem.io/ai/for-agents/cli, https://docs.creem.io/code/sdks/nextjs

## Pagination

- Numbered lists: `page_number` + `page_size` query params (`/v1/products/search`, `/v1/customers/list`, `/v1/subscriptions/search`, `/v1/transactions/search`, `/v1/discounts/search`)
- Credits, meters and usage events use cursors (`limit`, `starting_after`, `ending_before`)
- SDK: `const page = await creem.products.search(1, 20); page.result.items; page.result.pagination`, or `for await` over pages
- `GET /v1/subscriptions/search` has no status or product filter; filter client-side
- Source: https://docs.creem.io/code/sdks/migrate-from-creem-io, https://docs.creem.io/features/subscriptions/managing

## Key Concepts

- **Metadata:** free-form key/value on checkouts; the webhook samples show checkout metadata copied onto the created subscription. Put your internal user/order ID here (adapters use `metadata.referenceId`).
- **`request_id`:** your reference for a checkout; echoed in the success redirect and on the checkout object.
- **Customer `external_id`:** your own ID on the Creem customer (unique per store; letters, digits, `_`, `-`); set via `POST /v1/customers` or `PATCH /v1/customers`.
- **`mode` field:** objects carry the environment they belong to (`test`, `prod`, `sandbox`, or `local` in samples).

## Going Live

1. Complete business details and KYC/KYB under Balance → Payout Account; Creem reviews the account (typically 24-48 h).
2. Recreate products and webhook endpoints in live mode (test resources do not carry over).
3. Swap to the live key and webhook secret, switch SDK `server` to `"prod"`.
4. Run one low-value live purchase and refund it.

Source: https://docs.creem.io/merchant-of-record/finance/payout-accounts, https://creem.io/SKILL.md

## Resources

- Docs: https://docs.creem.io (append `.md` to any page for raw markdown)
- LLM index: https://docs.creem.io/llms.txt (full: https://docs.creem.io/llms-full.txt)
- API reference: https://docs.creem.io/api-reference/introduction
- Source monorepo (SDK, CLI, adapters, docs, OpenAPI): https://github.com/armitage-labs/creem

## Next Steps

- **Products, checkout, redirects, discounts:** load `checkouts-and-products.md`
- **Subscriptions, refunds, portal, license keys:** load `subscriptions-and-licenses.md`
- **Webhooks:** load `webhooks.md`
- **SDK, adapters, CLI, MCP, agent files:** load `sdk-and-cli.md`
