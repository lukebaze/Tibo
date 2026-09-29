# Multi-Provider Order Management Patterns

Production patterns for managing orders across multiple payment providers (Polar + SePay), currency handling, commission systems, and revenue tracking.

## Order Schema Design

### Unified Orders Table
```typescript
// db/schema/orders.ts
import { pgTable, uuid, text, integer, numeric, timestamp, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  email: text('email').notNull(),

  // Product info
  productType: text('product_type').notNull(), // 'engineer_kit', 'marketing_kit', 'combo', 'team_*'
  quantity: integer('quantity').default(1),

  // Pricing (stored in provider's currency)
  amount: integer('amount').notNull(),           // Final amount after discounts
  originalAmount: integer('original_amount'),    // Before any discounts
  currency: text('currency').default('USD'),     // ISO 4217 code, e.g. 'USD', 'EUR' or 'VND'

  // Status
  status: text('status').default('pending'),     // pending, completed, failed, refund_processing, refund_pending, refunded

  // Provider info
  paymentProvider: text('payment_provider').notNull(), // PaymentProvider (see webhook section)
  // External payment ID used for refunds: Creem tran_..., Dodo pay_..., Paddle txn_...,
  // PayPal capture ID (not the order ID), Lemon Squeezy 'order:<id>' or 'invoice:<id>'
  paymentId: text('payment_id'),

  // Referral tracking
  referredBy: uuid('referred_by').references(() => users.id),
  discountAmount: integer('discount_amount').default(0),
  discountRate: numeric('discount_rate', { precision: 5, scale: 2 }),

  // Audit trail (JSON)
  metadata: text('metadata'),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

### Provider-Specific Metadata
```typescript
// Polar order metadata
interface PolarOrderMetadata {
  originalAmount: number;
  couponCode?: string;
  couponDiscountAmount?: number;
  referralCode?: string;
  referralDiscountAmount?: number;
  referrerId?: string;
  githubUsername: string;
  polarDiscountId?: string;
  polarDiscountSynced?: boolean;
  polarDiscountSyncAction?: 'decremented' | 'deleted' | 'already_deleted';
  polarDiscountSyncedAt?: string;
  isTeamPurchase?: boolean;
  teamId?: string;
}

// SePay order metadata
interface SepayOrderMetadata {
  originalAmount: number;
  couponCode?: string;
  couponDiscountAmount?: number;
  couponId?: string;              // For Polar discount sync
  referralCode?: string;
  referralDiscountAmount?: number;
  referrerId?: string;
  githubUsername: string;
  vatInvoiceRequested?: boolean;
  encryptedTaxId?: string;
  // Added by webhook
  gateway?: string;
  transactionDate?: string;
  transactionId?: number;
  transferAmount?: number;
  matchMethod?: string;
  content?: string;
}
```

## Currency Conversion

### Multi-Layer Fallback Architecture
```typescript
// lib/currency.ts
const EXCHANGE_RATE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const FALLBACK_RATES = {
  VND_TO_USD: 24500,  // Conservative estimate
  USD_TO_VND: 24500,
};

interface ExchangeRateCache {
  rates: { VND: number; USD: number };
  timestamp: number;
  source: 'api' | 'cached' | 'expired' | 'fallback';
}

let rateCache: ExchangeRateCache | null = null;

