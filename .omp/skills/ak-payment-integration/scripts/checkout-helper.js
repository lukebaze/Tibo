#!/usr/bin/env node

/**
 * Checkout Helper Script
 *
 * Generate checkout sessions for SePay, Polar and Creem.
 *
 * Usage:
 *   node checkout-helper.js <platform> <config-json>
 *
 * Platforms: sepay, polar, creem
 *
 * Environment Variables:
 *   SEPAY_MERCHANT_ID, SEPAY_SECRET_KEY, SEPAY_ENV
 *   POLAR_ACCESS_TOKEN, POLAR_SERVER
 *   CREEM_API_KEY, CREEM_SERVER
 */

const crypto = require('crypto');

const SEPAY_SIGNED_FIELDS = [
  'merchant', 'env', 'operation', 'payment_method', 'order_amount', 'currency',
  'order_invoice_number', 'order_description', 'customer_id',
  'agreement_id', 'agreement_name', 'agreement_type',
  'agreement_payment_frequency', 'agreement_amount_per_payment',
  'success_url', 'error_url', 'cancel_url', 'order_id'
];

const POLAR_CHECKOUTS_PATH = '/v1/checkouts/';

function polarEndpoint(server) {
  return server === 'sandbox'
    ? `https://sandbox-api.polar.sh${POLAR_CHECKOUTS_PATH}`
    : `https://api.polar.sh${POLAR_CHECKOUTS_PATH}`;
}

const CREEM_CHECKOUTS_PATH = '/v1/checkouts';

function creemEndpoint(server) {
  return server === 'prod'
    ? `https://api.creem.io${CREEM_CHECKOUTS_PATH}`
    : `https://test-api.creem.io${CREEM_CHECKOUTS_PATH}`;
}

