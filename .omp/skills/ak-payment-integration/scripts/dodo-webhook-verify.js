#!/usr/bin/env node

/**
 * Dodo Payments Webhook Verification Script
 *
 * Verifies Dodo Payments webhooks, which follow Standard Webhooks
 * (https://docs.dodopayments.com/developer-resources/webhooks#verifying-signatures):
 *   headers   webhook-id, webhook-timestamp (unix seconds), webhook-signature
 *   key       webhook secret without the `whsec_` prefix, base64-decoded
 *   signature base64(HMAC-SHA256(key, `${webhook-id}.${webhook-timestamp}.${raw body}`))
 *   header    space-separated `v1,<base64>` entries; any matching v1 entry is valid
 *   replay    reject timestamps more than 5 minutes from now (either direction)
 * The JSON body has no event id; deduplicate on the `webhook-id` header.
 *
 * Usage:
 *   node dodo-webhook-verify.js <webhook-payload-json> [webhook-secret]
 *
 * Environment Variables:
 *   DODO_PAYMENTS_WEBHOOK_KEY - Signing secret of the webhook endpoint (test and live differ)
 */

const crypto = require('crypto');

const SECRET_PREFIX = 'whsec_';
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;
const HEADER_ID = 'webhook-id';
const HEADER_TIMESTAMP = 'webhook-timestamp';
const HEADER_SIGNATURE = 'webhook-signature';

class DodoWebhookVerifier {
  constructor(secret, options = {}) {
    this.key = DodoWebhookVerifier.decodeSecret(secret);
    this.toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  }

  static decodeSecret(secret) {
    if (!secret || typeof secret !== 'string') {
      throw new Error('Webhook secret is required');
    }
    const encoded = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
    const key = Buffer.from(encoded, 'base64');
    if (key.length === 0) {
      throw new Error('Webhook secret must be base64 (optionally prefixed with whsec_)');
    }
    return key;
  }

  static computeSignature(key, id, timestamp, payload) {
    return crypto
      .createHmac('sha256', key)
      .update(`${id}.${timestamp}.`)
      .update(payload)
      .digest('base64');
  }

  /**
   * Build signed headers for local testing.
   * opts: { id, timestamp } (timestamp in unix seconds; defaults to now)
   */
  static sign(payload, secret, opts = {}) {
    const id = opts.id || `msg_${crypto.randomBytes(12).toString('hex')}`;
    const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
    const key = DodoWebhookVerifier.decodeSecret(secret);
    return {
      [HEADER_ID]: id,
      [HEADER_TIMESTAMP]: String(timestamp),
      [HEADER_SIGNATURE]: `v1,${DodoWebhookVerifier.computeSignature(key, id, timestamp, payload)}`
    };
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
   * nowSeconds is injectable for tests; defaults to the current time.
   */
  verifySignature(payload, headers, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
      throw new Error('Raw request body (string or Buffer) is required');
    }

    const id = DodoWebhookVerifier.getHeader(headers, HEADER_ID);
    const timestampHeader = DodoWebhookVerifier.getHeader(headers, HEADER_TIMESTAMP);
    const signatureHeader = DodoWebhookVerifier.getHeader(headers, HEADER_SIGNATURE);
    if (!id || !timestampHeader || !signatureHeader) {
      throw new Error(`Missing ${HEADER_ID}, ${HEADER_TIMESTAMP} or ${HEADER_SIGNATURE} header`);
    }

    const timestampText = String(timestampHeader).trim();
    if (!/^\d+$/.test(timestampText)) {
      throw new Error('Invalid webhook timestamp');
    }
    const timestamp = Number(timestampText);
    if (nowSeconds - timestamp > this.toleranceSeconds) {
      throw new Error('Webhook timestamp too old');
    }
    if (timestamp - nowSeconds > this.toleranceSeconds) {
      throw new Error('Webhook timestamp too new');
    }

    const expected = Buffer.from(
      DodoWebhookVerifier.computeSignature(this.key, String(id), String(timestamp), payload),
      'base64'
    );

    for (const entry of String(signatureHeader).trim().split(/\s+/)) {
      const [version, signature] = entry.split(',');
      if (version !== 'v1' || !signature) continue;
      const provided = Buffer.from(signature, 'base64');
      if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
        return true;
      }
    }
    throw new Error('Invalid webhook signature');
  }

  /**
   * Verify and parse a webhook event
   */
  process(payload, headers) {
    try {
      this.verifySignature(payload, headers);

      const event = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : payload);

      if (!event.type || !event.data || typeof event.data !== 'object') {
        throw new Error('Invalid event structure');
      }

      return {
        success: true,
        event: {
          id: String(DodoWebhookVerifier.getHeader(headers, HEADER_ID)), // idempotency key
          type: event.type,
          businessId: event.business_id,
          timestamp: event.timestamp,
          payloadType: event.data.payload_type,
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
   * Get event category
   */
  static getEventCategory(eventType) {
    const categories = {
      'payment.': 'payment',
      'subscription.': 'subscription',
      'refund.': 'refund',
      'dispute.': 'dispute',
      'license_key.': 'license_key',
      'entitlement_grant.': 'entitlement',
      'credit.': 'credit',
      'payout.': 'payout',
      'abandoned_checkout.': 'recovery',
      'dunning.': 'recovery'
    };

    for (const [prefix, category] of Object.entries(categories)) {
      if (eventType.startsWith(prefix)) {
        return category;
      }
    }

    return 'unknown';
  }

  /**
   * Money collected: every successful charge (one-time, first and renewal
   * subscription charges) emits payment.succeeded.
   */
  static isPaymentEvent(eventType) {
    return eventType === 'payment.succeeded';
  }

  /**
   * Check if event is a subscription change
   */
  static isSubscriptionEvent(eventType) {
    return eventType.startsWith('subscription.');
  }
}

// CLI Usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node dodo-webhook-verify.js <webhook-payload-json> [webhook-secret]');
    console.log('\nWebhook secret can also be provided via DODO_PAYMENTS_WEBHOOK_KEY environment variable');
    console.log('\nExample:');
    console.log('  node dodo-webhook-verify.js \'{"business_id":"bus_xxx","type":"payment.succeeded","timestamp":"2026-09-26T10:30:00Z","data":{"payload_type":"Payment"}}\' whsec_dGVzdF9zZWNyZXQ=');
    process.exit(1);
  }

  try {
    const payload = args[0];
    const secret = args[1] || process.env.DODO_PAYMENTS_WEBHOOK_KEY;

    if (!secret) {
      console.error('✗ Error: Webhook secret is required');
      console.error('Provide it as second argument or set DODO_PAYMENTS_WEBHOOK_KEY environment variable');
      process.exit(1);
    }

    // Self-test: sign locally, then verify
    const headers = DodoWebhookVerifier.sign(payload, secret);
    const verifier = new DodoWebhookVerifier(secret);
    const result = verifier.process(payload, headers);

    if (result.success) {
      console.log('✓ Webhook verified successfully\n');
      console.log('Event Details:');
      console.log(`  Webhook ID: ${result.event.id}`);
      console.log(`  Type: ${result.event.type}`);
      console.log(`  Category: ${DodoWebhookVerifier.getEventCategory(result.event.type)}`);
      console.log(`  Is Payment: ${DodoWebhookVerifier.isPaymentEvent(result.event.type) ? 'Yes' : 'No'}`);
      console.log(`  Is Subscription: ${DodoWebhookVerifier.isSubscriptionEvent(result.event.type) ? 'Yes' : 'No'}`);
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

module.exports = DodoWebhookVerifier;