export async function getExchangeRates(): Promise<ExchangeRateCache> {
  const now = Date.now();

  // Layer 1: Fresh cache (< 1 hour)
  if (rateCache && now - rateCache.timestamp < EXCHANGE_RATE_CACHE_TTL) {
    return { ...rateCache, source: 'cached' };
  }

  // Layer 2: Live API
  try {
    const response = await fetch(
      'https://api.exchangerate-api.com/v4/latest/USD',
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await response.json();

    rateCache = {
      rates: { VND: data.rates.VND, USD: 1 },
      timestamp: now,
      source: 'api',
    };
    return rateCache;

  } catch (error) {
    console.warn('Exchange rate API failed:', error);

    // Layer 3: Expired cache (better than nothing)
    if (rateCache) {
      return { ...rateCache, source: 'expired' };
    }

    // Layer 4: Hardcoded fallback
    return {
      rates: { VND: FALLBACK_RATES.VND_TO_USD, USD: 1 },
      timestamp: now,
      source: 'fallback',
    };
  }
}

export async function convertVndToUsd(vndAmount: number): Promise<{
  usdCents: number;
  rate: number;
  source: string;
}> {
  const { rates, source } = await getExchangeRates();
  const usdCents = Math.round((vndAmount / rates.VND) * 100);
  return { usdCents, rate: rates.VND, source };
}

export async function convertUsdToVnd(usdCents: number): Promise<{
  vndAmount: number;
  rate: number;
  source: string;
}> {
  const { rates, source } = await getExchangeRates();
  const vndAmount = Math.round((usdCents / 100) * rates.VND);
  return { vndAmount, rate: rates.VND, source };
}
```

### Normalizing Revenue to USD
```typescript
// For reporting/dashboard - normalize all revenue to USD cents
export async function normalizeOrderToUsd(order: Order): Promise<{
  amountUsdCents: number;
  originalAmountUsdCents: number;
  conversionSource: string;
}> {
  if (order.currency === 'USD') {
    return {
      amountUsdCents: order.amount,
      originalAmountUsdCents: order.originalAmount || order.amount,
      conversionSource: 'native',
    };
  }

  // VND order
  const conversion = await convertVndToUsd(order.amount);
  const originalConversion = order.originalAmount
    ? await convertVndToUsd(order.originalAmount)
    : conversion;

  return {
    amountUsdCents: conversion.usdCents,
    originalAmountUsdCents: originalConversion.usdCents,
    conversionSource: conversion.source,
  };
}
```

## Commission System

### Commission Schema
```typescript
// db/schema/commissions.ts
export const commissions = pgTable('commissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').references(() => orders.id).notNull(),
  referrerId: uuid('referrer_id').references(() => users.id).notNull(),
  referredUserId: uuid('referred_user_id').references(() => users.id).notNull(),
  referralCodeId: uuid('referral_code_id').references(() => referralCodes.id),

  // Amount in original currency
  orderAmount: integer('order_amount').notNull(),      // Base amount for commission
  orderCurrency: text('order_currency').notNull(),     // 'USD' or 'VND'

  // Commission calculation
  commissionRate: numeric('commission_rate', { precision: 5, scale: 4 }).default('0.20'), // 20%
  commissionAmount: integer('commission_amount').notNull(),
  commissionCurrency: text('commission_currency').notNull(),

  // Normalized USD (for tier tracking)
  orderAmountUsdCents: integer('order_amount_usd_cents'),
  commissionAmountUsdCents: integer('commission_amount_usd_cents'),
  exchangeRateSource: text('exchange_rate_source'),

  // Status
  status: text('status').default('pending'),  // pending, approved, paid, cancelled

  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  approvedAt: timestamp('approved_at'),
  paidAt: timestamp('paid_at'),
  cancelledAt: timestamp('cancelled_at'),
});
```

### Creating Commission (Multi-Currency)
```typescript
// lib/commissions.ts
export async function createCommission(params: {
  orderId: string;
  referrerId: string;
  referredUserId: string;
  referralCodeId: string;
  orderAmount: number;
  orderCurrency: 'USD' | 'VND';
  commissionRate?: number;
}): Promise<Commission> {
  const rate = params.commissionRate || 0.20; // Default 20%

  // Calculate commission in original currency
  const commissionAmount = Math.round(params.orderAmount * rate);

  // Convert to USD for tier tracking
  let orderAmountUsdCents: number;
  let commissionAmountUsdCents: number;
  let exchangeRateSource: string;

  if (params.orderCurrency === 'USD') {
    orderAmountUsdCents = params.orderAmount;
    commissionAmountUsdCents = commissionAmount;
    exchangeRateSource = 'native';
  } else {
    const conversion = await convertVndToUsd(params.orderAmount);
    orderAmountUsdCents = conversion.usdCents;
    commissionAmountUsdCents = Math.round(conversion.usdCents * rate);
    exchangeRateSource = conversion.source;
  }

  const [commission] = await db.insert(commissions).values({
    orderId: params.orderId,
    referrerId: params.referrerId,
    referredUserId: params.referredUserId,
    referralCodeId: params.referralCodeId,
    orderAmount: params.orderAmount,
    orderCurrency: params.orderCurrency,
    commissionRate: String(rate),
    commissionAmount,
    commissionCurrency: params.orderCurrency,
    orderAmountUsdCents,
    commissionAmountUsdCents,
    exchangeRateSource,
    status: 'pending',
  }).returning();

  // Update referrer's tier based on USD revenue
  await updateReferrerTier(params.referrerId, orderAmountUsdCents);

  return commission;
}
```

### Referrer Tier System
```typescript
// lib/referrals.ts
const TIER_THRESHOLDS = [
  { tier: 'bronze', minRevenue: 0, commissionRate: 0.20 },
  { tier: 'silver', minRevenue: 50000, commissionRate: 0.25 },     // $500
  { tier: 'gold', minRevenue: 150000, commissionRate: 0.30 },      // $1,500
  { tier: 'platinum', minRevenue: 500000, commissionRate: 0.35 },  // $5,000
];

