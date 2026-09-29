## Scenarios

The scenarios below define expected behavior. They double as review fixtures
for the `--advice` post-implementation gate.

### Scenario 1 — Clean git workspace, bare invocation

**Given** a clean workspace on a feature branch, no `plans/handoffs/` yet.
**When** `/ak:handoff` runs with no arguments.
**Expect** `plans/handoffs/` created; artifact written with an
auto-derived slug + timestamp; all nine sections present; Current state
records branch/HEAD/"working tree clean"; Verification section states
"Not captured in this session" for anything unverified; return prints the
path + continuation instruction.

### Scenario 2 — Dirty workspace with `--include-diff --include-status`

**Given** modified files and untracked files exist.
**When** `/ak:handoff --include-diff --include-status` runs.
**Expect** Current state lists changed/untracked files; Work performed cites
executed commands; a redacted diff summary appears with `… truncated at 200
lines …` when the raw diff exceeds the limit; a `git status --short`
snapshot appears, redacted.

### Scenario 3 — Missing git repository

**Given** the current directory is not inside a git repo.
**When** `/ak:handoff` runs.
**Expect** the artifact still writes; Current state section is present with
`Not captured in this session` for the git-derived fields; no `git` command
runs beyond the initial `rev-parse --is-inside-work-tree` probe.

### Scenario 4 — Secret redaction fixture

**Given** the session captured a command output containing (fake) values
like `AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` and a
line `Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.sig-fake`
(three base64url-shaped segments so the JWT regex actually matches).
**When** `/ak:handoff` runs.
**Expect** the artifact contains `[REDACTED:aws-key]` and `[REDACTED:jwt]`
markers respectively; no raw secret value appears anywhere; the total number
of redactions applied is mentioned in Work performed.

### Scenario 5 — Explicit `--output` path

**Given** the user passes `--output plans/handoffs/oauth-callback.md`.
**When** `/ak:handoff --output plans/handoffs/oauth-callback.md` runs.
**Expect** the artifact is written to that exact path (parent created if
needed); the auto-derived slug/timestamp is not applied; the return prints
the same explicit path.

### Scenario 6 — Collision without `--force`

**Given** `plans/handoffs/oauth-callback.md` already exists.
**When** `/ak:handoff --output plans/handoffs/oauth-callback.md` runs
without `--force`.
**Expect** refusal with a message showing existing-file mtime; no write
occurs; suggestion to pass `--force` or choose a different path. Rerunning
with `--force` overwrites the file.
