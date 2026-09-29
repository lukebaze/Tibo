# Monorepo Layout

Canonical tree for `--both` mode (Node/TypeScript). Adapt paths for other ecosystems.

## Tree

```
.
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── capabilities/       # one file per curated capability
│   │   │   ├── config/             # config schema + loader
│   │   │   ├── errors.ts           # typed error classes
│   │   │   └── index.ts            # public exports
│   │   ├── test/
│   │   ├── package.json            # private: true (not published)
│   │   └── tsconfig.json
│   ├── cli/
│   │   ├── src/
│   │   │   ├── commands/           # one file per command (stateless --api-key)
│   │   │   ├── credentials.ts      # auth resolution chain
│   │   │   ├── formatter.ts        # json + text renderers
│   │   │   └── bin.ts              # #!/usr/bin/env node entry
│   │   ├── test/
│   │   ├── package.json            # bin, files, engines, publishConfig
│   │   └── tsconfig.json
│   └── mcp/
│       ├── src/
│       │   ├── tools/              # Tier 1 curated tools + Tier 2 escape hatch
│       │   ├── resources/          # schemas, docs, live status
│       │   ├── prompts/            # workflow prompt templates
│       │   ├── transports/
│       │   │   ├── stdio.ts        # local stdio transport
│       │   │   └── streamable-http.ts # Streamable HTTP (/mcp)
│       │   ├── discover.ts         # server/discover implementation
│       │   ├── auth.ts             # OAuth 2.1 + CIMD + RFC 9207 validation
│       │   └── server.ts           # transport-agnostic server factory
│       ├── test/
│       ├── package.json
│       ├── wrangler.toml           # Cloudflare Workers
│       ├── Dockerfile
│       └── tsconfig.json
├── skills/<tool-name>/             # companion skill (single source of truth)
│   ├── SKILL.md                    # Core instructions (skills.sh compatible)
│   ├── references/                 # loaded on-demand
│   └── scripts/                    # executable helpers
│   # Target manifests generated per cross-marketplace-distribution.md:
│   #   Claude: .claude-plugin/plugin.json & marketplace.json
│   #   Codex:  .codex-plugin/plugin.json
├── docs/
│   ├── cli.md
│   ├── mcp.md
│   ├── architecture.md
│   └── contributing.md
├── scripts/
├── .github/workflows/
│   ├── ci.yml                      # Test, lint, typecheck
│   └── release.yml                 # NPM Trusted Publisher (OIDC) + SemVer release
├── .changeset/                     # or release-please config for conventional commits
├── package.json                    # workspaces
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── LICENSE
└── README.md
```

## Root `package.json`

```json
{
  "name": "<tool-name>-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "release": "changeset publish"
  },
  "packageManager": "pnpm@9"
}
```

## Automated SemVer & Conventional Commits

Releases use SemVer driven by Conventional Commits (`feat:`, `fix:`, `feat!:`, `chore:`):
- Automatic version bumping (patch for `fix:`, minor for `feat:`, major for `!:` or `BREAKING CHANGE:`).
- Automatic changelog generation (`CHANGELOG.md`) categorizing changes.
- Uses Changesets (`@changesets/cli`) or GitHub Action `google-github-actions/release-please-action`.

## GitHub Actions Release Workflow (NPM Trusted Publisher)

Uses GitHub Actions OpenID Connect (OIDC) for tokenless publishing directly to NPM with verifiable build provenance (requires registering the repository and workflow on npmjs.com as a Trusted Publisher under package Settings):

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write    # Create Git tags and releases
  id-token: write    # Required for NPM Trusted Publishing via OIDC token exchange

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24   # Node 24 ships npm >=11.5.1 with native OIDC token resolution
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - run: pnpm -r test

      # Publishes to NPM via OIDC without storing any NPM_TOKEN secrets
      - name: Publish to NPM via Changesets
        run: pnpm changeset publish --provenance

      # Optional: Deploy MCP server to Cloudflare Workers
      - name: Deploy MCP to Cloudflare
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: 'packages/mcp'
```

## `packages/cli/package.json`

```json
{
  "name": "<tool-name>",
  "version": "0.1.0",
  "description": "CLI for <tool-name>",
  "bin": { "<tool-name>": "dist/bin.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "publishConfig": { "access": "public", "provenance": true },
  "dependencies": {
    "@<scope>/<tool-name>-core": "workspace:*",
    "commander": "^12",
    "dotenv": "^16"
  },
  "scripts": {
    "build": "tsc -p . && chmod +x dist/bin.js",
    "prepublishOnly": "pnpm build && pnpm test"
  }
}
```

## `packages/mcp/package.json`

```json
{
  "name": "<tool-name>-mcp",
  "version": "0.1.0",
  "bin": { "<tool-name>-mcp": "dist/bin.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "publishConfig": { "access": "public", "provenance": true },
  "dependencies": {
    "@<scope>/<tool-name>-core": "workspace:*",
    "@modelcontextprotocol/server": "^2",
    "hono": "^4",
    "zod": "^3"
  }
}
```

## Core/Adapter boundary rules

`core/`:
- Zero `process.argv`, zero `console.log` as control flow, zero transport or HTTP server imports.
- Pure functions where feasible; external side-effects isolated into client adapters.
- Accepts parameters explicitly; returns plain data objects or throws typed errors.

`cli/` and `mcp/`:
- Import exclusively from `core/` (plus framework/transport dependencies).
- Translate CLI argv / MCP tool parameters → core function calls.
- Translate core results/errors → formatted output or structured MCP responses.
- No business logic in adapters.
