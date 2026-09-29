# Plan Creation & Organization

## Directory Structure

### Plan Location

Use `Plan dir:` from `## Naming` section injected by hooks. This is the full computed path.

Default scope:
- project scope → `plans/<timestamp>-authentication/`
- global scope → `{configured-global-plans-root}/<timestamp>-authentication/`
  - Default when unset: `~/.claude/plans/<timestamp>-authentication/`

Use global scope only when `--global` is explicit or there is no project context.

### File Organization

In the active scope root:
```
{plan-dir}/                                    # From `Plan dir:` in ## Naming
├── research/
│   ├── researcher-XX-report.md
│   └── ...
├── reports/
│   ├── scout-report.md
│   ├── researcher-report.md
│   └── ...
├── assets/                                    # Generated image sources for plan.html
├── plan.md                                    # Overview access point
├── plan.html                                  # Primary artifact when --html is used
├── wiki-publish.md                            # Optional combined doc when --wiki publishes Markdown
├── phase-01-setup-environment.md              # Setup environment
├── phase-02-implement-database.md             # Database models
├── phase-03-implement-api-endpoints.md        # API endpoints
├── phase-04-implement-ui-components.md        # UI components
├── phase-05-implement-authentication.md       # Auth & authorization
├── phase-06-implement-profile.md              # Profile page
└── phase-07-write-tests.md                    # Tests
```

### Task Hydration

After creating plan.md and phase files, hydrate tasks (unless `--no-tasks`):
When `--html` is present, hydrate tasks only from the companion `plan.md`
index if it contains actionable checkboxes; otherwise skip hydration and state
that `plan.html` is the authoritative artifact.
1. Discover the live task-management surface
2. If available, mirror phases, dependencies, and critical high-risk steps
3. Otherwise, keep progress in the active plan; see `task-management.md` for the cook handoff protocol

### HTML Artifact Layout

When `--html` is present:
- Keep `plan.html` as the primary user-facing artifact.
- Keep `plan.md` as a concise index for metadata, GitHub links, and cook handoff
  compatibility when needed.
- Keep every `phase-*.md` as the detailed implementation contract when Markdown
  phase files are generated.
- Put generated image source files under `assets/`, then embed selected images
  in `plan.html` as data URIs.
- Verify the main page exposes every phase outline and that each outline opens
  a rendered markdown detail modal.
- Verify `plan.html` opens as a portable single file with no missing local asset
  paths.

### AgentWiki Publish Layout

When `--wiki` is present:
- Publish after final plan gates and after `plan.html` exists when `--html`
  is also present.
- Use `agentwiki doc share` for the default private/workspace document URL.
  Run `agentwiki doc publish` only when the user explicitly requests public
  document publishing.
- For Markdown output, publish `plan.md` when it is complete enough to stand
  alone. If phase details are split across files, create `wiki-publish.md` as
  a concise combined document or index before uploading.
- For HTML output, keep `plan.html` local by default. Upload the portable
  `plan.html` through AgentWiki hosted static sites only when the user
  explicitly requests a public hosted site.
- Record returned AgentWiki document/share/site URLs in `plan.md` when a
  companion Markdown index exists. If `--github` is active, add the URL to the
  GitHub issue.
- Do not publish secrets, raw logs, private env values, or local-only absolute
  paths.

### Active Plan State Tracking

See SKILL.md "Active Plan State" section for full rules. Key points:
- Check `## Plan Context` injected by hooks for active/suggested/none state
- After creating plan: use the active plan mechanism provided by the host project or dashboard
- Active plans use plan-specific reports path; suggested plans use default path

## Plan Creation Via CLI

After determining phases from research/design:

1. **Read live help:** Run `ak plan --help`, then run the selected scaffolding
   subcommand with `--help`. Live help owns syntax and flags.

2. **Scaffold via CLI:** Use the operations described by live help to create the
   plan and required phases. Do not copy a command schema into the plan.

3. **Fill content sections** in plan.md via edit-file capability:
   - `## Overview` — brief description
   - `## Dependencies` — cross-plan dependencies

4. **Fill each phase-XX.md** with:
   - Architecture, implementation steps, success criteria
   - Requirements, risk assessment, security considerations

5. Do not edit the Phases table directly when it is CLI-owned; the CLI
   rewrites it from its own state, so a hand edit is silently discarded. Use the
   status and structure operations exposed by live help.

