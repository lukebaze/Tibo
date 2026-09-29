#!/usr/bin/env node

/**
 * Test suite for payment integration scripts
 */

const SePayWebhookVerifier = require('./sepay-webhook-verify');
const PolarWebhookVerifier = require('./polar-webhook-verify');
const CreemWebhookVerifier = require('./creem-webhook-verify');
const PayfsWebhookVerifier = require('./payfs-webhook-verify');
const DodoWebhookVerifier = require('./dodo-webhook-verify');
const LemonSqueezyWebhookVerifier = require('./lemonsqueezy-webhook-verify');
const PaddleWebhookVerifier = require('./paddle-webhook-verify');
const PaypalWebhookVerifier = require('./paypal-webhook-verify');
const CheckoutHelper = require('./checkout-helper');

class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
  }

  test(name, fn) {
    try {
      fn();
      console.log(`✓ ${name}`);
      this.passed++;
    } catch (error) {
      console.error(`✗ ${name}`);
      console.error(`  Error: ${error.message}`);
      this.failed++;
    }
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  }

  summary() {
    console.log(`\nTest Summary: ${this.passed} passed, ${this.failed} failed`);
    return this.failed === 0;
  }
}

// Run tests
console.log('Running Payment Integration Script Tests\n');
const runner = new TestRunner();

// SePay Webhook Verifier Tests
console.log('SePay Webhook Verifier Tests:');

runner.test('should verify valid SePay webhook', () => {
  const verifier = new SePayWebhookVerifier('none');
  const payload = {
    id: 12345,
    gateway: 'Vietcombank',
    transactionDate: '2025-01-13 10:00:00',
    accountNumber: '0123456789',
    transferType: 'in',
    transferAmount: 100000,
    referenceCode: 'REF123',
    content: 'Order payment'
  };

  const result = verifier.process(payload);
  runner.assert(result.success === true, 'Should verify successfully');
  runner.assert(result.transaction.id === 12345, 'Should parse transaction ID');
  runner.assert(result.isIncoming === true, 'Should detect incoming transfer');
});

runner.test('should reject invalid SePay transfer type', () => {
  const verifier = new SePayWebhookVerifier('none');
  const payload = {
    id: 12345,
    gateway: 'Vietcombank',
    transactionDate: '2025-01-13 10:00:00',
    accountNumber: '0123456789',
    transferType: 'invalid',
    transferAmount: 100000,
    referenceCode: 'REF123'
  };

  const result = verifier.process(payload);
  runner.assert(result.success === false, 'Should fail validation');
  runner.assert(result.error.includes('Invalid transferType'), 'Should report invalid transfer type');
});

runner.test('should verify SePay webhook with API key', () => {
  const verifier = new SePayWebhookVerifier('api_key', 'test_key_123');
  const payload = {
    id: 12345,
    gateway: 'Vietcombank',
    transactionDate: '2025-01-13 10:00:00',
    accountNumber: '0123456789',
    transferType: 'in',
    transferAmount: 100000,
    referenceCode: 'REF123'
  };

  const headers = { Authorization: 'Apikey test_key_123' };
  const result = verifier.process(payload, headers);
  runner.assert(result.success === true, 'Should verify with valid API key');
});

runner.test('should reject SePay webhook with invalid API key', () => {
  const verifier = new SePayWebhookVerifier('api_key', 'test_key_123');
  const payload = {
    id: 12345,
    gateway: 'Vietcombank',
    transactionDate: '2025-01-13 10:00:00',
    accountNumber: '0123456789',
    transferType: 'in',
    transferAmount: 100000,
    referenceCode: 'REF123'
  };

  const headers = { Authorization: 'Apikey wrong_key' };
  const result = verifier.process(payload, headers);
  runner.assert(result.success === false, 'Should reject invalid API key');
});

