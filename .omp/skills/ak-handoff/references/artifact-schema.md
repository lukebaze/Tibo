# `ak:handoff` Artifact Schema

The handoff artifact is a Markdown document with a fixed section order. This
schema is validated by `ak:handoff --dispatch` before dispatch (by heading name,
tolerating extra sections between required ones).

## Frontmatter (optional but recommended)

```yaml
---
handoff-version: 1
generated: 2026-08-07T10:49:00Z
generator: ak:handoff@2.0.0
focus: "continue the OAuth callback fix"
workspace: /path/to/repo
branch: feature/oauth-callback
head: 26f9ff8
---
```

`handoff-version` lets `ak:handoff --dispatch` reject artifacts written by a future
incompatible schema.

## Required section order

Every artifact contains these nine H2 sections, in this exact order and with
these exact headings:

```markdown
# HANDOFF: <short title>

## Mission and current status
## Scope and guardrails
## Current state
## Decisions and rationale
## Work performed
## Verification
## Open risks and blockers
## Exact next actions
## Source pointers
```

Additional H2 sections may appear between required ones. `ak:handoff --dispatch`
tolerates extra sections; it fails closed only when a required heading is
missing.

## Section contracts

- **Mission and current status** — outcome + `Done:` list + `Remaining:`
  list + optional `Urgency:` line. When the focus string was passed, quote
  it verbatim on the first line.
- **Scope and guardrails** — `Workspace:`, `In scope:`, `Out of scope:`,
  `Constraints:` (user-imposed), `Safety boundaries:` (destructive
  operations disallowed, protected files, etc.).
- **Current state** — `Branch:`, `HEAD:`, `Working tree:`, `Changed files:`
  (bounded list), `Untracked files:` (bounded list), `Intentional local
  modifications:` (`yes|no|not captured`).
- **Decisions and rationale** — table or bulleted list of `Decision —
  Rationale — Alternative rejected — Reference` rows.
- **Work performed** — bulleted commands executed with observed outcome,
  and code/config changes described at file granularity. `N redactions
  applied.` line at the end.
- **Verification** — table of `Check — Command — Outcome — When`. Include a
  `Not run:` sub-list for skipped checks with a reason each.
- **Open risks and blockers** — bulleted, each with `Type:` (blocker,
  risk, question), `Owner:` (unknown when unknown), `Impact:` short.
- **Exact next actions** — numbered list; the first item is prefixed
  `**First safe step**` in bold.
- **Source pointers** — bulleted list of paths and URLs the successor agent
  needs. Do not fabricate URLs. Repo-relative paths preferred.

For any section with no trustworthy information, write literally
`Not captured in this session` — do not delete the heading.

## Minimal example (Scenario 1 — clean workspace)

```markdown
---
handoff-version: 1
generated: 2026-08-07T10:49:00Z
generator: ak:handoff@2.0.0
focus: "start OAuth callback fix"
workspace: /home/user/agentkit
branch: feature/oauth-callback
head: 26f9ff8
---

# HANDOFF: start OAuth callback fix

## Mission and current status
Focus: "start OAuth callback fix".
Done: none — new session.
Remaining: reproduce the callback 500 in staging, then design the fix.
Urgency: normal.

## Scope and guardrails
Workspace: /home/user/agentkit
In scope: `apps/api/auth/oauth-callback.ts` and its unit tests.
Out of scope: session store schema, mobile deep-link handling.
Constraints: preserve public callback URL shape.
Safety boundaries: no destructive migrations; no changes to production secrets.

## Current state
Branch: feature/oauth-callback
HEAD: 26f9ff8
Working tree: clean
Changed files: none
Untracked files: none
Intentional local modifications: no

## Decisions and rationale
Not captured in this session

## Work performed
No commands executed yet.
0 redactions applied.

## Verification
Not captured in this session

## Open risks and blockers
- Type: question. Owner: unknown. Impact: whether staging reproduction is
  possible without a real IdP credential.

## Exact next actions
1. **First safe step** — read `apps/api/auth/oauth-callback.ts` and its
   test file.
2. Reproduce the 500 in staging with the shared test IdP.
3. Draft the fix in a new branch off `feature/oauth-callback`.

## Source pointers
- `apps/api/auth/oauth-callback.ts`
- `docs/auth/oauth-callback-spec.md`
```

## Validation summary (used by `ak:handoff --dispatch`)

An artifact passes validation when:

- Every required H2 heading is present, spelled exactly as above.
- The document begins with an H1 that starts with `HANDOFF: `.
- No line matches the raw-secret patterns in
  [redaction-patterns.md](redaction-patterns.md).
- `Exact next actions` includes at least one item, and the first item is
  bold-prefixed `**First safe step**`.

Any failure is a hard blocker — `ak:handoff --dispatch` refuses to dispatch.
