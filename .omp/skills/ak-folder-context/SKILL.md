---
name: ak-folder-context
description: Create a compact subfolder CLAUDE.md and linked AGENTS.md for durable local conventions. Use when a folder needs agent context beyond the project root.
user-invocable: true
when_to_use: Invoke for subfolder-scoped agent context, not root project instructions or general docs.
category: workflow
keywords: [claude-md, agents-md, context, folder, conventions]
license: MIT
argument-hint: "<target-folder>"
metadata:
  author: agentkit
  version: "1.0.3"
  upstream: "Pinned MIT source archive: folder-specific-claude-and-agents-md@ce70edaa26247b84c2b9491a0cdb4964f65cf3a5"
---

# Folder Context

Create durable context only for a subfolder that carries decisions, conventions,
or ongoing work a future agent cannot reliably infer. This skill never edits the
root CLAUDE.md or root AGENTS.md.

## Workflow

1. Confirm the target is a subfolder and inspect its key source, configuration,
   Markdown, and local context files.
2. Apply a sanity gate: do not create files for static reference folders or
   folders whose context can be discovered on demand.
3. For an explicit creation request, write a compact draft in that subfolder and present it for review. Ask only when existing user content conflicts or an overwrite needs a decision.
4. Write a compact target-folder CLAUDE.md using only evidence from the folder
   or explicit user decisions. Omit empty sections.
5. Create target-folder AGENTS.md as a symlink to CLAUDE.md. If symlinks are
   unavailable, create a one-line pointer file that names CLAUDE.md and tell the
   user about the fallback.
6. When the user edits the context file, re-read it and flag contradictions.
   Never revert their edits without instruction.

## Useful Sections

- Purpose and essential files with one-line roles
- Constraints, especially explicit MUST NOT rules
- Conventions and naming
- Locked decisions with dates
- Context needed across sessions

Keep file content compact, specific, and local. Use bullets rather than a file
tree or generic project documentation.

## Boundaries and Safety

- Use ak-docs for project documentation under docs.
- For the root CLAUDE.md/AGENTS.md, use `/ak:docs agent-context`; this skill
  stays subfolder-only and never edits the root.
- Do not duplicate root instructions, invent constraints, write credentials, or
  create context files outside the confirmed target.
- A folder context file inherits the root policy, must not restate the root
  rules, and must not carry an operational route; link to the owning operational
  guide instead.
- Respect the user’s existing local instructions before adding new context.
