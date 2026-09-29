# Cross-Marketplace Skill Distribution

Distribute **one** skill across three targets without rewriting the workflow body. Keep `SKILL.md` as the single source of truth; generate target-specific manifests around it.

> Ecosystem claims below are dated **2026-08-20**. Claude, Codex, and skills.sh surfaces churn — re-check official docs before shipping.

## Shared skill core

```
my-skill/
├── SKILL.md              # Required: YAML frontmatter + instructions
├── scripts/              # Optional
├── references/           # Optional
└── assets/               # Optional
```

Minimal frontmatter (agentskills.io / portable baseline):

```yaml
---
name: my-skill
description: Do X when the user asks about Y. Use for X, Y, and Z workflows.
---
```

---

## (a) Claude Plugins Marketplace

Claude Code distributes skills as **plugins** listed in a marketplace catalog (`.claude-plugin/marketplace.json`). Full schema, sources, hosting, and troubleshooting live in the sibling refs — use those as the source of detail:

- `references/plugin-marketplace-overview.md`
- `references/plugin-marketplace-schema.md`
- `references/plugin-marketplace-sources.md`
- `references/plugin-marketplace-hosting.md`
- `references/plugin-marketplace-troubleshooting.md`

### Directory layout

```
my-marketplace/
├── .claude-plugin/
│   └── marketplace.json
└── plugins/
    └── my-plugin/
        ├── .claude-plugin/
        │   └── plugin.json
        └── skills/
            └── my-skill/
                └── SKILL.md
```

### Manifest examples

`marketplace.json` (catalog):

```json
{
  "name": "acme-tools",
  "owner": { "name": "Acme" },
  "plugins": [{
    "name": "my-plugin",
    "source": "./plugins/my-plugin",
    "description": "Bundles the my-skill workflow"
  }]
}
```

`plugin.json`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Acme my-skill plugin"
}
```

### Publish workflow

1. Author `SKILL.md` under `plugins/<plugin>/skills/<skill>/`.
2. Add plugin + marketplace manifests; validate with `claude plugin validate .` or `/plugin validate .`.
3. Host the marketplace repo (GitHub recommended).
4. Share: users add the marketplace, then install the plugin.

### Install / discovery

```text
/plugin marketplace add owner/repo
/plugin install my-plugin@acme-tools
/plugin marketplace update
```

Official docs: [Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces.md), [Create Plugins](https://code.claude.com/docs/en/plugins.md).

---

## (b) OpenAI Codex plugin ecosystem

In Codex, **skills** are the authoring format; **plugins** are the installable distribution unit (skills ± apps ± MCP). ChatGPT and Codex share the plugin directory model (as of 2026-08).

### Directory layout

```
my-plugin/
├── .codex-plugin/
│   └── plugin.json          # Required manifest
├── skills/
│   └── my-skill/
│       └── SKILL.md
├── .mcp.json                # Optional MCP bundle
├── .app.json                # Optional app/connector mapping
└── assets/                  # Optional branding
```

Repo / personal marketplace catalog (separate from Claude's `.claude-plugin/` path):

```
.agents/plugins/marketplace.json     # repo-scoped
~/.agents/plugins/marketplace.json   # user-scoped
```

### Manifest examples

`.codex-plugin/plugin.json`:

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "Reusable my-skill workflow for Codex",
  "skills": "./skills/",
  "license": "MIT"
}
```

`.agents/plugins/marketplace.json`:

```json
{
  "name": "acme-codex",
  "plugins": [{
    "name": "my-plugin",
    "source": { "source": "local", "path": "./plugins/my-plugin" }
  }]
}
```

### SKILL.md / AGENTS.md interplay

| File | Role |
|------|------|
| `SKILL.md` | On-demand workflow; activate when description matches the task |
| `AGENTS.md` | Always-on project rules (build/test conventions, guardrails) |

Put repeatable specialized procedures in skills; put repo-wide standing rules in `AGENTS.md`. Do not duplicate always-on policy into every skill.

### Publish workflow

