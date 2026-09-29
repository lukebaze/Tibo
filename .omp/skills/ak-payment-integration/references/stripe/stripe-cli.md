# Stripe CLI Reference

Command-line tool for testing and development workflows. Latest release v1.52.0 (2026-09-24).

## Installation

```bash
# npm (macOS, Linux, Windows; Node.js >= 18) - the method docs.stripe.com leads with
npm install -g @stripe/cli

# macOS
brew install stripe

# Windows
winget install Stripe.StripeCLI
# or scoop
scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
scoop install stripe

# Linux (apt: Debian, Ubuntu)
curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" | sudo tee -a /etc/apt/sources.list.d/stripe.list
sudo apt update && sudo apt install stripe

# Linux (yum/dnf): repo https://packages.stripe.dev/stripe-cli-rpm-local/ (see README)

# Docker
docker run --rm -it stripe/stripe-cli version
```

Source of truth for install options: https://github.com/stripe/stripe-cli#installation

## Authentication

```bash
stripe login                    # browser pairing flow
stripe login --non-interactive  # JSON output for agents/CI, then run the returned next_step
stripe login --interactive      # paste an API key when no browser is available
stripe whoami --format json     # check auth
```

- Credentials are stored in the OS secure credential store when available and the session refreshes automatically.
- CLI versions newer than v1.50.0 require an Administrator or IAM Admin to enable CLI access in Dashboard: Settings → Team and security → MCP and CLI access.
- CI/CD: set `STRIPE_API_KEY` (use a sandbox restricted key; never a live key in CI logs).

### No account yet: sandbox

```bash
stripe sandbox create --email you@example.com   # or --from-git; saves test keys to the CLI profile
stripe sandbox claim                            # convert to a real account within 7 days
```

## Webhook Testing

```bash
# Forward snapshot events to local server
stripe listen --forward-to localhost:3000/webhook
# Ready! Your webhook signing secret is whsec_xxx  -> use as the endpoint secret locally

# Limit events
stripe listen --events checkout.session.completed,invoice.paid --forward-to localhost:3000/webhook

# Thin (v2) events
stripe listen --forward-thin-to localhost:3000/webhook --thin-events "*"

# Trigger test events (creates real sandbox objects as side effects)
stripe trigger checkout.session.completed
stripe trigger payment_intent.succeeded

# Resend a real event to an endpoint (up to 30 days)
stripe events resend evt_xxx --webhook-endpoint=we_xxx
```

### Event types worth testing

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
- `payment_intent.succeeded`, `payment_intent.payment_failed`
- `customer.subscription.created` / `.updated` / `.deleted`
- `invoice.paid`, `invoice.payment_failed`

## API Logs

```bash
stripe logs tail
stripe logs tail --filter-status-code-type 4XX
stripe logs tail --filter-status-code 400
stripe logs tail --filter-http-method POST --filter-request-path /v1/checkout/sessions
```

Other filters: `--filter-account`, `--filter-ip-address`, `--filter-request-status SUCCEEDED|FAILED`, `--filter-source API|DASHBOARD`, `--format JSON`. Useful for finding `403`s when migrating to restricted keys.

## Resource Commands

```bash
stripe customers list --limit 5
stripe products retrieve prod_xxx
stripe customers create --email="test@example.com" --stripe-version 2026-08-26.dahlia  # pin version per command
```

## Fixtures (Batch Operations)

Create `fixtures.json`:

```json
{
  "_meta": { "template_version": 0 },
  "fixtures": [
    {
      "name": "customer",
      "path": "/v1/customers",
      "method": "post",
      "params": { "email": "test@example.com" }
    },
    {
      "name": "payment",
      "path": "/v1/payment_intents",
      "method": "post",
      "params": {
        "customer": "${customer:id}",
        "amount": 2000,
        "currency": "usd",
        "payment_method": "pm_card_visa",
        "return_url": "https://example.com",
        "confirm": true
      }
    }
  ]
}
```

Run: `stripe fixtures fixtures.json`. References: `${name:json.path}`, env vars `${.env:VAR|default}`. Flags: `--override`, `--add`, `--remove`, `--skip`. Use `expected_error_type` on a fixture to assert an error.

## Common Workflows

### Test Checkout Integration

```bash
# Terminal 1
stripe listen --forward-to localhost:3000/webhook
# Terminal 2
stripe trigger checkout.session.completed
```

### Test Subscription Lifecycle

```bash
stripe trigger customer.subscription.created
stripe trigger invoice.paid
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.deleted
```

## Resources

- Command reference: https://docs.stripe.com/cli
- Webhook testing: https://docs.stripe.com/webhooks#local-listener
- Fixtures: https://docs.stripe.com/cli/fixtures
- Sandbox: https://docs.stripe.com/cli/sandbox
