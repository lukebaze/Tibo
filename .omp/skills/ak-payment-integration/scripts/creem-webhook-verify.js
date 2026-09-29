#!/usr/bin/env node

/**
 * Creem Webhook Verification Script
 *
 * Verifies Creem webhook signatures (https://docs.creem.io/code/webhooks):
 *   header    creem-signature
 *   signature hex(HMAC-SHA256(key = webhook secret string, message = raw request body))
 * The scheme carries no timestamp, so there is no replay window to check;
 * deduplicate on the event `id` instead.
 *
 * Usage:
 *   node creem-webhook-verify.js <webhook-payload-json> [webhook-secret]
 *
 * Environment Variables:
 *   CREEM_WEBHOOK_SECRET - Signing secret of the webhook endpoint (test and live differ)
 */

const crypto = require('crypto');

const SIGNATURE_HEADER = 'creem-signature';
const HEX_SHA256 = /^[0-9a-f]{64}$/;

class CreemWebhookVerifier {
  constructor(secret) {
    if (!secret) {
      throw new Error('Webhook secret is required');
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
    return { [SIGNATURE_HEADER]: CreemWebhookVerifier.computeSignature(secret, payload) };
  }

  /**
   * Verify the signature against the RAW request body (string or Buffer).
   */
  verifySignature(payload, headers) {
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
      throw new Error('Raw request body (string or Buffer) is required');
    }

    let provided;
    for (const [key, value] of Object.entries(headers || {})) {
      if (key.toLowerCase() === SIGNATURE_HEADER) {
        provided = Array.isArray(value) ? value[0] : value;
      }
    }
    if (!provided) {
      throw new Error(`Missing ${SIGNATURE_HEADER} header`);
    }

    const normalized = String(provided).trim().toLowerCase();
    if (!HEX_SHA256.test(normalized)) {
      throw new Error('Invalid webhook signature');
    }

    const expected = Buffer.from(CreemWebhookVerifier.computeSignature(this.secret, payload), 'hex');
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

      const event = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : payload);

      if (!event.id || !event.eventType || !event.object) {
        throw new Error('Invalid event structure');
      }

      return {
        success: true,
        event: {
          id: event.id,
          type: event.eventType,
          createdAt: event.created_at,
          data: event.object
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
      'checkout.': 'checkout',
      'subscription.': 'subscription',
      'refund.': 'refund',
      'dispute.': 'dispute',
      'credits.': 'credits',
      'customer_credits.': 'credits'
    };

    for (const [prefix, category] of Object.entries(categories)) {
      if (eventType.startsWith(prefix)) {
        return category;
      }
    }

    return 'unknown';
  }

  /**
   * Payment collected: a completed checkout or a paid subscription cycle.
   */
  static isPaymentEvent(eventType) {
    return eventType === 'checkout.completed' || eventType === 'subscription.paid';
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
    console.log('Usage: node creem-webhook-verify.js <webhook-payload-json> [webhook-secret]');
    console.log('\nWebhook secret can also be provided via CREEM_WEBHOOK_SECRET environment variable');
    console.log('\nExample:');
    console.log('  node creem-webhook-verify.js \'{"id":"evt_1","eventType":"checkout.completed","object":{...}}\' whsec_xxx');
    process.exit(1);
  }

  try {
    const payload = args[0];
    const secret = args[1] || process.env.CREEM_WEBHOOK_SECRET;

    if (!secret) {
      console.error('✗ Error: Webhook secret is required');
      console.error('Provide it as second argument or set CREEM_WEBHOOK_SECRET environment variable');
      process.exit(1);
    }

    // Self-test: sign locally, then verify
    const headers = CreemWebhookVerifier.sign(payload, secret);
    const verifier = new CreemWebhookVerifier(secret);
    const result = verifier.process(payload, headers);

    if (result.success) {
      console.log('✓ Webhook verified successfully\n');
      console.log('Event Details:');
      console.log(`  ID: ${result.event.id}`);
      console.log(`  Type: ${result.event.type}`);
      console.log(`  Category: ${CreemWebhookVerifier.getEventCategory(result.event.type)}`);
      console.log(`  Is Payment: ${CreemWebhookVerifier.isPaymentEvent(result.event.type) ? 'Yes' : 'No'}`);
      console.log(`  Is Subscription: ${CreemWebhookVerifier.isSubscriptionEvent(result.event.type) ? 'Yes' : 'No'}`);
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

module.exports = CreemWebhookVerifier;
