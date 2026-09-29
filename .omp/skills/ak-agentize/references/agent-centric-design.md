# Agent-Centric Design Rules

Rules for choosing what to expose and how to shape it when wrapping code for CLI + MCP consumption by AI agents.

## Select capabilities

Keep a capability if **at least one** is true:
- An agent can accomplish a user task by calling it
- It's a workflow step that is awkward or error-prone to express in prose
- It's idempotent or easily made so

Drop a capability if **all** are true:
- It's a thin passthrough over another capability
- It's purely internal plumbing
- Its output is too large to be useful in context

## Consolidate workflows

Bad: `list_items`, `get_item`, `check_quota`, `create_item` (4 tools, agent has to orchestrate).
Good: `create_item(name, …)` that internally checks quota, deduplicates by name, and returns the created record.

Rule: if the README's "how to use" says "first call X, then Y, then Z" — that's one tool, not three.

## Optimize for context

- Default responses are **concise**. Return IDs + names + status, not full payloads.
- Offer `format: "detailed"` / `--detailed` opt-in for full data.
- Paginate. Default page size small (10–25).
- Prefer names over IDs in responses: `{ "project": "acme-web" }` beats `{ "project_id": "prj_7f3c2…" }`.
- Truncate long fields with a `…` marker + length hint.

## Actionable errors

Every error must answer: what failed, why, and what to try next.

Bad:
```
Error: 400 Bad Request
```

Good:
```
Error: rate_limited
Message: Exceeded 60 requests/minute. Retry after 12s, or pass --concurrency 2.
```

Include an `error_code` machine field for agent branching.

## Safe vs mutating

- Read-only tools: no confirmation semantics, safe to call speculatively.
- Mutating tools: describe the mutation in the tool `description`; prefer `dry_run: true` support; return the diff/preview when dry-running.
- Destructive tools (`delete_*`): require an explicit `confirm: true` or a unique token returned from a preceding `plan_*` tool.

## Naming

- Tools: `verb_noun`, snake_case: `list_projects`, `create_project`, `search_logs`.
- CLI commands: `noun verb` or `verb`, kebab-case: `project list`, `project create`, `search`.
- Flags: long-form kebab-case, short-form single-letter where universal (`-v`, `-h`).

## Idempotency

Where possible:
- Creates accept a client-supplied idempotency key
- Updates are PATCH-shaped (only send changed fields)
- Deletes succeed if the target is already absent

## Output shape

JSON output (default when `--json` or MCP structured content):

```json
{
  "ok": true,
  "data": { … },
  "warnings": [],
  "next_actions": ["optional hints for the agent"]
}
```

Errors:

```json
{
  "ok": false,
  "error": { "code": "rate_limited", "message": "…", "retry_after_s": 12 }
}
```

## Optional expanded-surface preset

Select this preset for a large API catalog only. Keep the tiers needed by the accepted outcome; a one-function CLI does not need it:

| Tier | Surface | Purpose | Why |
| --- | --- | --- | --- |
| **Tier 1: Curated Workflows** | High-value tools / commands for selected intents | Primary agent tasks | Hand-selected by Phase 3 decision record; typed directly from manifest; validated input shapes |
| **Tier 2: Generic Escape Hatch** | Single `api_call(resource, action, params)` + MCP Resource `openapi://{resource}` | Low-frequency / long-tail endpoints | Schema-derived additions can reduce wrapper edits but still need compatibility and authorization review. Guardrail: dispatches only against an allowlist derived from the manifest, defaults to read-only/safe methods, and requires explicit opt-in (`confirm: true`) for mutating/admin operations |
| **Tier 3: Code Mode** | Sandboxed execution over typed SDK client (`code-mode.md`) | Chained multi-call workflows / bulk data | Keeps intermediate payloads and schema definitions out of model context entirely |

### Schema reuse and maintenance boundaries
- **Tier 1** tools are stable semantic workflows, not 1:1 endpoint mirrors.
- **Tier 2** handles endpoint additions dynamically via the schema manifest with allowlist-guarded dispatch and safe defaults.
- **Tier 3** lets agents write custom TypeScript scripts chaining endpoints locally in isolates.

### Optional MCP primitives

Choose primitives according to the consumer task and supported protocol; do not add unused primitives:
1. **Tools** — Curated Tier 1 workflow tools + Tier 2 `api_call` escape hatch.
2. **Resources** — Machine schemas, API docs, system config, live status (`schema://...`, `openapi://{resource}`, `status://...`).
   *Causal rationale:* Exposing the API schema as a readable Resource is what makes the Tier 2 generic escape hatch usable without blowing up initial prompt token context with hundreds of tool definitions.
3. **Prompts** — Reusable workflow templates (`prompts/list`, `prompts/get`) teaching the model the recommended sequences, safety checks, and error recovery patterns for that service.

## Schema-driven dynamic design layout

When wrapping API docs, derive commands and Tier 2 bindings from a machine-readable manifest (OpenAPI / JSON Schema) at **build or runtime**:

```
packages/cli/ (or packages/mcp/)
  src/
    dispatch.ts          # generic resource/action router
    codegen/
      from-openapi.ts    # OpenAPI → command & tool manifest
    generated/
      commands.json      # checked-in or build artifact
  openapi.yaml           # source of truth (or fetched URL)
```

Regeneration workflow:
1. Update `openapi.yaml` (or bump the remote doc URL).
2. `pnpm gen` → refreshes `generated/commands.json` + typed parameters map.
3. Review generated changes and allowlists; verify Tier 1 contracts still hold.
4. Smoke: `--help` check, 1 read + 1 write test against staging.

Prefer build-time generation for publishable CLIs (reproducible installs). Runtime fetch is fine for internal tools that pin a live schema URL with caching + checksum.

**Sources:** [Speakeasy OpenAPI → tools](https://speakeasy.com/mcp/tool-design/generate-mcp-tools-from-openapi/), OpenAPI 3.1
## Runtime package criteria

Ship CLI/MCP packages that agents can install safely and cheaply:

| Criterion | Rule |
| --- | --- |
| **Minimal dependencies** | Prefer language stdlib; every dep needs a reason. Audit transitive trees (`pnpm why` / `npm ls`). |
| **Security** | No `postinstall` / `preinstall` scripts that fetch or exec. Prefer packages with npm provenance. Redact secrets in logs, errors, and `--debug` dumps. |
| **Small install size** | Avoid bundling browsers, full AWS SDKs, or unused locales. Tree-shake; publish only `dist/`. |
| **Cross-platform** | Use `node:path` / `pathlib`; never assume `/` or bash. Test Windows path + shell quoting. Prefer `cross-spawn` / Node APIs over `/bin/sh`. |
| **Graceful degradation** | Optional native addons (keytar, etc.) fail soft with a clear message and env-file fallback. Missing optional peers must not crash import. |

Checklist before publish: clean install on Linux/macOS/Windows CI, no network during `postinstall`, `npm pack` size reviewed, secrets never printed by `doctor` / `auth status`.