export async function updateReferrerTier(
  referrerId: string,
  newRevenueUsdCents: number
): Promise<void> {
  const referrer = await db.select()
    .from(users)
    .where(eq(users.id, referrerId))
    .limit(1);

  if (!referrer[0]) return;

  const currentRevenue = referrer[0].referralRevenueUsdCents || 0;
  const totalRevenue = currentRevenue + newRevenueUsdCents;

  // Determine new tier
  let newTier = 'bronze';
  let newRate = 0.20;

  for (const threshold of TIER_THRESHOLDS) {
    if (totalRevenue >= threshold.minRevenue) {
      newTier = threshold.tier;
      newRate = threshold.commissionRate;
    }
  }

  // Update if tier changed
  if (referrer[0].referralTier !== newTier) {
    await db.update(users)
      .set({
        referralTier: newTier,
        referralCommissionRate: String(newRate),
        referralRevenueUsdCents: totalRevenue,
        updatedAt: new Date(),
      })
      .where(eq(users.id, referrerId));

    // Send tier upgrade notification
    if (TIER_THRESHOLDS.findIndex(t => t.tier === newTier) >
        TIER_THRESHOLDS.findIndex(t => t.tier === referrer[0].referralTier)) {
      await sendTierUpgradeEmail(referrerId, newTier, newRate);
    }
  } else {
    // Just update revenue
    await db.update(users)
      .set({
        referralRevenueUsdCents: totalRevenue,
        updatedAt: new Date(),
      })
      .where(eq(users.id, referrerId));
  }
}
```

## Revenue Tracking

### Combined Provider Revenue
```typescript
// lib/revenue.ts
export async function getTotalRevenue(options?: {
  startDate?: Date;
  endDate?: Date;
}): Promise<{
  totalUsdCents: number;
  byProvider: Record<string, number>; // keyed by paymentProvider
  orderCount: number;
  averageOrderValueCents: number;
}> {
  // One and(...) condition: chaining .where() replaces the earlier condition
  const completedOrders = await db.select()
    .from(orders)
    .where(and(
      eq(orders.status, 'completed'),
      options?.startDate ? gte(orders.createdAt, options.startDate) : undefined,
      options?.endDate ? lte(orders.createdAt, options.endDate) : undefined,
    ));

  let totalUsdCents = 0;
  const byProvider: Record<string, number> = {};

  for (const order of completedOrders) {
    const normalized = await normalizeOrderToUsd(order);

    totalUsdCents += normalized.amountUsdCents;
    byProvider[order.paymentProvider] = (byProvider[order.paymentProvider] ?? 0) + normalized.amountUsdCents;
  }

  return {
    totalUsdCents,
    byProvider,
    orderCount: completedOrders.length,
    averageOrderValueCents: completedOrders.length > 0
      ? Math.round(totalUsdCents / completedOrders.length)
      : 0,
  };
}
```

### Maintainer Revenue Calculation
```typescript
// lib/maintainer-revenue.ts
// Calculate actual payout after fees and costs

