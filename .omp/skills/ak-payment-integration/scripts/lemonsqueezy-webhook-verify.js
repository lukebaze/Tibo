#!/usr/bin/env node

/**
 * Lemon Squeezy Webhook Verification Script
 *
 * Verifies Lemon Squeezy webhook signatures
 * (https://docs.lemonsqueezy.com/help/webhooks/signing-requests):
 *   header    X-Signature
 *   signature hex(HMAC-SHA256(key = signing secret string, message = raw request body))
 * The scheme carries no timestamp and payloads carry no event ID, so this
 * script derives a dedupe key from signed fields (see dedupeKey below).
 * X-Event-Name is not signed; the event name is read from meta.event_name.
 *
 * Usage:
 *   node lemonsqueezy-webhook-verify.js <webhook-payload-json> [signing-secret]
 *
 * Environment Variables:
 *   LEMONSQUEEZY_WEBHOOK_SECRET - Signing secret set on the webhook (test and live webhooks differ)
 */

const crypto = require('crypto');

const SIGNATURE_HEADER = 'x-signature';
const EVENT_NAME_HEADER = 'x-event-name';
const HEX_SHA256 = /^[0-9a-f]{64}$/;

function getHeader(headers, name) {
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === name) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

class LemonSqueezyWebhookVerifier {
  constructor(secret) {
    if (!secret) {
      throw new Error('Webhook signing secret is required');
    }
    this.secret = secret;
  }

  static computeSignature(secret, payload) {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Build signed headers for local testing.
   */
  static sign(payload, secret) {
    const headers = {
      'X-Signature': LemonSqueezyWebhookVerifier.computeSignature(secret, payload)
    };
    try {
      const eventName = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : payload).meta.event_name;
      if (eventName) headers['X-Event-Name'] = eventName;
    } catch {
      // Non-JSON payloads still get a signature; process() will reject them.
    }
    return headers;
  }

  /**
   * Verify the signature against the RAW request body (string or Buffer).
   */
  verifySignature(payload, headers) {
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
      throw new Error('Raw request body (string or Buffer) is required');
    }

    const provided = getHeader(headers, SIGNATURE_HEADER);
    if (!provided) {
      throw new Error('Missing X-Signature header');
    }

    const normalized = String(provided).trim().toLowerCase();
    if (!HEX_SHA256.test(normalized)) {
      throw new Error('Invalid webhook signature');
    }

    const expected = Buffer.from(LemonSqueezyWebhookVerifier.computeSignature(this.secret, payload), 'hex');
    if (!crypto.timingSafeEqual(Buffer.from(normalized, 'hex'), expected)) {
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

      const body = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : payload);
      const name = body && body.meta && body.meta.event_name;
      const data = body && body.data;

      if (!name || !data || !data.type || data.id === undefined || !data.attributes) {
        throw new Error('Invalid event structure');
      }

      const headerName = getHeader(headers, EVENT_NAME_HEADER);
      if (headerName && headerName !== name) {
        throw new Error('X-Event-Name does not match meta.event_name');
      }

      return {
        success: true,
        event: {
          name,
          type: data.type,
          id: String(data.id),
          testMode: data.attributes.test_mode === true,
          customData: body.meta.custom_data || null,
          dedupeKey: LemonSqueezyWebhookVerifier.dedupeKey(body),
          data
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
   * Deduplication key. Payloads have no event ID; a re-delivery of the same
   * event yields the same key, while successive updates differ by updated_at.
   */
  static dedupeKey(body) {
    const data = body.data;
    return [body.meta.event_name, data.type, String(data.id), data.attributes.updated_at || ''].join(':');
  }

  /**
   * Get event category
   */
  static getEventCategory(eventName) {
    const categories = [
      ['subscription_payment_', 'subscription_payment'],
      ['subscription_', 'subscription'],
      ['order_', 'order'],
      ['license_key_', 'license_key'],
      ['customer_', 'customer'],
      ['affiliate_', 'affiliate']
    ];

    for (const [prefix, category] of categories) {
      if (eventName.startsWith(prefix)) {
        return category;
      }
    }

    return 'unknown';
  }

  /**
   * Money collected: a new order or a successful subscription charge.
   * A subscription's first charge emits both order_created and
   * subscription_payment_success; count revenue from one of them only.
   */
  static isPaymentEvent(eventName) {
    return eventName === 'order_created' || eventName === 'subscription_payment_success';
  }

  /**
   * Refund issued on an order or a subscription invoice.
   */
  static isRefundEvent(eventName) {
    return eventName === 'order_refunded' || eventName === 'subscription_payment_refunded';
  }

  /**
   * Check if event is a subscription change (including subscription payments)
   */
  static isSubscriptionEvent(eventName) {
    return eventName.startsWith('subscription_');
  }
}

// CLI Usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node lemonsqueezy-webhook-verify.js <webhook-payload-json> [signing-secret]');
    console.log('\nSigning secret can also be provided via LEMONSQUEEZY_WEBHOOK_SECRET environment variable');
    console.log('\nExample:');
    console.log('  node lemonsqueezy-webhook-verify.js \'{"meta":{"event_name":"order_created"},"data":{"type":"orders","id":"1","attributes":{...}}}\' your_signing_secret');
    process.exit(1);
  }

  try {
    const payload = args[0];
    const secret = args[1] || process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    if (!secret) {
      console.error('✗ Error: Webhook signing secret is required');
      console.error('Provide it as second argument or set LEMONSQUEEZY_WEBHOOK_SECRET environment variable');
      process.exit(1);
    }

    // Self-test: sign locally, then verify
    const headers = LemonSqueezyWebhookVerifier.sign(payload, secret);
    const verifier = new LemonSqueezyWebhookVerifier(secret);
    const result = verifier.process(payload, headers);

    if (result.success) {
      const { event } = result;
      console.log('✓ Webhook verified successfully\n');
      console.log('Event Details:');
      console.log(`  Name: ${event.name}`);
      console.log(`  Resource: ${event.type} ${event.id}`);
      console.log(`  Test Mode: ${event.testMode ? 'Yes' : 'No'}`);
      console.log(`  Dedupe Key: ${event.dedupeKey}`);
      console.log(`  Category: ${LemonSqueezyWebhookVerifier.getEventCategory(event.name)}`);
      console.log(`  Is Payment: ${LemonSqueezyWebhookVerifier.isPaymentEvent(event.name) ? 'Yes' : 'No'}`);
      console.log(`  Is Refund: ${LemonSqueezyWebhookVerifier.isRefundEvent(event.name) ? 'Yes' : 'No'}`);
      console.log(`  Is Subscription: ${LemonSqueezyWebhookVerifier.isSubscriptionEvent(event.name) ? 'Yes' : 'No'}`);
      console.log('\nCustom Data:');
      console.log(JSON.stringify(event.customData, null, 2));
      console.log('\nAttributes:');
      console.log(JSON.stringify(event.data.attributes, null, 2));
    } else {
      console.error('✗ Verification failed:', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

module.exports = LemonSqueezyWebhookVerifier;
