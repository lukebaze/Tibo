# `ak:handoff --dispatch` Runtime Catalog

This file owns **the dispatch policy of `ak:handoff --dispatch`** — which candidate runtime IDs
this skill may place in an `ak:orchestrate` job spec, and which are
explicitly denied. Availability, flags, auth, models, and capability tiers
are **never** asserted here — they come from `ak:orchestrate`'s live
runtime matrix at run time.

Two references, two questions, no overlap:

- **This file** — policy: is a candidate ID in the user-facing menu?
- **`ak:orchestrate/references/runtime-matrix.md`**
  — evidence: is a candidate available, authenticated, capable, and safe
  right now?

There is no roster in orchestrate to drift from; there is no capability
claim here to drift from. They cannot conflict.

## First-class candidates

Always in the user-facing menu for this skill. `ak:orchestrate` re-verifies
acceptance from the live matrix at dispatch time; nothing here asserts
current implementation support.

| ID | Kind | Notes |
|---|---|---|
| `claude-code` | CLI | Default target for interactive-workflow continuation. |
| `codex` | CLI | Uses the local `ak` MCP runtime for dispatch. |
| `ak-run` | Skill-run | For AgentKit skill invocations. |
| `internal` | In-session subagent | See `ak:orchestrate/references/internal-routing.md`. `--model` is rejected. |

## External, preflight-gated

In the user-facing menu but always subject to orchestrate preflight. A
missing binary, missing authentication, or unverified capability makes the
candidate `unavailable` and returns a blocker without silent substitution.

| ID | Kind |
|---|---|
| `opencode` | CLI |
| `copilot` | CLI |
| `cursor` | CLI |
| `cline` | CLI |
| `qwen-code` | CLI |
| `grok` | CLI |
| `kimi` | CLI |
| `agy` | CLI |

## Not dispatchable

Explicitly denied. Rejecting immediately, with actionable guidance, is
better than a silent substitution or a confusing preflight failure.

| ID | Rejection message |
|---|---|
| `gemini-cli` | "The retired Gemini CLI path is not supported by ak:orchestrate. Choose a first-class runtime (`claude-code`, `codex`, `ak-run`, `internal`) or a preflight-gated external runtime." |

## User-supplied IDs

If the user passes `--agent <id>` that is neither in the menu above nor
`gemini-cli`, refuse with:

> `<id>` is not in the ak:handoff --dispatch dispatch menu. Supported IDs:
> claude-code, codex, ak-run, internal, opencode, copilot, cursor, cline,
> qwen-code, grok, kimi, agy. See ak:handoff/references/dispatch-runtime-catalog.md.

Do not "help" by picking a substitute. The whole point of `--agent` is
user-selected runtime.

## Adding a new runtime to the menu

1. Confirm `ak:orchestrate`'s current dispatch implementation and
   `runtime-matrix.md` can profile the candidate (binary detection,
   authentication check, harness profile evidence).
2. Add a row to First-class or External above with the correct kind.
3. Do not add capability, flag, model, or authentication assertions here.
4. Update the refusal message under "User-supplied IDs" to include the
   new ID in the supported list.

Adding a runtime here is a **policy** change — a decision that this skill
is willing to hand a job to that runtime. It never implies orchestrate
already supports it in the current environment.

## Removing a runtime

1. Move the row to "Not dispatchable" with a rejection message explaining
   why (retired path, incompatible harness, security decision).
2. Update the refusal message.
3. Reference the underlying orchestrate contract change if any.

## Invariants

- No capability, flag, model, or authentication assertion appears in this
  file.
- No live-probe result appears in this file.
- The gemini-cli row is preserved until orchestrate documents renewed
  support.
- Every ID in First-class + External must be a value `ak:orchestrate` can
  currently accept as `runtime:` in a job spec.