interface MaintainerRevenue {
  grossRevenue: number;      // Total received
  platformFees: number;      // Provider fees (MoR and card processors)
  operatingCosts: number;    // Proportional costs
  taxDeduction: number;      // 17% tax
  netPayout: number;         // Final amount
  currency: 'USD';
}

export async function calculateMaintainerRevenue(
  productIds: string[],
  dateRange: { start: Date; end: Date }
): Promise<MaintainerRevenue> {
  // Get orders for these products
  const productOrders = await db.select()
    .from(orders)
    .where(and(
      eq(orders.status, 'completed'),
      inArray(orders.productType, productIds),
      gte(orders.createdAt, dateRange.start),
      lte(orders.createdAt, dateRange.end)
    ));

  let grossRevenue = 0;
  let platformFees = 0;

  for (const order of productOrders) {
    const normalized = await normalizeOrderToUsd(order);
    grossRevenue += normalized.amountUsdCents;

    if (order.paymentProvider === 'polar') {
      const fees = calculatePolarFees(normalized.amountUsdCents);
      platformFees += fees.totalFee;
    }
    if (order.paymentProvider === 'creem') {
      // Creem: 3.9% + 40¢ on the tax-inclusive total (recheck https://www.creem.io/pricing)
      platformFees += Math.round(normalized.amountUsdCents * 0.039) + 40;
    }
    if (order.paymentProvider === 'dodo') {
      // Dodo Payments: 4% + 40¢ base on the tax-inclusive total; +1.5% international,
      // +0.5% subscriptions (checked 2026-09-26, recheck https://dodopayments.com/pricing)
      platformFees += Math.round(normalized.amountUsdCents * 0.04) + 40;
    }
    if (order.paymentProvider === 'lemonsqueezy') {
      // Lemon Squeezy: 5% + 50¢ on the tax-inclusive total; +1.5% non-US, +1.5% PayPal,
      // +0.5% subscriptions (recheck https://docs.lemonsqueezy.com/help/getting-started/fees)
      platformFees += Math.round(normalized.amountUsdCents * 0.05) + 50;
    }
    if (order.paymentProvider === 'paddle') {
      // Paddle: 5% + 50¢ per checkout transaction (checked 2026-09-26, recheck https://www.paddle.com/pricing).
      // Prefer the transaction's payout totals (details.payout_totals.fee) when stored.
      platformFees += Math.round(normalized.amountUsdCents * 0.05) + 50;
    }
    if (order.paymentProvider === 'paypal') {
      // PayPal: prefer the real fee from the capture (seller_receivable_breakdown.paypal_fee,
      // stored at capture time). Fallback estimate, US PayPal Checkout as of 2026-09-01:
      // 3.49% + 49¢, +1.50% international (recheck https://www.paypal.com/us/business/paypal-business-fees)
      platformFees += Math.round(normalized.amountUsdCents * 0.0349) + 49;
    }
    // SePay and PayFS have no per-payment platform fees (direct bank transfer);
    // PayFS charges a flat monthly plan plus overage, so book it as an operating cost.
  }

  // Proportional operating costs (hosting, services, etc.)
  const monthlyOperatingCosts = 50000; // $500/month in cents
  const totalMonthlyRevenue = await getTotalRevenue({
    startDate: dateRange.start,
    endDate: dateRange.end,
  });
  const costRatio = grossRevenue / (totalMonthlyRevenue.totalUsdCents || 1);
  const operatingCosts = Math.round(monthlyOperatingCosts * costRatio);

  // Tax deduction (17%)
  const afterCosts = grossRevenue - platformFees - operatingCosts;
  const taxDeduction = Math.round(afterCosts * 0.17);

  const netPayout = afterCosts - taxDeduction;

  return {
    grossRevenue,
    platformFees,
    operatingCosts,
    taxDeduction,
    netPayout,
    currency: 'USD',
  };
}
```

## Refund Handling

### Unified Refund Flow
```typescript
// lib/refunds.ts
export async function processRefund(
  orderId: string,
  options: { keepAccess?: boolean; reason?: string }
): Promise<{ success: boolean; pending?: boolean; error?: string }> {
  // Claim the order atomically so two concurrent requests cannot refund it twice
  const order = await db.update(orders)
    .set({ status: 'refund_processing', updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.status, 'completed')))
    .returning();

  if (!order[0]) {
    return { success: false, error: 'Order not found or not refundable' };
  }

  let issued = false; // true once the provider accepted the refund request
  // New key per refund attempt: the claim above stops concurrent attempts, SDK retries
  // inside this call reuse it, and a retry after a confirmed failure gets a fresh key.
  const refundKey = `${orderId}:refund:${crypto.randomUUID()}`;
  try {
    // 1. Process refund with payment provider. Async and manual refunds set `pending`.
    let pending = false;
    if (order[0].paymentProvider === 'polar') {
      // Polar Refunds API: amount (minor units) is required. Subscription refunds do not
      // revoke benefits; cancel the subscription separately.
      await polar.refunds.create({
        orderId: order[0].paymentId!,
        reason: 'customer_request',
        amount: order[0].amount,
        revokeBenefits: !options.keepAccess, // one-time orders only
      });
    } else if (order[0].paymentProvider === 'stripe') {
      // Stripe: paymentId is the PaymentIntent ID (pi_...). Card refunds are usually
      // `succeeded` at once; others stay `pending` until charge.refund.updated.
      const refund = await stripe.refunds.create(
        { payment_intent: order[0].paymentId!, reason: 'requested_by_customer' },
        { idempotencyKey: refundKey },
      );
      pending = refund.status !== 'succeeded';
    } else if (order[0].paymentProvider === 'creem') {
      // Creem Refunds API is full-refund only (POST /v1/refunds { transaction_id }).
      // Partial refunds are dashboard-only. paymentId must be the transaction ID
      // (tran_...), e.g. from subscription.last_transaction_id or
      // GET /v1/transactions/search?order_id=. A refund does not cancel the
      // subscription; cancel it separately when access should end.
      await creem.transactions.refund({ transactionId: order[0].paymentId! });
    } else if (order[0].paymentProvider === 'dodo') {
      // Dodo Payments refunds are async: 30-day window, one pending/review refund per
      // payment, paymentId is the payment ID (pay_...). Confirm on refund.succeeded.
      // A refund does not cancel the subscription; cancel it separately.
      await dodo.refunds.create({ payment_id: order[0].paymentId!, reason: 'customer_request' });
      pending = true;
    } else if (order[0].paymentProvider === 'lemonsqueezy') {
      // Lemon Squeezy: one-time orders refund via POST /v1/orders/:id/refund, subscription
      // charges via POST /v1/subscription-invoices/:id/refund; amount in minor units.
      // A refund does not cancel the subscription, and the platform fee is not returned.
      const [kind, id] = order[0].paymentId!.split(':');
      const { error } = kind === 'invoice'
        ? await issueSubscriptionInvoiceRefund(id, order[0].amount)
        : await issueOrderRefund(id, order[0].amount);
      if (error) throw error; // the JS SDK returns errors instead of throwing
    } else if (order[0].paymentProvider === 'paddle') {
      // Paddle refunds are adjustments against a `completed` transaction (txn_...). Live
      // refunds usually start as `pending_approval`; confirm on adjustment.updated.
      // Partial refunds pass `items`. A refund does not cancel the subscription.
      const adjustment = await paddle.adjustments.create({
        action: 'refund',
        type: 'full',
        transactionId: order[0].paymentId!,
        reason: options.reason || 'customer_request',
      });
      if (adjustment.status === 'rejected') {
        throw Object.assign(new Error('Paddle rejected the refund'), { definite: true });
      }
      pending = adjustment.status !== 'approved';
    } else if (order[0].paymentProvider === 'paypal') {
      // PayPal Payments v2: refund the CAPTURE (paymentId = capture ID, not the order ID).
      // Amounts are decimal strings; HUF/JPY/TWD are zero-decimal. One PayPal-Request-Id
      // per refund so a retry after a timeout does not refund twice.
      const currency = order[0].currency ?? 'USD';
      const zeroDecimal = ['HUF', 'JPY', 'TWD'].includes(currency);
      await paypalPayments.refundCapturedPayment({
        captureId: order[0].paymentId!,
        paypalRequestId: refundKey,
        body: {
          amount: {
            currencyCode: currency,
            value: zeroDecimal ? String(order[0].amount) : (order[0].amount / 100).toFixed(2),
          },
        },
      });
    } else if (order[0].paymentProvider === 'payfs') {
      // PayFS has no refund API: refund by manual bank transfer from your account,
      // then reconcile it with the transaction.debit webhook if subscribed.
      console.log(`Manual refund needed for PayFS order ${orderId}`);
      pending = true; // an admin confirms after the transfer
    } else if (order[0].paymentProvider === 'sepay') {
      // SePay: manual bank refund, except VietinBank enterprise accounts that can use
      // Refunds API v2 (POST /v2/transactions/{id}/refund with X-Idempotency-Key)
      // Otherwise mark the order and let an admin handle the bank transfer
      console.log(`Manual refund needed for SePay order ${orderId}`);
      pending = true; // an admin confirms after the transfer
    } else {
      throw Object.assign(new Error(`Unsupported provider: ${order[0].paymentProvider}`), { definite: true });
    }
    issued = true;

    if (pending) {
      // Finish steps 2-4 when the provider's refund webhook (or the admin, for manual
      // bank refunds) confirms the refund. On a failed or rejected refund, set the
      // order back to 'completed' so it can be refunded again.
      await db.update(orders)
        .set({ status: 'refund_pending', updatedAt: new Date() })
        .where(eq(orders.id, orderId));
      return { success: true, pending: true };
    }

    // 2. Update order status
    await db.update(orders)
      .set({
        status: 'refunded',
        metadata: JSON.stringify({
          ...JSON.parse(order[0].metadata || '{}'),
          refundedAt: new Date().toISOString(),
          refundReason: options.reason,
          keepAccess: options.keepAccess,
        }),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    // 3. Cancel commission (if any)
    if (order[0].referredBy) {
      await db.update(commissions)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
        })
        .where(eq(commissions.orderId, orderId));

      // Recalculate referrer tier
      await recalculateReferrerTier(order[0].referredBy);
    }

    // 4. Revoke access (unless keepAccess)
    if (!options.keepAccess) {
      const metadata = JSON.parse(order[0].metadata || '{}');
      if (metadata.githubUsername) {
        await revokeGitHubAccess(metadata.githubUsername, order[0].productType);
      }

      await db.update(licenses)
        .set({ isActive: false, revokedAt: new Date() })
        .where(eq(licenses.orderId, orderId));
    }

    return { success: true };

  } catch (error) {
    console.error('Refund failed:', error);
    // Release the claim only on a definite rejection (4xx or explicit). A timeout or 5xx
    // may still have refunded, so the order stays 'refund_processing' for reconciliation.
    const status = (error as { statusCode?: number; status?: number })?.statusCode
      ?? (error as { status?: number })?.status;
    const definite = (error as { definite?: boolean })?.definite === true ||
      (typeof status === 'number' && status >= 400 && status < 500);
    if (!issued && definite) {
      await db.update(orders)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.status, 'refund_processing')));
    }
    return { success: false, error: error instanceof Error ? error.message : 'Refund failed' };
  }
}
```

## Webhook Event Tracking

### Unified Webhook Events Table
```typescript
// db/schema/webhook-events.ts
export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),          // PaymentProvider
  eventType: text('event_type').notNull(),       // Event type/name
  // Idempotency key, unique together with provider:
  // - Polar, Dodo Payments: `webhook-id` header (payloads have no top-level id)
  // - SePay transaction `id`; PayFS `transaction_id` (orders: `order_id:status`)
  // - Stripe `event.id`; Creem top-level `id` (evt_...)
  // - Paddle `event_id` (not `notification_id`, which is per delivery)
  // - PayPal top-level event `id` (WH-...; not paypal-transmission-id, per delivery)
  // - Lemon Squeezy has no event id:
  //   `${meta.event_name}:${data.type}:${data.id}:${data.attributes.updated_at}`
  eventId: text('event_id').notNull(),
  payload: text('payload').notNull(),            // Raw JSON payload
  processed: boolean('processed').default(false),
  processedAt: timestamp('processed_at'),
  claimedAt: timestamp('claimed_at').defaultNow(), // start of the latest attempt
  error: text('error'),                          // Error message if failed
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('uq_webhook_events_provider_event').on(t.provider, t.eventId),
]);

