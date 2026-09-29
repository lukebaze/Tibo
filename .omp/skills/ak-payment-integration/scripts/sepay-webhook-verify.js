#!/usr/bin/env node

/**
 * SePay Webhook Verification Script
 *
 * Verifies SePay bank-transaction webhooks and normalizes the payload.
 * Auth modes (configured per webhook at my.sepay.vn):
 *   - hmac    : X-SePay-Signature: sha256=hex(HMAC_SHA256(secret, "{timestamp}.{rawBody}"))
 *               X-SePay-Timestamp: unix seconds (rejected when older/newer than 5 minutes)
 *   - api_key : Authorization: Apikey {API_KEY}
 *   - oauth2  : Authorization: Bearer {token issued by YOUR token endpoint}
 *   - none    : no authentication (testing only)
 *
 * A delivery only counts as successful when your endpoint answers
 * HTTP 200/201 with body exactly {"success": true} within 30 seconds.
 *
 * Usage:
 *   node sepay-webhook-verify.js <webhook-payload-json>
 *
 * Environment Variables:
 *   SEPAY_WEBHOOK_AUTH_TYPE - hmac | api_key | oauth2 | none (default: none)
 *   SEPAY_WEBHOOK_SECRET    - HMAC-SHA256 secret key (hmac)
 *   SEPAY_WEBHOOK_API_KEY   - API key (api_key)
 */

const crypto = require('crypto');

const SIGNATURE_TOLERANCE_SECONDS = 300;

function getHeader(headers, name) {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === target) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

class SePayWebhookVerifier {
  /**
   * @param {'none'|'api_key'|'hmac'|'oauth2'} authType
   * @param {string|null} secret API key (api_key) or HMAC secret key (hmac)
   * @param {{ toleranceSeconds?: number, now?: () => number }} options
   */
  constructor(authType = 'none', secret = null, options = {}) {
    this.authType = authType;
    this.secret = secret;
    this.apiKey = secret; // kept for callers of the previous API-key-only verifier
    this.toleranceSeconds = options.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
    this.now = options.now || (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Compute the X-SePay-Signature value for a raw body.
   */
  static sign(secret, timestamp, rawBody) {
    const digest = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    return `sha256=${digest}`;
  }

  /**
   * Verify webhook authenticity.
   * @param {object} headers request headers (any casing)
   * @param {string} rawBody exact request body bytes as received (required for hmac)
   */
  verifyAuthentication(headers = {}, rawBody = null) {
    if (this.authType === 'none') {
      console.warn('Warning: no webhook authentication configured (testing only)');
      return true;
    }

    if (this.authType === 'hmac') {
      if (!this.secret) throw new Error('Missing HMAC secret key');
      if (typeof rawBody !== 'string') throw new Error('Raw body required for HMAC verification');

      const signature = getHeader(headers, 'x-sepay-signature');
      const timestampHeader = getHeader(headers, 'x-sepay-timestamp');
      if (!signature || !timestampHeader) {
        throw new Error('Missing X-SePay-Signature or X-SePay-Timestamp header');
      }

      const timestamp = Number(timestampHeader);
      if (!Number.isFinite(timestamp) || Math.abs(this.now() - timestamp) > this.toleranceSeconds) {
        throw new Error('Signature timestamp outside tolerance');
      }

      const expected = SePayWebhookVerifier.sign(this.secret, timestampHeader, rawBody);
      if (!safeEqual(signature, expected)) {
        throw new Error('Invalid signature');
      }
      return true;
    }

    if (this.authType === 'api_key') {
      if (!this.secret) throw new Error('Missing API key');
      const authHeader = getHeader(headers, 'authorization');
      if (!authHeader) {
        throw new Error('Missing Authorization header');
      }
      if (!safeEqual(authHeader, `Apikey ${this.secret}`)) {
        throw new Error('Invalid API key');
      }
      return true;
    }

    if (this.authType === 'oauth2') {
      const authHeader = getHeader(headers, 'authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Missing or invalid OAuth2 Bearer token');
      }
      // The token was issued by your own token endpoint: validate it there.
      console.log('OAuth2 Bearer token present (validate it against your token store)');
      return true;
    }

    throw new Error(`Unknown auth type: ${this.authType}`);
  }

  /**
   * Check for duplicate transactions (id is stable across retries and replays)
   */
  isDuplicate(transactionId, processedIds = new Set()) {
    return processedIds.has(transactionId);
  }

  /**
   * Validate webhook payload structure
   */
  validatePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Payload must be a JSON object');
    }

