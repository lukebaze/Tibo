# YAML Frontmatter Reference

## Required Fields

```yaml
---
name: skill-name-in-kebab-case
description: What it does and when to use it. Include specific trigger phrases.
---
```

## All Optional Fields

```yaml
---
name: skill-name
description: [required - at most 1024 chars]
license: MIT                                         # Open-source license
compatibility: Requires Python 3.10+, network access # 1-500 chars, environment needs
allowed-tools: "Bash(python:*) Bash(npm:*) WebSearch" # capability-lint-allow: native frontmatter syntax example
metadata:                                            # Custom key-value pairs
  author: Company Name
  version: 1.0.0
  mcp-server: server-name
  category: productivity
  tags: [project-management, automation]
  documentation: https://example.com/docs
  support: support@example.com
---
```

Kit skills in the AgentKit repository add `user-invocable`, `when_to_use`,
`category`, `keywords`, `argument-hint`, and `metadata.workflow`; the runtime
reads those fields. See `references/agentkit-kit-skill-contract.md`.

## Field Details

### name (required)
- Supports either `skill-name` or `namespace:skill-name` (for example `ak:plan`)
- If namespaced, namespace and skill id both use kebab-case only (no spaces, no capitals)
- Folder name must match the skill id segment (after `:`)
- Cannot contain "claude" or "anthropic" (reserved)

### description (required)
- At most 1024 characters; precise activation boundary without a minimum length
- Structure: `[What it does] + [When to use it]`; add a not-for boundary when useful
- Include trigger phrases users would actually say
- Mention relevant file types if applicable
- Direct phrasing such as "Use when..." is acceptable; see `references/metadata-quality-criteria.md`

### license (optional)
- Common: MIT, Apache-2.0
- Reference full terms in LICENSE.txt if needed

### compatibility (optional)
- 1-500 characters
- Environment requirements: intended product, system packages, network access

### allowed-tools (optional)
- Restricts which tools the skill can use
- Space-separated tool patterns

### metadata (optional)
- Any custom key-value pairs
- Suggested: author, version, mcp-server, category, tags

## Security Restrictions

**Forbidden in frontmatter:**
- XML angle brackets (`< >`) — frontmatter appears in system prompt, could inject instructions
- Skills named with "claude" or "anthropic" prefix (reserved)

**Allowed:**
- Standard YAML types (strings, numbers, booleans, lists, objects)
- Custom metadata fields
- Descriptions up to 1024 characters

## Description Examples

**Good — specific with triggers:**
```yaml
description: Analyzes Figma design files and generates developer handoff docs.
  Use when user uploads .fig files or asks for "design specs" or "design-to-code".
```

```yaml
description: Manages Linear project workflows including sprint planning and
  task creation. Use when user mentions "sprint", "Linear tasks", or "create tickets".
```

**Bad — vague or missing triggers:**
```yaml
description: Helps with projects.                              # Too vague
description: Creates sophisticated documentation systems.      # No triggers
description: Implements the Project entity model.              # Too technical
```