// Partial index for unprocessed events
// CREATE INDEX idx_webhook_events_unprocessed ON webhook_events (created_at)
//   WHERE processed = false;
```

### Idempotent Webhook Processing
```typescript
// lib/webhooks.ts
export type PaymentProvider =
  | 'polar' | 'sepay' | 'payfs' | 'stripe' | 'creem'
  | 'dodo' | 'lemonsqueezy' | 'paddle' | 'paypal';

export async function processWebhookIdempotently<T>(
  provider: PaymentProvider,
  eventId: string,
  eventType: string,
  payload: string,
  handler: () => Promise<T>
): Promise<{ processed: boolean; duplicate?: boolean; result?: T; error?: string }> {
  const eventMatch = and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId));

  // Claim the event atomically; the unique index makes concurrent retries lose the race
  let claimed = await db.insert(webhookEvents).values({
    id: crypto.randomUUID(),
    provider,
    eventType,
    eventId,
    payload,
    processed: false,
  }).onConflictDoNothing().returning({ id: webhookEvents.id });

  if (claimed.length === 0) {
    // Seen before. Reclaim it only if the earlier attempt failed or went stale
    // (crashed mid-handler); a live attempt or a processed event is a duplicate.
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    claimed = await db.update(webhookEvents)
      .set({ claimedAt: new Date(), error: null })
      .where(and(
        eventMatch,
        eq(webhookEvents.processed, false),
        or(isNotNull(webhookEvents.error), lt(webhookEvents.claimedAt, staleBefore)),
      ))
      .returning({ id: webhookEvents.id });

    if (claimed.length === 0) {
      return { processed: false, duplicate: true };
    }
  }

  try {
    const result = await handler();

    await db.update(webhookEvents)
      .set({ processed: true, processedAt: new Date() })
      .where(eventMatch);

    return { processed: true, result };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Keep processed = false so the provider's retry can reclaim the event
    await db.update(webhookEvents)
      .set({ error: errorMessage })
      .where(eventMatch);

    // The route must answer 5xx here so the provider retries delivery
    return { processed: false, error: errorMessage };
  }
}

