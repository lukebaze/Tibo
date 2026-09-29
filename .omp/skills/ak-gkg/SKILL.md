---
name: ak-gkg
description: Semantic code analysis with GitLab Knowledge Graph. Use for go-to-definition, find-usages, impact analysis, architecture visualization. Supports Ruby, Java, Kotlin, Python, TypeScript/JavaScript.
user-invocable: true
when_to_use: "Invoke for semantic code navigation and impact analysis."
category: engineering
keywords: [code-analysis, knowledge-graph, gitlab]
argument-hint: "[symbol or query]"
metadata:
  author: agentkit
  version: "1.0.1"
---

# GitLab Knowledge Graph (GKG)

Semantic code analysis engine using AST parsing and KuzuDB graph database. Enables IDE-like code navigation for AI assistants.

**Status**: Public beta | **Requires**: Git repository | **Storage**: `~/.gkg/`

## When to Use

- Find all usages of a function/class across codebase
- Go-to-definition for symbols
- Impact analysis before refactoring
- Generate architecture diagrams
- RAG-enhanced code understanding

**Use repomix instead** for: quick context dumps, any-language support, remote repos, token counting.

## Quick Start

```bash
# Check installation
gkg --version

# Inspect an existing index first; index only if missing/stale
gkg index

# Start server (for API/MCP)
gkg server start

# Stop only a server this task owns before re-indexing
gkg server stop
```

## Installation

```bash
# macOS/Linux
curl -fsSL https://gitlab.com/gitlab-org/rust/knowledge-graph/-/raw/main/install.sh | bash

# Windows (PowerShell)
irm https://gitlab.com/gitlab-org/rust/knowledge-graph/-/raw/main/install.ps1 | iex
```

## Core Workflows

### Index and Query
```bash
gkg index /path/to/project --stats
gkg server start
# Query via HTTP API at http://localhost:27495
```

### Find Symbol Usages
1. Inspect the existing index and running server; query it when current.
2. Reindex only missing/stale coverage; stop only a server this task owns. If another session owns it, use native search or obtain coordination.
3. Query the live-supported reference/search surface. Empty results in an incompletely supported language do not prove there are no callers; cross-check native source search.

### Impact Analysis
1. Query existing indexes for affected repos; rebuild only stale/missing coverage
2. Query `get_references` for changed symbols
3. Review all call sites before refactoring

## Language Support

| Language | Cross-file Refs |
|----------|-----------------|
| Ruby | ✅ Full |
| Java | ✅ Full |
| Kotlin | ✅ Full |
| Python | 🚧 In progress |
| TypeScript | 🚧 In progress |
| JavaScript | 🚧 In progress |

## References

- [CLI Commands](./references/cli-commands.md) - `gkg index`, `gkg server`, `gkg remove`, `gkg clean`
- [MCP Tools](./references/mcp-tools.md) - 7 tools for AI integration
- [HTTP API](./references/http-api.md) - REST endpoints for querying
- [Language Details](./references/language-support.md) - Supported features per language

## Key Constraints

- If reindexing needs a server stop, establish ownership first; never stop another session’s server
- Requires initialized Git repository
- Languages not connected across repos (yet)
- TS/JS/Python cross-file refs incomplete
