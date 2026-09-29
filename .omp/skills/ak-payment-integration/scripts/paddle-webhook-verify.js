#!/usr/bin/env node

/**
 * Paddle Billing Webhook Verification Script
 *
 * Verifies Paddle Billing webhook signatures
 * (https://developer.paddle.com/webhooks/about/signature-verification):
 *   header    Paddle-Signature: ts=<unix seconds>;h1=<hex signature>[;h1=<hex signature>...]
 *   signature hex(HMAC-SHA256(key = endpoint secret key, message = ts + ":" + raw request body))
 * More than one h1 may be sent while a secret rotates; any match passes.
 * The official SDKs reject events older than 5 seconds by default; so does this script.
 * Deduplicate on the payload `event_id` (evt_...).
 *
 * Paddle Classic webhooks (form-encoded, signature inside the payload) are a different scheme
 * and are not supported here.
 *
 * Usage:
 *   node paddle-webhook-verify.js <webhook-payload-json> [endpoint-secret-key]
 *
 * Environment Variables:
 *   PADDLE_WEBHOOK_SECRET - Secret key of the notification destination (sandbox and live differ)
 */

const crypto = require('crypto');

const SIGNATURE_HEADER = 'paddle-signature';
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const DEFAULT_TOLERANCE_SECONDS = 5;

const EVENT_CATEGORIES = new Set([
  'transaction',
  'subscription',
  'customer',
  'address',
  'business',
  'adjustment',
  'payment_method',
  'payout',
  'price',
  'product',
  'discount',
  'discount_group',
  'report',
  'api_key',
  'api_key_exposure',
  'client_token'
]);