// In the route: `if (outcome.error) return new Response('retry', { status: 500 });`
// Duplicates and successes return 2xx.
```

## Discount Cross-Provider Sync

### Syncing SePay Usage to Polar
```typescript
// lib/polar-discount-sync.ts
// When a Polar discount is used via SePay, decrement Polar's redemption count

export async function syncDiscountRedemptionToPolar(
  orderId: string,
  discountId: string,
  discountCode: string
): Promise<{ success: boolean; action: string }> {
  const order = await db.select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order[0]) {
    return { success: false, action: 'order_not_found' };
  }

  const metadata = order[0].metadata ? JSON.parse(order[0].metadata) : {};

  // Idempotency check
  if (metadata.polarDiscountSynced) {
    return { success: true, action: 'already_synced' };
  }

  const polar = getPolar();

  try {
    const discount = await polar.discounts.get({ id: discountId });

    // Skip if unlimited redemptions
    if (discount.maxRedemptions === null) {
      await markSynced(orderId, 'skipped_unlimited');
      return { success: true, action: 'skipped_unlimited' };
    }

    const currentMax = discount.maxRedemptions;

    if (currentMax <= 1) {
      // Delete discount if this was last use
      await polar.discounts.delete({ id: discountId });
      await markSynced(orderId, 'deleted');
      return { success: true, action: 'deleted' };
    } else {
      // Decrement max redemptions
      await polar.discounts.update({
        id: discountId,
        discountUpdate: { maxRedemptions: currentMax - 1 },
      });
      await markSynced(orderId, 'decremented');
      return { success: true, action: 'decremented' };
    }

  } catch (error: any) {
    if (error.statusCode === 404) {
      await markSynced(orderId, 'already_deleted');
      return { success: true, action: 'already_deleted' };
    }
    throw error;
  }
}

