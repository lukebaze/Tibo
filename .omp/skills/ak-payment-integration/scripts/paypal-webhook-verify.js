#!/usr/bin/env node

/**
 * PayPal Webhook Verification Script (offline self-verification)
 *
 * Implements the self-verification method from
 * https://developer.paypal.com/api/rest/webhooks/rest/#self-verification-method
 *   message   `${paypal-transmission-id}|${paypal-transmission-time}|${webhookId}|${crc32(rawBody)}`
 *             CRC32 of the RAW body as an unsigned decimal integer
 *   signature base64 in paypal-transmission-sig, RSA with SHA-256
 *             (paypal-auth-algo: SHA256withRSA)
 *   key       public key of the X.509 certificate at paypal-cert-url
 *             (downloaded once per URL, bounded cache; only PayPal API cert URLs are fetched)
 * The webhook ID is not in the request: it comes from your listener's
 * subscription (dashboard or Webhooks API). Mock events from the simulator use
 * the literal ID "WEBHOOK_ID". Deduplicate on the event `id` (WH-...).
 *
 * Usage:
 *   node paypal-webhook-verify.js <webhook-payload-json> [webhook-id]
 *   (self-test: signs the payload with a throwaway RSA key, then verifies it)
 *
 * Environment Variables:
 *   PAYPAL_WEBHOOK_ID - ID of the subscribed listener URL (sandbox and live differ)
 */

const crypto = require('crypto');
const zlib = require('zlib');

const HEADER = {
  transmissionId: 'paypal-transmission-id',
  transmissionTime: 'paypal-transmission-time',
  transmissionSig: 'paypal-transmission-sig',
  certUrl: 'paypal-cert-url',
  authAlgo: 'paypal-auth-algo'
};
const AUTH_ALGO = 'SHA256withRSA';
// The cert URL arrives in an unauthenticated header, so it is the trust anchor:
// accept only PayPal's API hosts and the certificate path, never any *.paypal.com page.
const CERT_HOSTS = new Set(['api.paypal.com', 'api-m.paypal.com', 'api.sandbox.paypal.com', 'api-m.sandbox.paypal.com']);
const CERT_PATH_PREFIX = '/v1/notifications/certs/';
const CERT_MAX_BYTES = 64 * 1024;
const CERT_FETCH_TIMEOUT_MS = 5000;
const CERT_CACHE_LIMIT = 16;
const TEST_CERT_URL = 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-local-test';

let crcTable;

function crc32Table(buffer) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toBuffer(payload) {
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  throw new Error('Raw request body (string or Buffer) is required');
}