class PaddleWebhookVerifier {
  /**
   * @param {string} secret - Notification destination secret key (pdl_ntfset_...)
   * @param {{toleranceSeconds?: number}} [options] - Max allowed |now - ts| in seconds.
   *   Default 5 (SDK default). Pass 0 to disable the timestamp check (not recommended).
   */
  constructor(secret, options = {}) {
    if (!secret) {
      throw new Error('Webhook secret is required');
    }
    const tolerance = options.toleranceSeconds === undefined
      ? DEFAULT_TOLERANCE_SECONDS
      : Number(options.toleranceSeconds);
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      throw new Error('toleranceSeconds must be a non-negative number');
    }
    this.secret = secret;
    this.toleranceSeconds = tolerance;
  }

  static toBuffer(payload) {
    return Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  }

  /**
   * hex(HMAC-SHA256(secret, `${timestamp}:${rawBody}`)) computed over the raw bytes.
   */
  static computeSignature(secret, timestamp, payload) {
    return crypto
      .createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(`${timestamp}:`, 'utf8'), PaddleWebhookVerifier.toBuffer(payload)]))
      .digest('hex');
  }

  /**
   * Build a signed Paddle-Signature header for local testing.
   */
  static sign(payload, secret, { timestamp } = {}) {
    const ts = timestamp === undefined ? Math.floor(Date.now() / 1000) : timestamp;
    const h1 = PaddleWebhookVerifier.computeSignature(secret, ts, payload);
    return { [SIGNATURE_HEADER]: `ts=${ts};h1=${h1}` };
  }

  /**
   * Parse "ts=...;h1=...[;h1=...]". Unknown keys are ignored for forward compatibility.
   */
  static parseSignatureHeader(header) {
    let timestamp;
    const signatures = [];
    for (const part of String(header).split(';')) {
      const index = part.indexOf('=');
      if (index === -1) continue;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key === 'ts') {
        timestamp = value;
      } else if (key === 'h1' && value) {
        signatures.push(value.toLowerCase());
      }
    }
    if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) {
      throw new Error('Invalid Paddle-Signature header');
    }
    return { timestamp: Number(timestamp), signatures };
  }

  static getHeader(headers, name) {
    for (const [key, value] of Object.entries(headers || {})) {
      if (key.toLowerCase() === name) {
        return Array.isArray(value) ? value[0] : value;
      }
    }
    return undefined;
  }

  /**
   * Verify the signature against the RAW request body (string or Buffer).
   */
  verifySignature(payload, headers) {
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
      throw new Error('Raw request body (string or Buffer) is required');
    }

    const header = PaddleWebhookVerifier.getHeader(headers, SIGNATURE_HEADER);
    if (!header) {
      throw new Error('Missing Paddle-Signature header');
    }

    const { timestamp, signatures } = PaddleWebhookVerifier.parseSignatureHeader(header);

    if (this.toleranceSeconds > 0) {
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > this.toleranceSeconds) {
        throw new Error('Webhook timestamp outside tolerance');
      }
    }

    const expected = Buffer.from(PaddleWebhookVerifier.computeSignature(this.secret, timestamp, payload), 'hex');
    const matched = signatures.some((signature) =>
      HEX_SHA256.test(signature) && crypto.timingSafeEqual(Buffer.from(signature, 'hex'), expected)
    );
    if (!matched) {
      throw new Error('Invalid webhook signature');
    }
    return true;
  }

  /**
   * Verify and parse a webhook event
   */
  process(payload, headers) {
    try {
      this.verifySignature(payload, headers);

      const event = JSON.parse(PaddleWebhookVerifier.toBuffer(payload).toString('utf8'));

      if (!event.event_id || !event.event_type || !event.data) {
        throw new Error('Invalid event structure');
      }

      return {
        success: true,
        event: {
          id: event.event_id,
          type: event.event_type,
          occurredAt: event.occurred_at,
          notificationId: event.notification_id,
          data: event.data
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get event category: the entity before the dot (e.g. `transaction.paid` -> `transaction`)
   */
  static getEventCategory(eventType) {
    const entity = String(eventType).split('.')[0];
    return EVENT_CATEGORIES.has(entity) ? entity : 'unknown';
  }

  /**
   * Payment captured (`transaction.paid`) or fully processed (`transaction.completed`).
   * Both fire for one purchase; fulfil on one of them, idempotently.
   */
  static isPaymentEvent(eventType) {
    return eventType === 'transaction.paid' || eventType === 'transaction.completed';
  }

  /**
   * Check if event is a subscription change
   */
  static isSubscriptionEvent(eventType) {
    return String(eventType).startsWith('subscription.');
  }

  /**
   * Refunds, credits and chargebacks arrive as adjustment events
   */
  static isAdjustmentEvent(eventType) {
    return String(eventType).startsWith('adjustment.');
  }
}

// CLI Usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node paddle-webhook-verify.js <webhook-payload-json> [endpoint-secret-key]');
    console.log('\nSecret key can also be provided via PADDLE_WEBHOOK_SECRET environment variable');
    console.log('\nExample:');
    console.log('  node paddle-webhook-verify.js \'{"event_id":"evt_1","event_type":"transaction.completed","occurred_at":"2026-01-01T00:00:00Z","notification_id":"ntf_1","data":{...}}\' pdl_ntfset_xxx');
    process.exit(1);
  }

  try {
    const payload = args[0];
    const secret = args[1] || process.env.PADDLE_WEBHOOK_SECRET;

    if (!secret) {
      console.error('✗ Error: Webhook secret is required');
      console.error('Provide it as second argument or set PADDLE_WEBHOOK_SECRET environment variable');
      process.exit(1);
    }

    // Self-test: sign locally, then verify
    const headers = PaddleWebhookVerifier.sign(payload, secret);
    const verifier = new PaddleWebhookVerifier(secret);
    const result = verifier.process(payload, headers);

    if (result.success) {
      console.log('✓ Webhook verified successfully\n');
      console.log('Event Details:');
      console.log(`  ID: ${result.event.id}`);
      console.log(`  Type: ${result.event.type}`);
      console.log(`  Occurred At: ${result.event.occurredAt}`);
      console.log(`  Category: ${PaddleWebhookVerifier.getEventCategory(result.event.type)}`);
      console.log(`  Is Payment: ${PaddleWebhookVerifier.isPaymentEvent(result.event.type) ? 'Yes' : 'No'}`);
      console.log(`  Is Subscription: ${PaddleWebhookVerifier.isSubscriptionEvent(result.event.type) ? 'Yes' : 'No'}`);
      console.log('\nEvent Data:');
      console.log(JSON.stringify(result.event.data, null, 2));
    } else {
      console.error('✗ Verification failed:', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

module.exports = PaddleWebhookVerifier;
