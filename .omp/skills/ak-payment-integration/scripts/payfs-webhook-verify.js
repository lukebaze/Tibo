#!/usr/bin/env node

/**
 * PayFS Webhook Verification Script
 *
 * Verifies PayFS webhooks (https://docs.payfs.vn/vi/developers/webhook-signature):
 *   X-Client-API-Key   webhook API key (docs: always check it)
 *   X-PayFS-Timestamp  UNIX seconds
 *   X-PayFS-Signature  hex(HMAC-SHA256(secret, timestamp + "." + JSON.stringify(sortKeysDeep(body))))
 *                      raw 64-char hex, no "sha256=" prefix; expires after 5 minutes
 * The signature covers a canonical re-serialization (keys sorted recursively),
 * so parse the raw body before verifying. Deduplicate on transaction_id / order_id.
 *
 * Usage:
 *   node payfs-webhook-verify.js <webhook-payload-json>
 *
 * Environment Variables:
 *   PAYFS_WEBHOOK_SECRET  - Webhook secret from the Client Portal (required)
 *   PAYFS_WEBHOOK_API_KEY - Webhook API key (required; the docs make this check mandatory)
 */

const crypto = require('crypto');

const SIGNATURE_TOLERANCE_SECONDS = 300;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

function getHeader(headers, name) {
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === name) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function timingSafeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== 'object') return value;
  // fromEntries defines own properties, so a "__proto__" key stays in the signed string
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]));
}

class PayfsWebhookVerifier {
  /**
   * @param {string} secret webhook secret
   * @param {{ apiKey?: string, allowMissingApiKey?: boolean, toleranceSeconds?: number, now?: () => number }} options
   *   apiKey is required; pass allowMissingApiKey only for local experiments
   */
  constructor(secret, options = {}) {
    if (!secret) {
      throw new Error('Webhook secret is required');
    }
    this.secret = secret;
    if (!options.apiKey && !options.allowMissingApiKey) {
      throw new Error('Webhook API key is required (X-Client-API-Key check)');
    }
    this.apiKey = options.apiKey || null;
    this.toleranceSeconds = options.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
    this.now = options.now || (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Canonical string PayFS signs: JSON with keys sorted recursively.
   */
  static canonicalize(payload) {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return JSON.stringify(sortKeysDeep(parsed));
  }

  static computeSignature(secret, timestamp, payload) {
    return crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${PayfsWebhookVerifier.canonicalize(payload)}`, 'utf8')
      .digest('hex');
  }

  /**
   * Build signed headers for local testing.
   */
  static sign(payload, secret, options = {}) {
    const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
    const headers = {
      'x-payfs-timestamp': timestamp,
      'x-payfs-signature': PayfsWebhookVerifier.computeSignature(secret, timestamp, payload)
    };
    if (options.apiKey) headers['x-client-api-key'] = options.apiKey;
    return headers;
  }

  /**
   * Verify API key, timestamp window and signature.
   * @param {string|Buffer} rawBody request body as received
   */
  verify(rawBody, headers) {
    if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) {
      throw new Error('Raw request body (string or Buffer) is required');
    }
    const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;

    if (this.apiKey) {
      const provided = getHeader(headers, 'x-client-api-key');
      if (!provided) throw new Error('Missing X-Client-API-Key header');
      if (!timingSafeEqual(provided, this.apiKey)) throw new Error('Invalid API key');
    }

    const signature = getHeader(headers, 'x-payfs-signature');
    const timestampHeader = getHeader(headers, 'x-payfs-timestamp');
    if (!signature || !timestampHeader) {
      throw new Error('Missing X-PayFS-Signature or X-PayFS-Timestamp header');
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isInteger(timestamp) || Math.abs(this.now() - timestamp) > this.toleranceSeconds) {
      throw new Error('Signature timestamp outside tolerance');
    }

    const normalized = String(signature).trim().toLowerCase();
    if (!HEX_SHA256.test(normalized)) {
      throw new Error('Invalid webhook signature');
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error('Invalid JSON body');
    }

    const expected = PayfsWebhookVerifier.computeSignature(this.secret, String(timestampHeader).trim(), parsed);
    if (!crypto.timingSafeEqual(Buffer.from(normalized, 'hex'), Buffer.from(expected, 'hex'))) {
      throw new Error('Invalid webhook signature');
    }
    return parsed;
  }

  /**
   * Verify and normalize a webhook. The event name is not sent, so it is
   * inferred from transfer_type (transactions) or status (orders).
   */
  process(rawBody, headers) {
    try {
      const data = this.verify(rawBody, headers);
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Invalid event structure');
      }

      if (data.transaction_id !== undefined) {
        if (!['credit', 'debit'].includes(data.transfer_type)) {
          throw new Error(`Invalid transfer_type: ${data.transfer_type}`);
        }
        if (!Number.isInteger(data.amount) || data.amount <= 0) {
          throw new Error('Invalid amount');
        }
        return {
          success: true,
          event: {
            id: String(data.transaction_id),
            type: `transaction.${data.transfer_type}`,
            attempt: Number(getHeader(headers, 'x-payfs-attempt')) || null,
            data
          }
        };
      }

      if (data.order_id !== undefined && data.amount !== undefined && data.status) {
        return {
          success: true,
          event: {
            id: `${data.order_id}:${data.status}`,
            type: data.status === 'success' ? 'order.success' : 'order.failed',
            attempt: Number(getHeader(headers, 'x-payfs-attempt')) || null,
            data
          }
        };
      }

      throw new Error('Invalid event structure');
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Money received: an incoming transfer or a successful order.
   */
  static isPaymentEvent(eventType) {
    return eventType === 'transaction.credit' || eventType === 'order.success';
  }
}

// CLI Usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node payfs-webhook-verify.js <webhook-payload-json>');
    console.log('\nSet PAYFS_WEBHOOK_SECRET and PAYFS_WEBHOOK_API_KEY (both required in production).');
    console.log('\nExample:');
    console.log('  PAYFS_WEBHOOK_SECRET=whsec_xxx node payfs-webhook-verify.js \'{"transaction_id":"1","amount":14000,"transfer_type":"credit",...}\'');
    process.exit(1);
  }

  try {
    const payload = args[0];
    const secret = process.env.PAYFS_WEBHOOK_SECRET;
    const apiKey = process.env.PAYFS_WEBHOOK_API_KEY;

    if (!secret) {
      console.error('✗ Error: PAYFS_WEBHOOK_SECRET environment variable is required');
      process.exit(1);
    }

    // Self-test: sign locally, then verify
    const headers = PayfsWebhookVerifier.sign(payload, secret, { apiKey });
    if (!apiKey) {
      console.warn('Warning: PAYFS_WEBHOOK_API_KEY is not set; skipping the X-Client-API-Key check for this local self-test');
    }
    const verifier = new PayfsWebhookVerifier(secret, { apiKey, allowMissingApiKey: true });
    const result = verifier.process(payload, headers);

    if (result.success) {
      console.log('✓ Webhook verified successfully\n');
      console.log('Event Details:');
      console.log(`  ID: ${result.event.id}`);
      console.log(`  Type: ${result.event.type}`);
      console.log(`  Is Payment: ${PayfsWebhookVerifier.isPaymentEvent(result.event.type) ? 'Yes' : 'No'}`);
      console.log(`  Signature: ${headers['x-payfs-signature']}`);
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

module.exports = PayfsWebhookVerifier;