class CheckoutHelper {
  /**
   * Generate SePay checkout form fields
   */
  static generateSePayCheckout(config) {
    const {
      merchantId,
      secretKey,
      orderInvoiceNumber,
      orderAmount,
      currency = 'VND',
      successUrl,
      errorUrl,
      cancelUrl,
      orderDescription,
      operation = 'PURCHASE'
    } = config;

    // Validate required fields (redirect URLs are optional in the gateway spec)
    const required = ['merchantId', 'secretKey', 'orderInvoiceNumber', 'orderAmount'];
    for (const field of required) {
      if (!config[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Build fields in the order they will be posted; the signature follows this order
    const fields = {
      merchant: merchantId,
      currency: currency,
      order_amount: String(orderAmount),
      operation: operation,
      order_description: orderDescription || `Order ${orderInvoiceNumber}`,
      order_invoice_number: orderInvoiceNumber
    };
    if (config.paymentMethod) fields.payment_method = config.paymentMethod;
    if (config.customerId) fields.customer_id = config.customerId;
    if (successUrl) fields.success_url = successUrl;
    if (errorUrl) fields.error_url = errorUrl;
    if (cancelUrl) fields.cancel_url = cancelUrl;

    fields.signature = this.signSePayFields(fields, secretKey);

    const formUrl = config.env === 'production'
      ? 'https://pay.sepay.vn/v1/checkout/init'
      : 'https://pay-sandbox.sepay.vn/v1/checkout/init';

    return {
      fields,
      formUrl,
      htmlForm: this.generateHTMLForm(fields, formUrl)
    };
  }

  /**
   * SePay gateway signature: base64(HMAC-SHA256(secret, "k=v,k=v,...")) over the
   * signed fields in form order, matching the official sepay-pg-node SDK.
   */
  static signSePayFields(fields, secretKey) {
    const signedData = Object.keys(fields)
      .filter(key => SEPAY_SIGNED_FIELDS.includes(key) && fields[key] !== undefined)
      .map(key => `${key}=${fields[key]}`)
      .join(',');

    return crypto
      .createHmac('sha256', secretKey)
      .update(signedData)
      .digest('base64');
  }

  /**
   * Generate Polar checkout configuration
   */
  static generatePolarCheckout(config) {
    const {
      productId,
      products,
      productPriceId,
      successUrl,
      externalCustomerId,
      customerEmail,
      customerName,
      discountId,
      metadata,
      embedOrigin
    } = config;

    // Validate required fields
    const productIds = Array.isArray(products) && products.length > 0
      ? products
      : (productId ? [productId] : []);
    if (productIds.length === 0 && !productPriceId) {
      throw new Error('Missing required field: productId or products');
    }
    if (!successUrl) {
      throw new Error('Missing required field: successUrl');
    }

    // Must be absolute URL
    if (!successUrl.startsWith('http://') && !successUrl.startsWith('https://')) {
      throw new Error('successUrl must be an absolute URL');
    }

    const checkoutConfig = productIds.length > 0
      ? { products: productIds, success_url: successUrl }
      : { product_price_id: productPriceId, success_url: successUrl };
    if (productIds.length === 0) {
      // product_price_id is deprecated by Polar; kept only for existing callers
      console.warn('Warning: productPriceId is deprecated; pass productId or products');
    }

    // Add optional fields
    if (externalCustomerId) checkoutConfig.external_customer_id = externalCustomerId;
    if (customerEmail) checkoutConfig.customer_email = customerEmail;
    if (customerName) checkoutConfig.customer_name = customerName;
    if (discountId) checkoutConfig.discount_id = discountId;
    if (metadata) checkoutConfig.metadata = metadata;
    if (embedOrigin) checkoutConfig.embed_origin = embedOrigin;

    return {
      config: checkoutConfig,
      apiEndpoint: polarEndpoint(config.server),
      curlCommand: this.generatePolarCurl(checkoutConfig, config.accessToken, config.server)
    };
  }

  /**
   * Generate Creem checkout request (POST /v1/checkouts, header x-api-key)
   */
  static generateCreemCheckout(config) {
    const {
      productId,
      requestId,
      successUrl,
      units,
      discountCode,
      customerId,
      customerEmail,
      customerName,
      metadata,
      server = 'test'
    } = config;

    if (!productId) {
      throw new Error('Missing required field: productId');
    }
    if (successUrl && !successUrl.startsWith('http://') && !successUrl.startsWith('https://')) {
      throw new Error('successUrl must be an absolute URL');
    }
    if (units !== undefined && (!Number.isInteger(units) || units < 1)) {
      throw new Error('units must be a positive integer');
    }
    if (customerId && customerEmail) {
      throw new Error('Pass customerId or customerEmail, not both');
    }

    const body = { product_id: productId };
    if (requestId) body.request_id = requestId;
    if (successUrl) body.success_url = successUrl;
    if (units !== undefined) body.units = units;
    if (discountCode) body.discount_code = discountCode;
    if (customerId || customerEmail) {
      body.customer = customerId ? { id: customerId } : { email: customerEmail };
      if (customerName) body.customer.name = customerName;
    }
    if (metadata) body.metadata = metadata;

    return {
      config: body,
      apiEndpoint: creemEndpoint(server),
      curlCommand: this.generateCreemCurl(body, server)
    };
  }

  /**
   * Generate HTML form for SePay
   */
  static generateHTMLForm(fields, actionUrl) {
    // Escape for HTML; the browser decodes entities before POST, so the signature is unaffected
    const escapeHtml = value => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const inputs = Object.keys(fields)
      .map(key => `    <input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(fields[key])}" />`)
      .join('\n');

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SePay Payment</title>
</head>
<body>
  <form id="payment-form" action="${escapeHtml(actionUrl)}" method="POST">
${inputs}
    <button type="submit">Pay Now</button>
  </form>

  <script>
    // Auto-submit form
    // document.getElementById('payment-form').submit();
  </script>
</body>
</html>
`.trim();
  }

  /**
   * Generate cURL command for Polar
   */
  static generatePolarCurl(config, accessToken, server = 'production') {
    return `curl -X POST ${polarEndpoint(server)} \\
  -H "Authorization: Bearer ${accessToken}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(config, null, 2)}'`;
  }

  /**
   * Generate cURL command for Creem
   */
  static generateCreemCurl(body, server = 'test') {
    // Reference the key by env var so it never lands in shell history or logs
    const json = JSON.stringify(body, null, 2).replace(/'/g, `'\\''`);
    return `curl -X POST ${creemEndpoint(server)} \\
  -H "x-api-key: $CREEM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
  }
}

// CLI Usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node checkout-helper.js <platform> <config-json>');
    console.log('\nPlatforms:');
    console.log('  sepay  - SePay checkout form generation');
    console.log('  polar  - Polar checkout session configuration');
    console.log('  creem  - Creem checkout request and curl');
    console.log('\nExamples:');
    console.log('\nSePay:');
    console.log('  node checkout-helper.js sepay \'{"orderInvoiceNumber":"ORD001","orderAmount":100000,"successUrl":"https://example.com/success","errorUrl":"https://example.com/error","cancelUrl":"https://example.com/cancel"}\'');
    console.log('\nPolar:');
    console.log('  node checkout-helper.js polar \'{"productId":"prod_xxx","successUrl":"https://example.com/success","externalCustomerId":"user_123"}\'');
    console.log('\nCreem:');
    console.log('  node checkout-helper.js creem \'{"productId":"prod_xxx","requestId":"order_123","successUrl":"https://example.com/success"}\'');
    process.exit(1);
  }

  try {
    const platform = args[0].toLowerCase();
    const config = JSON.parse(args[1]);

    if (platform === 'sepay') {
      // Get from environment or config
      config.merchantId = config.merchantId || process.env.SEPAY_MERCHANT_ID;
      config.secretKey = config.secretKey || process.env.SEPAY_SECRET_KEY;
      config.env = config.env || process.env.SEPAY_ENV || 'sandbox';

      const result = CheckoutHelper.generateSePayCheckout(config);

      console.log('✓ SePay Checkout Generated\n');
      console.log('Form URL:', result.formUrl);
      console.log('\nForm Fields:');
      console.log(JSON.stringify(result.fields, null, 2));
      console.log('\nHTML Form:');
      console.log(result.htmlForm);
    } else if (platform === 'polar') {
      // Get from environment or config
      config.accessToken = config.accessToken || process.env.POLAR_ACCESS_TOKEN;
      config.server = config.server || process.env.POLAR_SERVER || 'production';

      if (!config.accessToken) {
        console.error('✗ Error: POLAR_ACCESS_TOKEN is required');
        console.error('Set it via environment variable or in config JSON');
        process.exit(1);
      }

      const result = CheckoutHelper.generatePolarCheckout(config);

      console.log('✓ Polar Checkout Configuration Generated\n');
      console.log('API Endpoint:', result.apiEndpoint);
      console.log('\nCheckout Configuration:');
      console.log(JSON.stringify(result.config, null, 2));
      console.log('\ncURL Command:');
      console.log(result.curlCommand);
    } else if (platform === 'creem') {
      config.server = config.server || process.env.CREEM_SERVER || 'test';
      const key = process.env.CREEM_API_KEY || '';
      if (key && key.startsWith('creem_test_') !== (config.server === 'test')) {
        console.warn(`Warning: CREEM_API_KEY prefix does not match server '${config.server}' (requests will fail 401/403)`);
      }

      const result = CheckoutHelper.generateCreemCheckout(config);

      console.log('✓ Creem Checkout Request Generated\n');
      console.log('API Endpoint:', result.apiEndpoint);
      console.log('\nRequest Body:');
      console.log(JSON.stringify(result.config, null, 2));
      console.log('\ncURL Command (reads $CREEM_API_KEY):');
      console.log(result.curlCommand);
    } else {
      console.error(`✗ Error: Unknown platform '${platform}'`);
      console.error('Supported platforms: sepay, polar, creem');
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

module.exports = CheckoutHelper;