1. Scaffold with `$plugin-creator` / `@plugin-creator` (or hand-write `.codex-plugin/plugin.json`).
2. Place the shared `SKILL.md` under `skills/<name>/`.
3. Add a local marketplace entry; install and test end-to-end.
4. Share via git marketplace, workspace install, or submit to the public Plugins Directory ([build guide](https://developers.openai.com/plugins/build/plugins), [submission](https://developers.openai.com/plugins/deploy/submission)).

### Install / discovery

```bash
codex plugin marketplace add owner/repo
codex plugin marketplace add ./path/to/marketplace
codex plugin install my-plugin
```

In-session: `/plugins` opens the interactive browser. Examples: [openai/plugins](https://github.com/openai/plugins).

---

## (c) Vercel skills registry (skills.sh)

Vercel’s open skills ecosystem indexes GitHub-hosted `SKILL.md` packages. Discovery UI: [skills.sh](https://skills.sh). CLI: open-source [`vercel-labs/skills`](https://github.com/vercel-labs/skills).

### Directory layout (SKILL.md-native)

```
owner/repo/                    # or skills/ subfolder package
├── my-skill/
│   ├── SKILL.md
│   ├── scripts/
│   ├── references/
│   └── assets/
└── README.md                  # install instructions for humans
```

No marketplace catalog file required — GitHub **is** the registry.

### Publish-via-GitHub workflow

1. Commit skill folder(s) with valid `SKILL.md` (`name` matches directory; lowercase kebab-case).
2. Push a public repo (or path users can clone).
3. Document: `npx skills add owner/repo`.
4. Listing on skills.sh appears via anonymous install telemetry — there is no separate publish command.

### Install / discovery

```bash
npx skills add owner/repo
npx skills add owner/repo --skill my-skill
npx skills add -g owner/repo -y
npx skills find my-skill
npx skills list
npx skills update
npx skills init my-skill
```

Browse/rank: [skills.sh](https://skills.sh) · CLI docs: [skills.sh/docs/cli](https://skills.sh/docs/cli).

### REST API

Base: `https://skills.sh` under `/api/v1/` (JSON; Vercel OIDC auth). Useful endpoints (as of 2026-08-20):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/skills` | Paginated leaderboard (`view=all-time\|trending\|hot`) |
| GET | `/api/v1/skills/search?q=` | Search |
| GET | `/api/v1/skills/curated` | First-party curated set |
| GET | `/api/v1/skills/{source}/{skill}` | Detail + file tree |
| GET | `/api/v1/skills/audit/{source}/{skill}` | Security audits |

Docs: [skills.sh/docs/api](https://www.skills.sh/docs/api).

---

## Compatibility matrix

Anthropic-style / agentskills.io `SKILL.md` frontmatter across targets (verify limits before release — they move):

| Field / concern | Claude Plugins | Codex plugins | Vercel skills.sh / `npx skills` |
|-----------------|----------------|---------------|----------------------------------|
| `name` | kebab-case; AgentKit also documents `namespace:skill-name` for Claude | kebab-case plugin + skill dirs; match folder | Must match parent dir; `a-z0-9-` only, ≤64 chars, no leading/trailing/consecutive hyphens ([spec](https://agentskills.io/specification)) |
| `description` | ≤1024 chars; trigger-oriented | Same portable field; drives activation | ≤1024 chars; what + when |
| Extra required manifests | `.claude-plugin/marketplace.json` + `plugin.json` | `.codex-plugin/plugin.json`; optional `.agents/plugins/marketplace.json`, `.mcp.json`, `.app.json` | None beyond `SKILL.md` (+ README recommended) |
| Naming rules | Marketplace/plugin IDs kebab-case; reserved marketplace names blocked | Plugin `name` is install ID; interface display names separate | `name` == directory; no uppercase |
| Optional portable fields | `license`, `compatibility`, `metadata`, `allowed-tools` (experimental) | Same in skill; richer metadata lives in `plugin.json` | Same agentskills.io optional fields |
| Always-on vs on-demand | Skill activation via description | Skills on-demand; `AGENTS.md` always-on | Skills on-demand; use agent `AGENTS.md` for standing rules |

Prefer the intersection: lowercase kebab `name`, ≤1024-char trigger `description`, no Claude-only `namespace:` names if you also ship to Codex / skills.sh.

---

## Portability tips

1. **Keep `SKILL.md` the single source of truth** — instructions, scripts, and references stay identical across targets.
2. **Generate target manifests** — emit `.claude-plugin/*`, `.codex-plugin/plugin.json`, and `.agents/plugins/marketplace.json` from the skill’s `name` / `description` / version metadata; do not fork the skill body per marketplace.
3. **One skill, three wrappers** — Claude wraps in plugin + `marketplace.json`; Codex wraps in plugin (+ optional MCP/app); Vercel installs the skill folder directly via `npx skills`.
4. **Validate once, package thrice** — run `skills-ref validate ./my-skill` (agentskills.io) before generating wrappers.
5. **Date-stamp docs** when you claim CLI flags or API paths; re-verify against [code.claude.com](https://code.claude.com/docs/en/plugin-marketplaces.md), [developers.openai.com/plugins](https://developers.openai.com/plugins/build/plugins), and [skills.sh](https://skills.sh).

## Sources

- Claude: [Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces.md), [Plugins](https://code.claude.com/docs/en/plugins.md)
- Codex: [Build plugins](https://developers.openai.com/plugins/build/plugins), [openai/plugins](https://github.com/openai/plugins), [Skills vs plugins framing](https://developers.openai.com/codex/plugins)
- Vercel: [Agent Skills guide](https://vercel.com/kb/guide/agent-skills-creating-installing-and-sharing-reusable-agent-context), [skills.sh docs](https://skills.sh/docs), [API](https://www.skills.sh/docs/api), [vercel-labs/skills](https://github.com/vercel-labs/skills)
- Standard: [agentskills.io/specification](https://agentskills.io/specification)
