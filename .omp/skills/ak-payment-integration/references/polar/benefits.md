# Polar Benefits

Automated entitlement delivery for digital products.

## Philosophy

Benefits are standalone resources attached to one or many products. Polar grants them on purchase/subscription and revokes them when access ends. One-time purchases grant lifetime access; subscriptions grant while active or trialing.

## Benefit Types

API `type` values: `license_keys`, `github_repository`, `discord`, `downloadables`, `meter_credit`, `feature_flag`, `custom`, `slack_shared_channel`.

Examples use the stable TypeScript SDK (`@polar-sh/sdk` 0.x). Most integration setup (GitHub/Discord/Slack app install, file upload) happens in the dashboard.

### 1. License Keys

**Features:** branded prefix, expiration, activation limits, usage quotas, custom validation conditions, rotation, auto-revoke with the subscription.

**Create:**
```typescript
const benefit = await polar.benefits.create({
  type: "license_keys",
  description: "Software License",
  properties: {
    prefix: "MYAPP",
    expires: { ttl: 1, timeframe: "year" }, // omit for no expiry
    activations: { limit: 3, enableCustomerAdmin: true },
    limitUsage: 1000 // optional quota
  }
});
```

**Validation (unauthenticated, from your app/CLI, 3 req/s):**
```typescript
const polar = new Polar(); // no token needed for customer-portal license endpoints

const key = await polar.customerPortal.licenseKeys.validate({
  key: "MYAPP-XXXX-XXXX",
  organizationId: "org_uuid",
  benefitId: "benefit_uuid",     // recommended when you sell several key types
  activationId: "activation_uuid", // required if activations are enabled
  incrementUsage: 1                // optional
});

if (key.status === "granted") {
  // Grant access; also check key.expiresAt, key.usage vs key.limitUsage
}
// Unknown key → 404 error
```

**Activation/Deactivation:**
```typescript
const activation = await polar.customerPortal.licenseKeys.activate({
  key: "MYAPP-XXXX-XXXX",
  organizationId: "org_uuid",
  label: "User's MacBook Pro",
  conditions: { major_version: 1 }
});

await polar.customerPortal.licenseKeys.deactivate({
  key: "MYAPP-XXXX-XXXX",
  organizationId: "org_uuid",
  activationId: activation.id
});
```

Server-side (OAT, `license_keys:write`) equivalents live under `polar.licenseKeys.*` (`/v1/license-keys/...`), including `rotate`.

**Status values:** `granted`, `revoked`, `disabled`.

### 2. GitHub Repository Access

**Auto-invite to private organization repositories.**

**Create:**
```typescript
const benefit = await polar.benefits.create({
  type: "github_repository",
  description: "Access to private repo",
  properties: {
    repositoryOwner: "myorg",
    repositoryName: "private-repo",
    permission: "pull" // pull | triage | push | maintain | admin
  }
});
```

**Behavior:**
- Requires connecting GitHub and installing Polar's dedicated GitHub App on the repositories
- Organization repositories only (personal repos not supported by default)
- One repository per benefit; create multiple benefits for multiple repos
- Invite on grant, removed on revoke
- Collaborators count as paid seats on paid GitHub plans

### 3. Discord Access

**Server invites and role assignment.**

**Create:**
```typescript
const benefit = await polar.benefits.create({
  type: "discord",
  description: "Premium Discord role",
  properties: {
    guildId: "123456789",
    roleId: "987654321",
    kickMember: false // kick from server on revocation
  }
});
```

**Requirements:**
- Connect the Discord server via the dashboard (Polar bot needs Manage Roles, Kick Members, Create Invite)
- The connected server can't be changed; create another benefit for another server

**Behavior:**
- Customer connects Discord from the portal, is invited and given the role
- Role removed (optionally kicked) on revocation

### 4. Downloadable Files

**Secure file delivery up to 10GB each.**

- Upload files in the dashboard (API: `files` upload + `downloadables` benefit with file IDs)
- SHA-256 checksums, signed personal download URLs in the Customer Portal
- Disabling a file hides it from new customers only; deleting removes access for everyone
- Adding/re-enabling files grants them retroactively to existing customers

