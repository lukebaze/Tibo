# Polar Overview

Open-source payment & billing platform for software monetization, acting as Merchant of Record (MoR).

Verified against https://polar.sh/docs (llms.txt index) on 2026-09-26.

## Core Capabilities

**Platform Features:**
- Products: one-time or recurring (daily/weekly/monthly/yearly + interval count)
- Pricing: fixed, pay-what-you-want, free, metered (usage), seat-based, unit-based
- Subscription lifecycle: trials, plan changes with proration, pause/resume, dunning
- Automated benefits (license keys, GitHub, Discord, files, credits, feature flags, Slack)
- Customer Portal + Customer State API
- Webhooks (Standard Webhooks headers), Discord/Slack formatting
- Analytics, Cost Insights, multi-currency pricing (130+ currencies)
- TypeScript & Python SDKs, framework adapters, MCP server

**Merchant of Record:**
- Polar is the seller of record: calculates, collects and remits sales tax/VAT/GST
- B2B reverse charge, B2C tax collection, invoicing to customers
- Payouts via Stripe Connect Express

## Fees (https://polar.sh/docs/merchant-of-record/fees)

| Plan | Monthly | Per transaction |
|------|---------|-----------------|
| Starter | Free | 5% + 50¢ |
| Pro | $20 | 3.8% + 40¢ |
| Growth | $100 | 3.6% + 35¢ |
| Scale | $400 | 3.4% + 30¢ |

- **Early Member** (orgs created before 2026-05-27): 4% + 40¢, +0.5% on subscription payments; lost on upgrade
- +1.5% for international (non-US) cards on every plan
- Disputes: $15 each; refunds don't return the original transaction fee
- Payouts: Stripe fees only ($2/month active payouts, 0.25% + $0.25 per payout, FX 0.25–1%)

## Authentication

### Organization Access Tokens (OAT) - recommended

**For:** Server-side API access, scoped to one organization

**Create:** Organization Settings → Developers → New token

```bash
Authorization: Bearer polar_oat_xxxxxxxxxxxxxxxx
```

**Security:** Never expose client-side. Leaked tokens are auto-revoked via GitHub Secret Scanning.

### OAuth 2.0 (partner integrations)

**For:** Third-party apps acting on behalf of Polar users

- Authorize: `https://polar.sh/oauth2/authorize`
- Token: `https://api.polar.sh/v1/oauth2/token` (also `/v1/oauth2/revoke`, `/introspect`, `/userinfo`)
- Scopes are space-separated, e.g. `openid email products:read checkouts:write`
- Tokens are user-scoped; the user can restrict them to specific organizations

**Resource scopes** follow `<resource>:read|write`: `products`, `checkouts`, `checkout_links`, `orders`, `subscriptions`, `customers`, `customer_sessions:write`, `benefits`, `discounts`, `refunds`, `license_keys`, `events`, `meters`, `customer_meters:read`, `webhooks`, `files`, `metrics`, `organizations`.

### Customer Sessions

**For:** Customer-facing flows (never put an OAT in the browser)

- Create server-side via `POST /v1/customer-sessions/` with `customer_id` or `external_customer_id`
- Returns a short-lived customer access `token` and a pre-authenticated `customer_portal_url`
- Token works only against the Customer Portal API (`/v1/customer-portal/*`)

## Base URLs

**Production:**
- Dashboard: `https://polar.sh`
- API: `https://api.polar.sh/v1/`

**Sandbox:**
- Dashboard: `https://sandbox.polar.sh`
- API: `https://sandbox-api.polar.sh/v1/`

**SDK Configuration (stable `@polar-sh/sdk` 0.x):**
```typescript
import { Polar } from "@polar-sh/sdk";

const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  server: "sandbox" // default "production"
});
```

## API Versioning

- Date-based versions (`YYYY-MM`), released first week of Jan/Apr/Jul/Oct
- Three live versions: Current (default), Deprecated (removed next release), Next (unstable)
- `2026-04` is Current; `2026-10` becomes Current on 2026-10-01
- Pin requests with header `Polar-Version: 2026-04`; without it, requests float to Current
- Webhook endpoints pin separately via `api_version`; deliveries carry `webhook-api-version`
- Unknown or removed version → `404`

## Rate Limits

- Production: **500 requests/minute** per organization/customer/OAuth2 client
- Sandbox: **100 requests/minute**
- Unauthenticated license key validate/activate/deactivate: **3 requests/second**

**Response:** HTTP 429 with `Retry-After` header (seconds)

```javascript
if (response.status === 429) {
  const retryAfter = Number(response.headers.get('Retry-After') ?? 1);
  await sleep(retryAfter * 1000);
  return retry();
}
```

## Pagination

- Query params: `page` (from 1), `limit` (default 10, max 100)
- Response: `items` + `pagination: { total_count, max_page }`
- SDK list calls return an async iterable of pages

## Key Concepts

### External Customer ID
- Map your user IDs to Polar customers via `external_customer_id`
- Set at checkout or on customer create; exposed as `customer.external_id` in webhooks
- Look up with `GET /v1/customers/external/{external_id}` and `/state`

### Customer State
- One call (`GET /v1/customers/external/{external_id}/state`) or one webhook (`customer.state_changed`)
- Contains customer data, `active_subscriptions`, `granted_benefits`, `active_meters`
- Simplest way to gate access in your app

### Metadata
- Key-value data on products, checkouts, customers, subscriptions, orders
- Keys max 40 characters; checkout metadata is copied to the resulting order/subscription

### Billing Reasons
Track order types via `billing_reason`:
- `purchase` - One-time product
- `subscription_create` - New subscription
- `subscription_cycle` - Renewal
- `subscription_update` - Plan change
- `subscription_meter_cycle` - Metered usage settlement on a separate meter cycle

## Environments

**Sandbox:**
- Fully separate server, accounts, organizations and tokens (production tokens don't work)
- Test payments with Stripe test cards, e.g. `4242 4242 4242 4242`, any future expiry, any CVC
- Customer emails are delivered only to members of your organization

## SDKs

**Official SDKs:**
- TypeScript/JavaScript: `@polar-sh/sdk` (stable 0.x on npm `latest`; 1.0 in public preview on `next`)
- Python: `polar-sdk` (stable 0.x; 1.0 preview via `pip install --pre polar-sdk`)
- PHP and Go SDKs: repositories archived, no longer listed in official docs

**Framework Adapters (maintained):**
- Next.js `@polar-sh/nextjs`, Nuxt `@polar-sh/nuxt`, TanStack Start `@polar-sh/tanstack-start`
- BetterAuth `@polar-sh/better-auth`
- Laravel `danestves/laravel-polar` (community-maintained, not officially supported)

**Deprecated adapters** (use the SDK directly): Astro, Deno, Elysia, Express, Fastify, Hono, Remix, Supabase, SvelteKit

## Support & Resources

- Docs: https://polar.sh/docs
- API Reference: https://polar.sh/docs/api-reference
- LLMs.txt: https://polar.sh/docs/llms.txt (full: https://polar.sh/docs/llms-full.txt)
- API Changelog: https://polar.sh/docs/changelog/api
- GitHub: https://github.com/polarsource/polar

## Next Steps

- **For products:** Load `products.md`
- **For checkout:** Load `checkouts.md`
- **For subscriptions:** Load `subscriptions.md`
- **For webhooks:** Load `webhooks.md`
- **For benefits:** Load `benefits.md`
- **For SDK usage:** Load `sdk.md`
