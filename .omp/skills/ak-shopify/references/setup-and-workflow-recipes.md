## Platform Overview

**Core Components:**
- **Shopify CLI** - Development workflow tool
- **GraphQL Admin API** - Primary API for data operations (recommended)
- **REST Admin API** - Legacy API (maintenance mode)
- **Polaris UI** - Design system for consistent interfaces
- **Liquid** - Template language for themes

**Extension Points:**
- Checkout UI - Customize checkout experience
- Admin UI - Extend admin dashboard
- POS UI - Point of Sale customization
- Customer Account - Post-purchase pages
- Theme App Extensions - Embedded theme functionality

## Quick Start

### Prerequisites

```bash
# Install Shopify CLI
npm install -g @shopify/cli@latest

# Verify installation
shopify version
```

### Create New App

```bash
# Initialize app
shopify app init

# Start development server
shopify app dev

# Generate extension
shopify app generate extension --type checkout_ui_extension

# Deploy
shopify app deploy
```

### Theme Development

```bash
# Initialize theme
shopify theme init

# Start local preview
shopify theme dev

# Pull from store
shopify theme pull --live

# Push to store
shopify theme push --development
```

## Development Workflow

### 1. App Development

**Setup:**
```bash
shopify app init
cd my-app
```

**Configure Access Scopes** (`shopify.app.toml`):
```toml
[access_scopes]
scopes = "read_products,write_products,read_orders"
```

**Start Development:**
```bash
shopify app dev  # Starts local server with tunnel
```

**Add Extensions:**
```bash
shopify app generate extension --type checkout_ui_extension
```

**Deploy:**
```bash
shopify app deploy  # Builds and uploads to Shopify
```

### 2. Extension Development

**Available Types:**
- Checkout UI - `checkout_ui_extension`
- Admin Action - `admin_action`
- Admin Block - `admin_block`
- POS UI - `pos_ui_extension`
- Function - `function` (discounts, payment, delivery, validation)

**Workflow:**
```bash
shopify app generate extension
# Select type, configure
shopify app dev  # Test locally
shopify app deploy  # Publish
```

### 3. Theme Development

**Setup:**
```bash
shopify theme init
# Choose Dawn (reference theme) or start fresh
```

**Local Development:**
```bash
shopify theme dev
# Preview at localhost:9292
# Auto-syncs to development theme
```

**Deployment:**
```bash
shopify theme push --development  # Push to dev theme
shopify theme publish --theme=123  # Set as live
```

## When to Build What

### Build an App When:
- Integrating external services
- Adding functionality across multiple stores
- Building merchant-facing admin tools
- Managing store data programmatically
- Implementing complex business logic
- Charging for functionality

### Build an Extension When:
- Customizing checkout flow
- Adding fields/features to admin pages
- Creating POS actions for retail
- Implementing discount/payment/shipping rules
- Extending customer account pages

### Build a Theme When:
- Creating custom storefront design
- Building unique shopping experiences
- Customizing product/collection pages
- Implementing brand-specific layouts
- Modifying homepage/content pages

### Combination Approach:
**App + Theme Extension:**
- App handles backend logic and data
- Theme extension provides storefront UI
- Example: Product reviews, wishlists, size guides