    const required = [
      'id',
      'gateway',
      'transactionDate',
      'accountNumber',
      'transferType',
      'transferAmount',
      'referenceCode'
    ];

    for (const field of required) {
      if (!(field in payload)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (!['in', 'out'].includes(payload.transferType)) {
      throw new Error(`Invalid transferType: ${payload.transferType}`);
    }

    if (!Number.isInteger(payload.transferAmount) || payload.transferAmount <= 0) {
      throw new Error('Invalid transferAmount');
    }

    return true;
  }

  /**
   * Process a webhook.
   * @param {object|string} payload parsed JSON object, or the raw body string
   * @param {object} headers request headers
   * @param {string} [rawBody] raw body string (required for hmac when payload is an object)
   */
  process(payload, headers = {}, rawBody = undefined) {
    try {
      const body = typeof payload === 'string' ? payload : rawBody;
      const data = typeof payload === 'string' ? JSON.parse(payload) : payload;

      // 1. Verify authentication
      this.verifyAuthentication(headers, body ?? null);

      // 2. Validate payload structure
      this.validatePayload(data);

      // 3. Extract transaction data
      const transaction = {
        id: data.id,
        gateway: data.gateway,
        transactionDate: data.transactionDate, // "YYYY-MM-DD HH:mm:ss", Vietnam time (UTC+7)
        accountNumber: data.accountNumber,
        subAccount: data.subAccount || null,
        code: data.code ?? null,
        content: data.content || '',
        description: data.description || '',
        transferType: data.transferType,
        transferAmount: data.transferAmount,
        accumulated: data.accumulated || 0,
        referenceCode: data.referenceCode || ''
      };

      return {
        success: true,
        transaction,
        isIncoming: transaction.transferType === 'in',
        isOutgoing: transaction.transferType === 'out',
        response: { status: 200, body: { success: true } }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// CLI Usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node sepay-webhook-verify.js <webhook-payload-json>');
    console.log('\nEnvironment Variables:');
    console.log('  SEPAY_WEBHOOK_AUTH_TYPE - hmac, api_key, oauth2, none (default: none)');
    console.log('  SEPAY_WEBHOOK_SECRET    - HMAC-SHA256 secret key (hmac)');
    console.log('  SEPAY_WEBHOOK_API_KEY   - API key (api_key)');
    process.exit(1);
  }

  try {
    const rawBody = args[0];
    const authType = process.env.SEPAY_WEBHOOK_AUTH_TYPE || 'none';
    const secret = authType === 'hmac'
      ? process.env.SEPAY_WEBHOOK_SECRET || null
      : process.env.SEPAY_WEBHOOK_API_KEY || null;

    const verifier = new SePayWebhookVerifier(authType, secret);

    // Simulated SePay headers for local CLI testing
    const headers = {};
    if (authType === 'api_key' && secret) {
      headers.Authorization = `Apikey ${secret}`;
    }
    if (authType === 'hmac' && secret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      headers['X-SePay-Timestamp'] = timestamp;
      headers['X-SePay-Signature'] = SePayWebhookVerifier.sign(secret, timestamp, rawBody);
    }

    const result = verifier.process(rawBody, headers);

    if (result.success) {
      console.log('Webhook verified successfully\n');
      console.log('Transaction Details:');
      console.log(`  ID: ${result.transaction.id}`);
      console.log(`  Gateway: ${result.transaction.gateway}`);
      console.log(`  Type: ${result.transaction.transferType}`);
      console.log(`  Amount: ${result.transaction.transferAmount.toLocaleString('vi-VN')} VND`);
      console.log(`  Code: ${result.transaction.code ?? 'N/A'}`);
      console.log(`  Reference: ${result.transaction.referenceCode || 'N/A'}`);
      console.log(`  Content: ${result.transaction.content || 'N/A'}`);
      console.log(`\n  Incoming: ${result.isIncoming ? 'Yes' : 'No'}`);
      console.log(`  Outgoing: ${result.isOutgoing ? 'Yes' : 'No'}`);
      console.log('\nRespond to SePay with HTTP 200 and body {"success": true}');
    } else {
      console.error('Verification failed:', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

module.exports = SePayWebhookVerifier;