async function markSynced(orderId: string, action: string) {
  const order = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const metadata = order[0].metadata ? JSON.parse(order[0].metadata) : {};

  await db.update(orders)
    .set({
      metadata: JSON.stringify({
        ...metadata,
        polarDiscountSynced: true,
        polarDiscountSyncAction: action,
        polarDiscountSyncedAt: new Date().toISOString(),
      }),
    })
    .where(eq(orders.id, orderId));
}

// Retry wrapper with exponential backoff
export async function syncWithRetry(
  orderId: string,
  discountId: string,
  discountCode: string,
  attempt: number = 1
): Promise<{ success: boolean; action: string }> {
  const MAX_ATTEMPTS = 3;

  try {
    return await syncDiscountRedemptionToPolar(orderId, discountId, discountCode);
  } catch (error) {
    if (attempt < MAX_ATTEMPTS) {
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
      await sleep(delay);
      return syncWithRetry(orderId, discountId, discountCode, attempt + 1);
    }
    throw error;
  }
}
```

## Admin Order Management API

### Order Listing with Provider Info
```typescript
// app/api/admin/orders/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const provider = searchParams.get('provider'); // PaymentProvider | null
  const status = searchParams.get('status');

  let query = db.select()
    .from(orders)
    .orderBy(desc(orders.createdAt));

  // One and(...) condition: chaining .where() replaces the earlier condition
  query = query.where(and(
    provider ? eq(orders.paymentProvider, provider) : undefined,
    status ? eq(orders.status, status) : undefined,
  ));

  const results = await query
    .limit(limit)
    .offset((page - 1) * limit);

  // Normalize amounts to USD for display
  const ordersWithNormalized = await Promise.all(
    results.map(async (order) => {
      const normalized = await normalizeOrderToUsd(order);
      return {
        ...order,
        amountUsdCents: normalized.amountUsdCents,
        displayAmount: order.currency === 'VND'
          ? formatVND(order.amount)
          : formatUSD(order.amount),
      };
    })
  );

  return NextResponse.json({
    orders: ordersWithNormalized,
    pagination: {
      page,
      limit,
      hasMore: results.length === limit,
    },
  });
}
```

## Best Practices Summary

### 1. Currency Handling
- Store amounts in original currency (USD or VND)
- Always store currency code with amount
- Use multi-layer fallback for exchange rates
- Convert to USD for reporting/comparison

### 2. Order Management
- Use unified orders table for both providers
- Store provider-specific data in metadata JSON
- Normalize to USD for tier calculations

### 3. Commission System
- Store original currency and USD equivalent
- Calculate tier based on USD values
- Handle currency conversion in commission creation

### 4. Webhook Processing
- Use idempotency keys for deduplication
- Record event before processing
- Return 2xx for processed or duplicate events and 5xx for handler failures, so the provider retries only real failures
- Log errors in event record for debugging

### 5. Cross-Provider Sync
- Sync discount redemptions from SePay to Polar
- Use retry with exponential backoff
- Mark orders as synced to prevent duplicates

### 6. Refund Handling
- Check order status before processing
- Cancel related commissions
- Recalculate referrer tier after cancellation
- Optionally keep access (goodwill refunds)