### 5. Meter Credits

**Pre-paid usage units for usage-based billing.**

**Create:**
```typescript
const benefit = await polar.benefits.create({
  type: "meter_credit",
  description: "10,000 API credits",
  properties: {
    meterId: "meter_uuid",
    units: 10000,
    rollover: false // carry unused credits into the next cycle
  }
});
```

**Behavior:**
- Subscriptions: credited at the start of every cycle; one-time: credited once
- Credits are consumed first; overage billed only if the product has a metered price
- Polar never blocks usage when the balance hits 0 (enforce in your app)

**Balance Check:**
```typescript
const result = await polar.customerMeters.list({
  externalCustomerId: "user_123",
  meterId: "meter_uuid"
});
// or Customer State: state.activeMeters
```

### 6. Feature Flags

**API-driven feature gating with optional key-value metadata.**

```typescript
const benefit = await polar.benefits.create({
  type: "feature_flag",
  description: "Premium Features",
  properties: {}
});
```
- Check via Customer State `grantedBenefits` or `customer.state_changed`
- Recommended over empty Custom benefits for entitlement checks

### 7. Custom Benefits

**Markdown note shown after purchase (success page, email, portal).**

```typescript
const benefit = await polar.benefits.create({
  type: "custom",
  description: "Priority support",
  properties: {
    note: "Email support@example.com with your order ID for priority support"
  }
});
```

**Use Cases:** Cal.com/Calendly links, onboarding instructions, partner coupon codes, manual fulfillment.

### 8. Shared Slack Channel (preview, paid plans)

Creates a shared Slack Connect channel per customer. Configured in the dashboard after connecting Slack.

## Benefit Grants

**Link between a customer (or seat member) and a benefit.**

### Webhooks
- `benefit_grant.created` - Grant created
- `benefit_grant.updated` - Grant changed
- `benefit_grant.cycled` - Grant renewed for a new subscription period
- `benefit_grant.revoked` - Access revoked

### Revoke Triggers
- Subscription revoked/ended (cancel at period end, immediate revoke, failed dunning after grace period)
- Subscription paused (until resumed)
- Refund of a one-time order with "revoke benefits" selected (default for full refunds)
- Benefit removed from the product (propagates to existing customers)

Refunding a subscription order does **not** revoke benefits; cancel the subscription instead.

### Querying Grants
```typescript
const result = await polar.benefitGrants.list({
  externalCustomerId: "user_123",
  isGranted: true
});
// Grants of a single benefit: GET /v1/benefits/{id}/grants
```

## Attaching Benefits to Products

### Via API
```typescript
await polar.products.updateBenefits({
  id: productId,
  productBenefitsUpdate: { benefits: [benefitId1, benefitId2] }
});
```

### Via Dashboard
Toggle benefits in the product create/edit form, or manage them under **Benefits**.

## Seat-Based Products

Benefits are granted to members when they claim a seat, not to the paying customer at purchase. Identify end users by member, not by the billing customer.

## Implementation Patterns

### Access Check via Customer State
```typescript
async function hasFeature(userId: string, benefitId: string) {
  const state = await polar.customers.getStateExternal({ externalId: userId });
  return state.grantedBenefits.some(grant => grant.benefitId === benefitId);
}
```

### React to Grants
```typescript
switch (event.type) {
  case 'benefit_grant.created':
    await onBenefitGranted(event.data);
    break;
  case 'benefit_grant.revoked':
    await onBenefitRevoked(event.data); // GitHub/Discord removal is done by Polar
    break;
}
```

## Best Practices

1. **License Keys:**
   - Always pass `organizationId`; pass `benefitId` when selling several key types
   - Enable customer activation admin to reduce support load
   - Rotate exposed keys (`/rotate`) instead of revoking

2. **GitHub Access:**
   - Grant `pull` (read) unless you truly need more
   - Use separate repos/benefits per tier

3. **Discord Roles:**
   - One role per tier; decide whether revocation should kick

4. **Credits:**
   - Show balance and usage in your app; enforce limits yourself

5. **Entitlements:**
   - Prefer Customer State / Feature Flags over checking product IDs