6. **If `--html`, generate `plan.html` after final plan gates:**
   - Re-read `plan.md` and every `phase-*.md` that exists.
   - Extract visible phase outline summaries for the main page.
   - Render full phase markdown into click-open detail modals.
   - Embed generated watercolor technical sketch images when available.
   - Verify `plan.html` opens without missing local assets.

6. **If `--wiki`, publish final artifacts after gates:**
   - Use `agentwiki doc upload` followed by `agentwiki doc share` for private
     Markdown document sharing.
   - Use `agentwiki doc publish` only on explicit user request for public docs.
   - Use `agentwiki sites upload` for `plan.html` only on explicit user request
     for a public hosted site.
   - Use AgentWiki MCP only when equivalent document/share/site capabilities
     are exposed in the active session.
   - Capture and report the returned URL, or report the exact skip reason.

Markdown plan creation goes through the CLI. The `ak` CLI is required
for AgentKit users. If the selected scaffolding operation fails, report the error; do not fall
back to direct Markdown file scaffolding. In `--html` mode, write the primary
`plan.html` after planning gates finish so the HTML reflects the reviewed plan.
If `--github` is also present, use CLI scaffolding or a concise Markdown index
only for the requested repo-relative `plan.md` link.

## File Structure

### Overview Plan (plan.md)

Every `plan.md` needs YAML frontmatter — the plan index parses it, and a file without it is invisible to the store. See `output-standards.md` for the schema.
When `--html` is active, `plan.md` may be a concise index instead of the full
plan body. It should link to `plan.html`, summarize phases, and keep GitHub
issue metadata stable.

**Example plan.md structure:**
```markdown
---
title: "Feature Implementation Plan"
description: "Add user authentication with OAuth2 support"
status: pending
priority: P1
effort: 8h
issue: <issue-number>
branch: <owner>/feat/<feature-name>
tags: [auth, backend, security]
blockedBy: []
blocks: [global:<timestamp>-user-dashboard]
created: <date>
---

# Feature Implementation Plan

## Overview

Brief description of what this plan accomplishes.

## Cross-Plan Dependencies

| Relationship | Plan | Status |
|-------------|------|--------|
| Blocks | `global:<timestamp>-user-dashboard` | pending |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Setup Environment](./<setup-phase>.md) | Pending |
| 2 | [Core Implementation](./<implementation-phase>.md) | Pending |
| 3 | [Testing & Validation](./<test-phase>.md) | Pending |

<!-- IMPORTANT: Link text MUST be human-readable names (not filenames).
     Bad:  [phase-01-setup.md](./<setup-phase>.md)
     Good: [Setup Environment](./<setup-phase>.md) -->

## Dependencies

- List key dependencies here
```

Reference rules:
- Bare refs stay in the current scope.
- Use `global:` or `project:` when the dependency crosses scopes.
- The live plan CLI's status operation is authoritative for resolved dependency state; confirm its invocation through help.

**Guidelines:**
- Keep generic and under 80 lines
- List each phase with status/progress
- Link to detailed phase files
- Key dependencies

### Phase Files (phase-XX-name.md)
Discover and follow the consuming repository's instruction and development-standard documents. Do not assume a fixed docs path.
Each phase file should contain:

**Context Links**
- Links to related reports, files, documentation

**Overview**
- Priority
- Current status
- Brief description

**Key Insights**
- Important findings from research
- Critical considerations

**Requirements**
- Functional requirements
- Non-functional requirements

**Architecture**
- System design
- Component interactions
- Data flow

**Related Code Files**
- List of files to modify
- List of files to create
- List of files to delete

**Implementation Steps**
- Detailed, numbered steps
- Specific instructions

**Todo List**
- Checkbox list for tracking

**Success Criteria**
- Definition of done
- Validation methods

**Risk Assessment**
- Potential issues
- Mitigation strategies

**Security Considerations**
- Auth/authorization
- Data protection

**Next Steps**
- Dependencies
- Follow-up tasks

### Deep / TDD Extensions

When `--deep` is used, add:
- a file inventory table with action, rough size, and test impact
- a test scenario matrix for critical, high, and medium paths
- a dependency map that calls out links to other phases

When `--tdd` is used, add:
- a **Tests Before** section for regression coverage written first
- a **Refactor** section describing the protected code changes
- a **Tests After** section for new behavior introduced in that phase
- a regression gate listing the compile/test command that must pass