runner.test('should verify SePay HMAC-SHA256 webhook', () => {
  const body = JSON.stringify({
    id: 1,
    gateway: 'Vietcombank',
    transactionDate: '2026-01-01 10:00:00',
    accountNumber: '0123456789',
    transferType: 'in',
    transferAmount: 1000,
    referenceCode: 'REF1'
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const verifier = new SePayWebhookVerifier('hmac', 'secret');
  const headers = { 'X-SePay-Signature': SePayWebhookVerifier.sign('secret', ts, body), 'X-SePay-Timestamp': ts };

  runner.assert(verifier.process(body, headers).success === true, 'Valid HMAC should pass');
  runner.assert(verifier.process(body.replace('1000', '1001'), headers).success === false, 'Tampered body should fail');
});

// Polar Webhook Verifier Tests
console.log('\nPolar Webhook Verifier Tests:');

runner.test('should verify valid Polar webhook (both signing schemes)', () => {
  const crypto = require('crypto');
  const secret = `whsec_${Buffer.from('test_secret_key').toString('base64')}`;
  const verifier = new PolarWebhookVerifier(secret);

  const payload = JSON.stringify({
    type: 'order.paid',
    data: { id: 'order_123', amount: 2000 }
  });

  // Independent Standard Webhooks signature: HMAC over "id.timestamp.body"
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHmac('sha256', Buffer.from('test_secret_key'))
    .update(`msg_123.${timestamp}.${payload}`)
    .digest('base64');
  const headers = {
    'webhook-id': 'msg_123',
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`
  };

  const result = verifier.process(payload, headers);
  if (!result.success) {
    throw new Error(`Verification failed: ${result.error}`);
  }
  runner.assertEqual(result.event.type, 'order.paid', 'Should parse event type');

  const legacy = verifier.process(payload, PolarWebhookVerifier.sign(payload, secret, { scheme: 'legacy' }));
  runner.assert(legacy.success === true, 'Should verify legacy Polar HMAC scheme');

  const tampered = verifier.process(payload.replace('2000', '2001'), headers);
  runner.assert(tampered.success === false, 'Should reject tampered body');
});

runner.test('should reject Polar webhook with invalid signature', () => {
  const secret = Buffer.from('test_secret_key').toString('base64');
  const verifier = new PolarWebhookVerifier(secret);

  const payload = JSON.stringify({
    type: 'order.paid',
    data: { id: 'order_123' }
  });

  const headers = {
    'webhook-id': 'msg_123',
    'webhook-timestamp': Math.floor(Date.now() / 1000).toString(),
    'webhook-signature': 'v1=invalid_signature'
  };

  const result = verifier.process(payload, headers);
  runner.assert(result.success === false, 'Should reject invalid signature');
});

runner.test('should categorize Polar event types', () => {
  runner.assertEqual(PolarWebhookVerifier.getEventCategory('order.paid'), 'order');
  runner.assertEqual(PolarWebhookVerifier.getEventCategory('subscription.active'), 'subscription');
  runner.assertEqual(PolarWebhookVerifier.getEventCategory('customer.created'), 'customer');
  runner.assert(PolarWebhookVerifier.isPaymentEvent('order.paid') === true);
  runner.assert(PolarWebhookVerifier.isSubscriptionEvent('subscription.active') === true);
});

// Creem Webhook Verifier Tests
console.log('\nCreem Webhook Verifier Tests:');

runner.test('should verify valid Creem webhook', () => {
  const crypto = require('crypto');
  const secret = 'whsec_test_secret';
  const verifier = new CreemWebhookVerifier(secret);
  const payload = JSON.stringify({
    id: 'evt_123',
    eventType: 'checkout.completed',
    created_at: 1728734325927,
    object: { id: 'ch_123', request_id: 'order_123' }
  });

  // Independent signature: hex HMAC-SHA256 of the raw body, secret used as-is
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const result = verifier.process(payload, { 'Creem-Signature': signature });
  if (!result.success) {
    throw new Error(`Verification failed: ${result.error}`);
  }
  runner.assertEqual(result.event.type, 'checkout.completed', 'Should parse event type');
  runner.assertEqual(result.event.id, 'evt_123', 'Should expose event id for idempotency');
  runner.assert(verifier.process(payload, CreemWebhookVerifier.sign(payload, secret)).success === true, 'sign() should match');
});

runner.test('should reject tampered Creem webhook', () => {
  const secret = 'whsec_test_secret';
  const verifier = new CreemWebhookVerifier(secret);
  const payload = JSON.stringify({ id: 'evt_123', eventType: 'subscription.paid', object: { id: 'sub_123', amount: 2000 } });
  const headers = CreemWebhookVerifier.sign(payload, secret);

  const result = verifier.process(payload.replace('2000', '2001'), headers);
  runner.assert(result.success === false, 'Should reject tampered body');
  runner.assertEqual(result.error, 'Invalid webhook signature');
});

runner.test('should reject Creem webhook without signature header', () => {
  const verifier = new CreemWebhookVerifier('whsec_test_secret');
  const payload = JSON.stringify({ id: 'evt_123', eventType: 'checkout.completed', object: {} });

  const result = verifier.process(payload, {});
  runner.assert(result.success === false, 'Should reject missing header');
  runner.assert(result.error.includes('creem-signature'), 'Should name the missing header');
  runner.assert(verifier.process(JSON.parse(payload), {}).success === false, 'Should require raw body');
});

runner.test('should categorize Creem event types', () => {
  runner.assertEqual(CreemWebhookVerifier.getEventCategory('refund.created'), 'refund');
  runner.assertEqual(CreemWebhookVerifier.getEventCategory('customer_credits.exhausted'), 'credits');
  runner.assert(CreemWebhookVerifier.isPaymentEvent('subscription.paid') === true);
  runner.assert(CreemWebhookVerifier.isPaymentEvent('subscription.active') === false);
  runner.assert(CreemWebhookVerifier.isSubscriptionEvent('subscription.canceled') === true);
});

// PayFS Webhook Verifier Tests
console.log('\nPayFS Webhook Verifier Tests:');

const PAYFS_VECTOR = {
  secret: 'whsec_example_secret_do_not_use_in_production',
  timestamp: 1758173916,
  body: '{"account_id":"1418079746853494784","amount":14000,"bank":"MB","bank_account_number":"0933723830","content":"NGUYEN VAN A chuyen tien  Ma giao dich  Trace773231","transaction_date":"2025-09-15T15:02:00.000Z","transaction_id":"1418108930751619072","transfer_type":"credit"}',
  signature: '86f02cefae56d51f72a00e04bf9d5a96b40cfe6902d54e495234c447ec706c5e'
};

runner.test('should verify PayFS documented test vector', () => {
  const verifier = new PayfsWebhookVerifier(PAYFS_VECTOR.secret, {
    apiKey: 'pk_test_key',
    now: () => PAYFS_VECTOR.timestamp + 10
  });
  const headers = {
    'X-Client-API-Key': 'pk_test_key',
    'X-PayFS-Signature': PAYFS_VECTOR.signature,
    'X-PayFS-Timestamp': String(PAYFS_VECTOR.timestamp),
    'X-PayFS-Attempt': '2'
  };

  const result = verifier.process(PAYFS_VECTOR.body, headers);
  if (!result.success) {
    throw new Error(`Verification failed: ${result.error}`);
  }
  runner.assertEqual(result.event.type, 'transaction.credit', 'Should infer event type from transfer_type');
  runner.assertEqual(result.event.id, '1418108930751619072', 'Should expose transaction_id for idempotency');
  runner.assertEqual(result.event.attempt, 2, 'Should expose X-PayFS-Attempt');
  runner.assert(PayfsWebhookVerifier.isPaymentEvent(result.event.type) === true);
});

runner.test('should verify PayFS signature over sorted keys regardless of body key order', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ transfer_type: 'debit', transaction_id: '9', amount: 5000, content: 'refund' });
  const headers = PayfsWebhookVerifier.sign(body, secret, { apiKey: 'pk_test_key' });
  const verifier = new PayfsWebhookVerifier(secret, { apiKey: 'pk_test_key' });

  const result = verifier.process(Buffer.from(body), headers);
  runner.assert(result.success === true, 'Valid signature should pass');
  runner.assertEqual(result.event.type, 'transaction.debit');
  runner.assert(PayfsWebhookVerifier.isPaymentEvent(result.event.type) === false, 'Debit is not a payment');
  runner.assertEqual(
    PayfsWebhookVerifier.canonicalize(body),
    '{"amount":5000,"content":"refund","transaction_id":"9","transfer_type":"debit"}'
  );
});

runner.test('should reject tampered, expired or prefixed PayFS webhooks', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ transaction_id: '1', amount: 1000, transfer_type: 'credit' });
  const headers = PayfsWebhookVerifier.sign(body, secret, { apiKey: 'pk_test_key' });
  const verifier = new PayfsWebhookVerifier(secret, { apiKey: 'pk_test_key' });

  const tampered = verifier.process(body.replace('1000', '1001'), headers);
  runner.assertEqual(tampered.error, 'Invalid webhook signature', 'Tampered body should fail');

  const late = new PayfsWebhookVerifier(secret, { apiKey: 'pk_test_key', now: () => Number(headers['x-payfs-timestamp']) + 301 });
  runner.assertEqual(late.process(body, headers).error, 'Signature timestamp outside tolerance');

  const prefixed = { ...headers, 'x-payfs-signature': `sha256=${headers['x-payfs-signature']}` };
  runner.assert(verifier.process(body, prefixed).success === false, 'PayFS sends raw hex; prefixed value must fail');
  runner.assert(verifier.process(JSON.parse(body), headers).success === false, 'Should require raw body');
});

runner.test('should enforce PayFS X-Client-API-Key and parse order events', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ order_id: '77', amount: 250000, status: 'success' });
  const verifier = new PayfsWebhookVerifier(secret, { apiKey: 'pk_test_key' });

  const missing = verifier.process(body, PayfsWebhookVerifier.sign(body, secret));
  runner.assert(missing.error.includes('X-Client-API-Key'), 'Should name the missing header');

  const wrong = verifier.process(body, PayfsWebhookVerifier.sign(body, secret, { apiKey: 'pk_wrong' }));
  runner.assertEqual(wrong.error, 'Invalid API key');

  const ok = verifier.process(body, PayfsWebhookVerifier.sign(body, secret, { apiKey: 'pk_test_key' }));
  runner.assert(ok.success === true, 'Valid API key and signature should pass');
  runner.assertEqual(ok.event.type, 'order.success');
  runner.assertEqual(ok.event.id, '77:success', 'Order idempotency key combines order_id and status');
});

runner.test('should require a PayFS API key and keep __proto__ keys in the signed data', () => {
  let threw = false;
  try { new PayfsWebhookVerifier('whsec_payfs'); } catch { threw = true; }
  runner.assert(threw, 'Constructor should require apiKey unless allowMissingApiKey is set');
  runner.assert(new PayfsWebhookVerifier('whsec_payfs', { allowMissingApiKey: true }) !== null);

  const canonical = PayfsWebhookVerifier.canonicalize(JSON.parse('{"b":1,"__proto__":{"x":1}}'));
  runner.assert(canonical.includes('"__proto__"'), '__proto__ must not drop out of the signed string');
});

// Dodo Payments Webhook Verifier Tests
console.log('\nDodo Payments Webhook Verifier Tests:');

runner.test('should verify valid Dodo Payments webhook', () => {
  const crypto = require('crypto');
  const secret = 'whsec_dGVzdF9zZWNyZXRfa2V5'; // base64("test_secret_key")
  const verifier = new DodoWebhookVerifier(secret);
  const payload = JSON.stringify({
    business_id: 'bus_123',
    type: 'payment.succeeded',
    timestamp: '2026-09-26T10:30:00Z',
    data: { payload_type: 'Payment', payment_id: 'pay_123', total_amount: 2999 }
  });

  // Independent signature: base64 HMAC-SHA256 over "id.timestamp.body", key = base64-decoded secret
  const id = 'msg_123';
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', Buffer.from('dGVzdF9zZWNyZXRfa2V5', 'base64'))
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
  const result = verifier.process(payload, {
    'Webhook-Id': id,
    'Webhook-Timestamp': String(timestamp),
    'Webhook-Signature': `v1,invalidsig v1,${signature}` // any matching v1 entry passes
  });
  if (!result.success) {
    throw new Error(`Verification failed: ${result.error}`);
  }
  runner.assertEqual(result.event.type, 'payment.succeeded', 'Should parse event type');
  runner.assertEqual(result.event.id, 'msg_123', 'Should expose webhook-id for idempotency');

  // Standard Webhooks reference test vector
  const vector = DodoWebhookVerifier.sign('{"test": 2432232314}', 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', {
    id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
    timestamp: 1614265330
  });
  runner.assertEqual(vector['webhook-signature'], 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=', 'sign() should match the spec vector');
});

runner.test('should reject tampered or stale Dodo Payments webhook', () => {
  const secret = 'whsec_dGVzdF9zZWNyZXRfa2V5';
  const verifier = new DodoWebhookVerifier(secret);
  const payload = JSON.stringify({ business_id: 'bus_123', type: 'refund.succeeded', timestamp: '2026-09-26T10:30:00Z', data: { payload_type: 'Refund', amount: 2000 } });
  const headers = DodoWebhookVerifier.sign(payload, secret);

  const tampered = verifier.process(payload.replace('2000', '2001'), headers);
  runner.assert(tampered.success === false, 'Should reject tampered body');
  runner.assertEqual(tampered.error, 'Invalid webhook signature');

  const stale = verifier.process(payload, DodoWebhookVerifier.sign(payload, secret, { timestamp: Math.floor(Date.now() / 1000) - 600 }));
  runner.assert(stale.success === false, 'Should reject timestamps older than 5 minutes');
  runner.assertEqual(stale.error, 'Webhook timestamp too old');
});

runner.test('should reject Dodo Payments webhook without signature headers', () => {
  const verifier = new DodoWebhookVerifier('whsec_dGVzdF9zZWNyZXRfa2V5');
  const payload = JSON.stringify({ business_id: 'bus_123', type: 'payment.succeeded', data: { payload_type: 'Payment' } });

  const result = verifier.process(payload, {});
  runner.assert(result.success === false, 'Should reject missing headers');
  runner.assert(result.error.includes('webhook-signature'), 'Should name the missing header');
  runner.assert(verifier.process(JSON.parse(payload), {}).success === false, 'Should require raw body');
});

runner.test('should categorize Dodo Payments event types', () => {
  runner.assertEqual(DodoWebhookVerifier.getEventCategory('refund.succeeded'), 'refund');
  runner.assertEqual(DodoWebhookVerifier.getEventCategory('license_key.created'), 'license_key');
  runner.assertEqual(DodoWebhookVerifier.getEventCategory('dunning.started'), 'recovery');
  runner.assert(DodoWebhookVerifier.isPaymentEvent('payment.succeeded') === true);
  runner.assert(DodoWebhookVerifier.isPaymentEvent('subscription.active') === false);
  runner.assert(DodoWebhookVerifier.isSubscriptionEvent('subscription.renewed') === true);
});

// Lemon Squeezy Webhook Verifier Tests
console.log('\nLemon Squeezy Webhook Verifier Tests:');

runner.test('should verify valid Lemon Squeezy webhook', () => {
  const crypto = require('crypto');
  const secret = 'test_signing_secret';
  const verifier = new LemonSqueezyWebhookVerifier(secret);
  const payload = JSON.stringify({
    meta: { event_name: 'order_created', custom_data: { user_id: 'user_123' } },
    data: {
      type: 'orders',
      id: '1',
      attributes: { store_id: 1, status: 'paid', total: 1199, test_mode: true, updated_at: '2026-09-26T10:00:00.000000Z' }
    }
  });

  // Independent signature: hex HMAC-SHA256 of the raw body, secret used as-is
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const result = verifier.process(payload, { 'X-Signature': signature, 'X-Event-Name': 'order_created' });
  if (!result.success) {
    throw new Error(`Verification failed: ${result.error}`);
  }
  runner.assertEqual(result.event.name, 'order_created', 'Should read meta.event_name');
  runner.assertEqual(result.event.id, '1', 'Should expose resource id');
  runner.assertEqual(result.event.customData.user_id, 'user_123', 'Should expose meta.custom_data');
  runner.assert(result.event.testMode === true, 'Should expose test_mode');
  runner.assertEqual(result.event.dedupeKey, 'order_created:orders:1:2026-09-26T10:00:00.000000Z', 'Should derive dedupe key');
  runner.assert(verifier.process(Buffer.from(payload), LemonSqueezyWebhookVerifier.sign(payload, secret)).success === true, 'sign() should match; Buffer body accepted');
});

runner.test('should reject tampered Lemon Squeezy webhook', () => {
  const secret = 'test_signing_secret';
  const verifier = new LemonSqueezyWebhookVerifier(secret);
  const payload = JSON.stringify({
    meta: { event_name: 'subscription_payment_success' },
    data: { type: 'subscription-invoices', id: '7', attributes: { total: 2000 } }
  });
  const headers = LemonSqueezyWebhookVerifier.sign(payload, secret);

  const tampered = verifier.process(payload.replace('2000', '2001'), headers);
  runner.assert(tampered.success === false, 'Should reject tampered body');
  runner.assertEqual(tampered.error, 'Invalid webhook signature');

  const wrongName = verifier.process(payload, { ...headers, 'X-Event-Name': 'order_created' });
  runner.assert(wrongName.success === false, 'Should reject unsigned X-Event-Name that disagrees with the body');
});

runner.test('should reject Lemon Squeezy webhook without signature header', () => {
  const verifier = new LemonSqueezyWebhookVerifier('test_signing_secret');
  const payload = JSON.stringify({ meta: { event_name: 'order_created' }, data: { type: 'orders', id: '1', attributes: {} } });

  const result = verifier.process(payload, { 'X-Event-Name': 'order_created' });
  runner.assert(result.success === false, 'Should reject missing header');
  runner.assert(result.error.includes('X-Signature'), 'Should name the missing header');
  runner.assert(verifier.process(JSON.parse(payload), {}).success === false, 'Should require raw body');
});

runner.test('should categorize Lemon Squeezy event names', () => {
  runner.assertEqual(LemonSqueezyWebhookVerifier.getEventCategory('order_refunded'), 'order');
  runner.assertEqual(LemonSqueezyWebhookVerifier.getEventCategory('subscription_payment_failed'), 'subscription_payment');
  runner.assertEqual(LemonSqueezyWebhookVerifier.getEventCategory('subscription_updated'), 'subscription');
  runner.assertEqual(LemonSqueezyWebhookVerifier.getEventCategory('license_key_created'), 'license_key');
  runner.assertEqual(LemonSqueezyWebhookVerifier.getEventCategory('customer_updated'), 'customer');
  runner.assert(LemonSqueezyWebhookVerifier.isPaymentEvent('subscription_payment_success') === true);
  runner.assert(LemonSqueezyWebhookVerifier.isPaymentEvent('subscription_created') === false);
  runner.assert(LemonSqueezyWebhookVerifier.isRefundEvent('subscription_payment_refunded') === true);
  runner.assert(LemonSqueezyWebhookVerifier.isSubscriptionEvent('subscription_expired') === true);
});

// Paddle Webhook Verifier Tests
console.log('\nPaddle Webhook Verifier Tests:');

runner.test('should verify valid Paddle webhook', () => {
  const crypto = require('crypto');
  const secret = 'pdl_ntfset_test_secret';
  const verifier = new PaddleWebhookVerifier(secret);
  const payload = JSON.stringify({
    event_id: 'evt_123',
    event_type: 'transaction.completed',
    occurred_at: '2026-09-26T10:00:00.000Z',
    notification_id: 'ntf_123',
    data: { id: 'txn_123', custom_data: { orderId: 'order_123' } }
  });

  // Independent signature: hex HMAC-SHA256 over "ts:rawBody"
  const ts = Math.floor(Date.now() / 1000);
  const h1 = crypto.createHmac('sha256', secret).update(`${ts}:${payload}`).digest('hex');
  const result = verifier.process(payload, { 'Paddle-Signature': `ts=${ts};h1=${h1}` });
  if (!result.success) {
    throw new Error(`Verification failed: ${result.error}`);
  }
  runner.assertEqual(result.event.type, 'transaction.completed', 'Should parse event type');
  runner.assertEqual(result.event.id, 'evt_123', 'Should expose event_id for idempotency');
  runner.assert(verifier.process(payload, PaddleWebhookVerifier.sign(payload, secret)).success === true, 'sign() should match');

  // Secret rotation: any matching h1 passes
  const rotated = { 'paddle-signature': `ts=${ts};h1=${'0'.repeat(64)};h1=${h1}` };
  runner.assert(verifier.process(payload, rotated).success === true, 'Should accept any matching h1');
});

runner.test('should reject tampered or expired Paddle webhook', () => {
  const secret = 'pdl_ntfset_test_secret';
  const verifier = new PaddleWebhookVerifier(secret);
  const payload = JSON.stringify({ event_id: 'evt_123', event_type: 'transaction.paid', data: { id: 'txn_123', total: '2000' } });

  const tampered = verifier.process(payload.replace('2000', '2001'), PaddleWebhookVerifier.sign(payload, secret));
  runner.assert(tampered.success === false, 'Should reject tampered body');
  runner.assertEqual(tampered.error, 'Invalid webhook signature');

  const old = PaddleWebhookVerifier.sign(payload, secret, { timestamp: Math.floor(Date.now() / 1000) - 60 });
  runner.assert(verifier.process(payload, old).success === false, 'Should reject timestamp outside 5 s tolerance');
  runner.assert(new PaddleWebhookVerifier(secret, { toleranceSeconds: 0 }).process(payload, old).success === true, 'toleranceSeconds 0 disables the check');
});

runner.test('should reject Paddle webhook without valid signature header', () => {
  const verifier = new PaddleWebhookVerifier('pdl_ntfset_test_secret');
  const payload = JSON.stringify({ event_id: 'evt_123', event_type: 'transaction.completed', data: {} });

  const missing = verifier.process(payload, {});
  runner.assert(missing.success === false, 'Should reject missing header');
  runner.assert(missing.error.includes('Paddle-Signature'), 'Should name the missing header');
  runner.assert(verifier.process(payload, { 'paddle-signature': 'h1=abc' }).success === false, 'Should reject header without ts');
  runner.assert(verifier.process(JSON.parse(payload), {}).success === false, 'Should require raw body');
});

runner.test('should categorize Paddle event types', () => {
  runner.assertEqual(PaddleWebhookVerifier.getEventCategory('transaction.paid'), 'transaction');
  runner.assertEqual(PaddleWebhookVerifier.getEventCategory('adjustment.updated'), 'adjustment');
  runner.assertEqual(PaddleWebhookVerifier.getEventCategory('payment_method.saved'), 'payment_method');
  runner.assertEqual(PaddleWebhookVerifier.getEventCategory('checkout.completed'), 'unknown');
  runner.assert(PaddleWebhookVerifier.isPaymentEvent('transaction.completed') === true);
  runner.assert(PaddleWebhookVerifier.isPaymentEvent('transaction.created') === false);
  runner.assert(PaddleWebhookVerifier.isSubscriptionEvent('subscription.canceled') === true);
  runner.assert(PaddleWebhookVerifier.isAdjustmentEvent('adjustment.created') === true);
});

// PayPal Webhook Verifier Tests
console.log('\nPayPal Webhook Verifier Tests:');

const paypalKeys = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 });
const paypalPublicPem = paypalKeys.publicKey.export({ type: 'spki', format: 'pem' });
const paypalPrivatePem = paypalKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const paypalPayload = JSON.stringify({
  id: 'WH-3F562076HD293871E-75F399086E414290U',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource_type: 'capture',
  resource: { id: '3Y662965014333303', status: 'COMPLETED', amount: { value: '500.00', currency_code: 'USD' } }
});

runner.test('should verify valid PayPal webhook', () => {
  const crypto = require('crypto');
  runner.assertEqual(PaypalWebhookVerifier.crc32('123456789'), 3421780262, 'CRC32 check value (0xCBF43926)');
  runner.assertEqual(PaypalWebhookVerifier.crc32Table(Buffer.from('123456789')), 3421780262, 'Table fallback must match');

  // Independent signature: RSA-SHA256 over "transmissionId|transmissionTime|webhookId|crc32(decimal)"
  const transmissionId = 'db49fb10-1343-11ef-ac58-e32457403f67';
  const transmissionTime = new Date().toISOString();
  const message = `${transmissionId}|${transmissionTime}|WH-ID-123|${PaypalWebhookVerifier.crc32(paypalPayload)}`;
  const headers = {
    'PAYPAL-TRANSMISSION-ID': transmissionId,
    'PAYPAL-TRANSMISSION-TIME': transmissionTime,
    'PAYPAL-TRANSMISSION-SIG': crypto.sign('sha256', Buffer.from(message), paypalPrivatePem).toString('base64'),
    'PAYPAL-CERT-URL': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d',
    'PAYPAL-AUTH-ALGO': 'SHA256withRSA'
  };

  const verifier = new PaypalWebhookVerifier('WH-ID-123', { certPem: paypalPublicPem, toleranceSeconds: 300 });
  const result = verifier.process(paypalPayload, headers);
  if (!result.success) {
    throw new Error(`Verification failed: ${result.error}`);
  }
  runner.assertEqual(result.event.type, 'PAYMENT.CAPTURE.COMPLETED', 'Should parse event type');
  runner.assertEqual(result.event.id, 'WH-3F562076HD293871E-75F399086E414290U', 'Should expose event id for idempotency');
  const signed = PaypalWebhookVerifier.sign(paypalPayload, { privateKeyPem: paypalPrivatePem, webhookId: 'WH-ID-123' });
  runner.assert(verifier.process(Buffer.from(paypalPayload), signed).success === true, 'sign() should match');
});

runner.test('should reject tampered PayPal webhook', () => {
  const headers = PaypalWebhookVerifier.sign(paypalPayload, { privateKeyPem: paypalPrivatePem, webhookId: 'WH-ID-123' });
  const verifier = new PaypalWebhookVerifier('WH-ID-123', { certPem: paypalPublicPem });

  const tampered = verifier.process(paypalPayload.replace('500.00', '501.00'), headers);
  runner.assert(tampered.success === false, 'Should reject tampered body');
  runner.assertEqual(tampered.error, 'Invalid webhook signature');

  const otherListener = new PaypalWebhookVerifier('WH-OTHER', { certPem: paypalPublicPem });
  runner.assert(otherListener.process(paypalPayload, headers).success === false, 'Should reject another webhook ID');
});

runner.test('should reject PayPal webhook with missing header or untrusted cert URL', () => {
  const verifier = new PaypalWebhookVerifier('WH-ID-123', { certPem: paypalPublicPem });
  const headers = PaypalWebhookVerifier.sign(paypalPayload, { privateKeyPem: paypalPrivatePem, webhookId: 'WH-ID-123' });

  const { 'paypal-transmission-sig': _omitted, ...missingSig } = headers;
  const missing = verifier.process(paypalPayload, missingSig);
  runner.assert(missing.success === false, 'Should reject missing header');
  runner.assert(missing.error.includes('paypal-transmission-sig'), 'Should name the missing header');

  const evil = verifier.process(paypalPayload, { ...headers, 'paypal-cert-url': 'https://paypal.com.evil.example/cert' });
  runner.assertEqual(evil.error, 'Untrusted paypal-cert-url');
  runner.assert(PaypalWebhookVerifier.isPaypalCertUrl('http://api.paypal.com/v1/notifications/certs/CERT-1') === false, 'Should require HTTPS');
  for (const url of [
    'https://www.paypal.com/v1/notifications/certs/CERT-1',
    'https://api.paypal.com/other?q=1',
    'https://api.paypal.com/v1/notifications/certs/CERT-1?q=1',
    'https://user@api.paypal.com/v1/notifications/certs/CERT-1',
    'https://api.paypal.com:8443/v1/notifications/certs/CERT-1',
  ]) {
    runner.assert(PaypalWebhookVerifier.isPaypalCertUrl(url) === false, `Should reject ${url}`);
  }
  runner.assert(PaypalWebhookVerifier.isPaypalCertUrl('https://api-m.paypal.com/v1/notifications/certs/CERT-1') === true);
  runner.assert(verifier.process(JSON.parse(paypalPayload), headers).success === false, 'Should require raw body');
});

runner.test('should categorize PayPal event types', () => {
  runner.assertEqual(PaypalWebhookVerifier.getEventCategory('PAYMENT.CAPTURE.REFUNDED'), 'capture');
  runner.assertEqual(PaypalWebhookVerifier.getEventCategory('CHECKOUT.ORDER.APPROVED'), 'checkout');
  runner.assertEqual(PaypalWebhookVerifier.getEventCategory('BILLING.SUBSCRIPTION.CANCELLED'), 'subscription');
  runner.assert(PaypalWebhookVerifier.isPaymentEvent('PAYMENT.SALE.COMPLETED') === true);
  runner.assert(PaypalWebhookVerifier.isPaymentEvent('CHECKOUT.ORDER.APPROVED') === false);
  runner.assert(PaypalWebhookVerifier.isSubscriptionEvent('BILLING.SUBSCRIPTION.ACTIVATED') === true);
});

// Checkout Helper Tests
console.log('\nCheckout Helper Tests:');

runner.test('should generate SePay checkout fields', () => {
  const config = {
    merchantId: 'SP-TEST-123',
    secretKey: 'test_secret',
    orderInvoiceNumber: 'ORD001',
    orderAmount: 100000,
    successUrl: 'https://example.com/success',
    errorUrl: 'https://example.com/error',
    cancelUrl: 'https://example.com/cancel',
    env: 'sandbox'
  };

  const result = CheckoutHelper.generateSePayCheckout(config);
  runner.assert(result.fields !== undefined, 'Should generate fields');
  runner.assert(result.fields.signature !== undefined, 'Should generate signature');
  runner.assertEqual(result.fields.merchant, 'SP-TEST-123', 'Should include merchant');
  runner.assertEqual(result.formUrl, 'https://pay-sandbox.sepay.vn/v1/checkout/init', 'Should use sandbox init URL');

  const expected = require('crypto')
    .createHmac('sha256', 'test_secret')
    .update('merchant=SP-TEST-123,currency=VND,order_amount=100000,operation=PURCHASE,order_description=Order ORD001,order_invoice_number=ORD001,success_url=https://example.com/success,error_url=https://example.com/error,cancel_url=https://example.com/cancel')
    .digest('base64');
  runner.assertEqual(result.fields.signature, expected, 'Signature must follow SePay spec');

  const unsafe = CheckoutHelper.generateSePayCheckout({ ...config, orderDescription: 'x"><img src=x>' });
  runner.assert(unsafe.htmlForm.includes('value="x&quot;&gt;&lt;img src=x&gt;"'), 'Should escape form values');
});

runner.test('should generate Polar checkout config', () => {
  const config = {
    productId: 'prod_123',
    successUrl: 'https://example.com/success',
    externalCustomerId: 'user_123',
    accessToken: 'test_token',
    server: 'sandbox'
  };

  const result = CheckoutHelper.generatePolarCheckout(config);
  runner.assert(result.config !== undefined, 'Should generate config');
  runner.assertEqual(result.config.products[0], 'prod_123', 'Should include product ID');
  runner.assert(!('product_price_id' in result.config), 'Should not send deprecated product_price_id');
  runner.assertEqual(result.config.external_customer_id, 'user_123', 'Should include customer ID');
  runner.assert(result.apiEndpoint.includes('sandbox'), 'Should use sandbox endpoint');
});

runner.test('should reject Polar config with relative URL', () => {
  try {
    CheckoutHelper.generatePolarCheckout({
      productId: 'prod_123',
      successUrl: '/success' // Relative URL
    });
    runner.assert(false, 'Should throw error for relative URL');
  } catch (error) {
    runner.assert(error.message.includes('absolute URL'), 'Should require absolute URL');
  }
});

runner.test('should generate Creem checkout request', () => {
  const result = CheckoutHelper.generateCreemCheckout({
    productId: 'prod_123',
    requestId: 'order_123',
    successUrl: 'https://example.com/success',
    customerEmail: 'user@example.com',
    metadata: { referenceId: 'user_123' }
  });

  runner.assertEqual(result.config.product_id, 'prod_123', 'Should include product ID');
  runner.assertEqual(result.config.request_id, 'order_123', 'Should include request ID');
  runner.assertEqual(result.config.customer.email, 'user@example.com', 'Should include customer');
  runner.assertEqual(result.apiEndpoint, 'https://test-api.creem.io/v1/checkouts', 'Should default to test API');
  runner.assert(result.curlCommand.includes('x-api-key: $CREEM_API_KEY'), 'curl must reference the env var, not a key');
  runner.assertEqual(
    CheckoutHelper.generateCreemCheckout({ productId: 'prod_123', server: 'prod' }).apiEndpoint,
    'https://api.creem.io/v1/checkouts'
  );
});

runner.test('should reject invalid Creem checkout config', () => {
  const invalid = [
    { successUrl: 'https://example.com/success' },           // missing productId
    { productId: 'prod_123', successUrl: '/success' },        // relative URL
    { productId: 'prod_123', units: 0 },                      // units < 1
    { productId: 'prod_123', customerId: 'cust_1', customerEmail: 'a@example.com' }
  ];
  for (const config of invalid) {
    let threw = false;
    try { CheckoutHelper.generateCreemCheckout(config); } catch { threw = true; }
    runner.assert(threw, `Should reject ${JSON.stringify(config)}`);
  }
});

// Run summary
const success = runner.summary();
process.exit(success ? 0 : 1);
