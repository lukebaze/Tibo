# Env cascade

`scripts/env-loader.cjs` resolves secrets (`ZERNIO_API_KEY`, AI model keys, etc.)
from a layered cascade so a project can override a user default, and a user
default can override nothing further (`process.env` always wins).

## Precedence (highest → lowest)

1. `process.env` — already-exported shell/CI variables.
2. `<project>/.agentkit/.env` — project-scoped, preferred.
3. `~/.agentkit/.env` — user-scoped, preferred.
4. `<project>/.claude/.env` — legacy project-scoped (backward compat).
5. `~/.claude/.env` — legacy user-scoped (backward compat).

Each layer only fills in keys the higher-priority layers didn't already set.

## `.env` file format

Standard `KEY=value` lines. Supports:

```bash
# comments and blank lines are ignored
ZERNIO_API_KEY=sk_your-api-key
QUOTED_VALUE="has spaces and \n escapes"
SINGLE_QUOTED='kept literal, no \n expansion'
VALUE_WITH_EQUALS=a=b=c
```

## Usage from a script

```js
const { loadEnv, resolveEnv, resolveAllEnv } = require('./env-loader.cjs');

// Merged file-sourced env only (process.env NOT included):
const fileEnv = loadEnv(process.cwd());

// Single key, honoring the full cascade including process.env:
const apiKey = resolveEnv('ZERNIO_API_KEY', process.cwd());

// Everything merged into one lookup table (process.env wins):
const env = resolveAllEnv(process.cwd());
```

## Gitignore

Add `.agentkit/.env` to your project's `.gitignore` — it is never meant to be
committed:

```gitignore
.agentkit/.env
```

## Why this skill vendors its own loader

This skill carries its own copy of the env-cascade loader
(`scripts/env-loader.cjs`) instead of importing a shared one. Once a skill is
installed into a user's `~/.claude/skills/` tree, the source repository's
internal module layout no longer exists on disk — an import path back into
another tree would dangle. Every skill that needs this cascade vendors its
own copy (see the ak-seo skill's `scripts/env-loader.cjs` for the pattern this
mirrors).