async function defaultCertFetcher(url) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable; pass options.certFetcher or options.certPem');
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(CERT_FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Certificate download failed with HTTP ${response.status}`);
  }
  const text = await response.text();
  if (text.length > CERT_MAX_BYTES) {
    throw new Error('Certificate download is too large');
  }
  return text;
}

class PaypalWebhookVerifier {
  /**
   * @param {string} webhookId ID of the listener subscription ("WEBHOOK_ID" for simulator mocks)
   * @param {object} [options]
   * @param {string} [options.certPem] PEM certificate or public key (offline verification)
   * @param {Function} [options.certFetcher] async (url) => PEM; defaults to fetch()
   * @param {number} [options.toleranceSeconds] optional max age of paypal-transmission-time;
   *   PayPal documents no replay window, so this is off unless you set it
   */
  constructor(webhookId, options = {}) {
    if (!webhookId) {
      throw new Error('Webhook ID is required');
    }
    this.webhookId = webhookId;
    this.certPem = options.certPem || null;
    this.certFetcher = options.certFetcher || defaultCertFetcher;
    this.toleranceSeconds = options.toleranceSeconds ?? null;
    this.certCache = new Map();
  }

  /**
   * CRC32 (IEEE) of the raw body as an unsigned integer.
   */
  static crc32(payload) {
    const buffer = toBuffer(payload);
    return typeof zlib.crc32 === 'function' ? zlib.crc32(buffer) >>> 0 : crc32Table(buffer);
  }

  static buildMessage(transmissionId, transmissionTime, webhookId, payload) {
    return `${transmissionId}|${transmissionTime}|${webhookId}|${PaypalWebhookVerifier.crc32(payload)}`;
  }

  /**
   * Only download certificates over HTTPS from PayPal API hosts under the certs path.
   */
  static isPaypalCertUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    return parsed.protocol === 'https:' &&
      !parsed.username && !parsed.password &&
      (parsed.port === '' || parsed.port === '443') &&
      CERT_HOSTS.has(parsed.hostname.toLowerCase()) &&
      parsed.pathname.startsWith(CERT_PATH_PREFIX) &&
      !parsed.pathname.includes('..') &&
      !parsed.search && !parsed.hash;
  }

  static readHeaders(headers) {
    const lower = {};
    for (const [key, value] of Object.entries(headers || {})) {
      lower[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    }
    const result = {};
    for (const [field, name] of Object.entries(HEADER)) {
      if (field !== 'authAlgo' && !lower[name]) {
        throw new Error(`Missing ${name} header`);
      }
      result[field] = lower[name] ? String(lower[name]).trim() : undefined;
    }
    return result;
  }

  /**
   * Throwaway RSA key pair for local tests. PayPal signs with the private key
   * behind its certificate; you never hold that key.
   */
  static generateTestKeys() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' })
    };
  }

  /**
   * Build PayPal-style signed headers for local testing.
   */
  static sign(payload, options = {}) {
    const {
      privateKeyPem,
      webhookId,
      transmissionId = crypto.randomUUID(),
      transmissionTime = new Date().toISOString(),
      certUrl = TEST_CERT_URL
    } = options;
    if (!privateKeyPem || !webhookId) {
      throw new Error('privateKeyPem and webhookId are required to sign');
    }
    const message = PaypalWebhookVerifier.buildMessage(transmissionId, transmissionTime, webhookId, payload);
    const signature = crypto.sign('sha256', Buffer.from(message, 'utf8'), privateKeyPem).toString('base64');
    return {
      [HEADER.transmissionId]: transmissionId,
      [HEADER.transmissionTime]: transmissionTime,
      [HEADER.transmissionSig]: signature,
      [HEADER.certUrl]: certUrl,
      [HEADER.authAlgo]: AUTH_ALGO
    };
  }

  /**
   * Parse a downloaded certificate; anything other than a currently valid X.509
   * certificate (e.g. a bare public key or an HTML page) is rejected.
   */
  static parseCertificate(pem) {
    const text = String(pem);
    if (!text.trimStart().startsWith('-----BEGIN CERTIFICATE-----')) {
      throw new Error('Downloaded content is not an X.509 certificate');
    }
    const certificate = new crypto.X509Certificate(text);
    const now = Date.now();
    if (now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo)) {
      throw new Error('Certificate is expired or not yet valid');
    }
    return certificate;
  }

  /**
   * Public key from a caller-supplied PEM: a certificate, or a bare public key
   * for offline tests. Downloaded PEMs go through parseCertificate instead.
   */
  static publicKeyFromPem(pem) {
    if (String(pem).includes('BEGIN CERTIFICATE')) {
      return PaypalWebhookVerifier.parseCertificate(pem).publicKey;
    }
    return crypto.createPublicKey(pem);
  }

  /**
   * Synchronous verification with a known certificate/public key PEM.
   */
  verifySignatureWithCert(payload, headers, certPem) {
    const body = toBuffer(payload);
    const h = PaypalWebhookVerifier.readHeaders(headers);

    if (!PaypalWebhookVerifier.isPaypalCertUrl(h.certUrl)) {
      throw new Error('Untrusted paypal-cert-url');
    }
    if (h.authAlgo && h.authAlgo !== AUTH_ALGO) {
      throw new Error(`Unsupported paypal-auth-algo: ${h.authAlgo}`);
    }
    if (this.toleranceSeconds !== null) {
      const sent = Date.parse(h.transmissionTime);
      if (Number.isNaN(sent) || Math.abs(Date.now() - sent) > this.toleranceSeconds * 1000) {
        throw new Error('paypal-transmission-time outside tolerance');
      }
    }
    if (!certPem) {
      throw new Error('Certificate PEM is required');
    }

    const message = PaypalWebhookVerifier.buildMessage(h.transmissionId, h.transmissionTime, this.webhookId, body);
    const signature = Buffer.from(h.transmissionSig, 'base64');
    const key = PaypalWebhookVerifier.publicKeyFromPem(certPem);
    if (signature.length === 0 || !crypto.verify('sha256', Buffer.from(message, 'utf8'), key, signature)) {
      throw new Error('Invalid webhook signature');
    }
    return true;
  }

  /**
   * Resolve the certificate: injected PEM, else download. Only certificates that
   * parse are cached, and the cache is bounded (oldest entry evicted first).
   */
  async resolveCert(certUrl) {
    if (this.certPem) return this.certPem;
    if (!PaypalWebhookVerifier.isPaypalCertUrl(certUrl)) {
      throw new Error('Untrusted paypal-cert-url');
    }
    if (!this.certCache.has(certUrl)) {
      const pending = Promise.resolve(this.certFetcher(certUrl)).then((pem) => {
        PaypalWebhookVerifier.parseCertificate(pem);
        return pem;
      });
      if (this.certCache.size >= CERT_CACHE_LIMIT) {
        this.certCache.delete(this.certCache.keys().next().value);
      }
      this.certCache.set(certUrl, pending);
    }
    try {
      return await this.certCache.get(certUrl);
    } catch (error) {
      this.certCache.delete(certUrl);
      throw error;
    }
  }

  async verifySignature(payload, headers) {
    const { certUrl } = PaypalWebhookVerifier.readHeaders(headers);
    const certPem = await this.resolveCert(certUrl);
    return this.verifySignatureWithCert(payload, headers, certPem);
  }

  static parseEvent(payload) {
    const event = JSON.parse(toBuffer(payload).toString('utf8'));
    if (!event.id || !event.event_type || !event.resource) {
      throw new Error('Invalid event structure');
    }
    return {
      id: event.id,
      type: event.event_type,
      resourceType: event.resource_type,
      createTime: event.create_time,
      data: event.resource
    };
  }

  /**
   * Verify and parse synchronously; requires options.certPem.
   */
  process(payload, headers) {
    try {
      this.verifySignatureWithCert(payload, headers, this.certPem);
      return { success: true, event: PaypalWebhookVerifier.parseEvent(payload) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify (downloading the certificate when needed) and parse.
   */
  async processAsync(payload, headers) {
    try {
      await this.verifySignature(payload, headers);
      return { success: true, event: PaypalWebhookVerifier.parseEvent(payload) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static getEventCategory(eventType) {
    const categories = {
      'CHECKOUT.': 'checkout',
      'PAYMENT.CAPTURE.': 'capture',
      'PAYMENT.AUTHORIZATION.': 'authorization',
      'PAYMENT.REFUND.': 'refund',
      'PAYMENT.SALE.': 'sale',
      'BILLING.SUBSCRIPTION.': 'subscription',
      'BILLING.PLAN.': 'plan',
      'CATALOG.PRODUCT.': 'product',
      'CUSTOMER.DISPUTE.': 'dispute',
      'VAULT.PAYMENT-TOKEN.': 'vault'
    };

    for (const [prefix, category] of Object.entries(categories)) {
      if (eventType.startsWith(prefix)) {
        return category;
      }
    }
    return 'unknown';
  }

  /**
   * Money collected: an order capture or a subscription cycle payment.
   */
  static isPaymentEvent(eventType) {
    return eventType === 'PAYMENT.CAPTURE.COMPLETED' || eventType === 'PAYMENT.SALE.COMPLETED';
  }

  static isSubscriptionEvent(eventType) {
    return eventType.startsWith('BILLING.SUBSCRIPTION.');
  }
}

// CLI Usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node paypal-webhook-verify.js <webhook-payload-json> [webhook-id]');
    console.log('\nWebhook ID can also be provided via PAYPAL_WEBHOOK_ID environment variable');
    console.log('\nExample:');
    console.log('  node paypal-webhook-verify.js \'{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{...}}\' WEBHOOK_ID');
    process.exit(1);
  }

  try {
    const payload = args[0];
    const webhookId = args[1] || process.env.PAYPAL_WEBHOOK_ID;

    if (!webhookId) {
      console.error('✗ Error: Webhook ID is required');
      console.error('Provide it as second argument or set PAYPAL_WEBHOOK_ID environment variable');
      process.exit(1);
    }

    // Self-test: sign with a throwaway key pair, then verify with its public key
    const { privateKeyPem, publicKeyPem } = PaypalWebhookVerifier.generateTestKeys();
    const headers = PaypalWebhookVerifier.sign(payload, { privateKeyPem, webhookId });
    const verifier = new PaypalWebhookVerifier(webhookId, { certPem: publicKeyPem });
    const result = verifier.process(payload, headers);

    if (result.success) {
      console.log('✓ Webhook verified successfully\n');
      console.log('Event Details:');
      console.log(`  ID: ${result.event.id}`);
      console.log(`  Type: ${result.event.type}`);
      console.log(`  Category: ${PaypalWebhookVerifier.getEventCategory(result.event.type)}`);
      console.log(`  Is Payment: ${PaypalWebhookVerifier.isPaymentEvent(result.event.type) ? 'Yes' : 'No'}`);
      console.log(`  Is Subscription: ${PaypalWebhookVerifier.isSubscriptionEvent(result.event.type) ? 'Yes' : 'No'}`);
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

PaypalWebhookVerifier.crc32Table = crc32Table; // table fallback, exported for tests
module.exports = PaypalWebhookVerifier;
