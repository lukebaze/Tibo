---
name: ak-coding-level
description: "Set coding experience level for tailored output. Use for adjusting explanation depth, code complexity, and response format to user expertise."
user-invocable: true
disable-model-invocation: true
when_to_use: "Invoke when response depth should match user expertise."
category: meta
keywords: [experience, level, explanation, format]
argument-hint: "[0-5]"
metadata:
  author: agentkit
  version: "1.1.1"
---

# Coding Level

Set your coding experience level for tailored explanations and output format.

## Usage

`/ak:coding-level [0-5]`

## Levels

| Level | Name | Description |
|-------|------|-------------|
| 0 | ELI5 | Zero coding experience - analogies, no jargon, step-by-step |
| 1 | Junior | 0-2 years - concepts explained, WHY not just HOW |
| 2 | Mid-Level | 3-5 years - design patterns, system thinking |
| 3 | Senior | 5-8 years - trade-offs, business context, architecture |
| 4 | Tech Lead | 8-10 years - risk assessment, business impact, strategy |
| 5 | God Mode | Expert - default behavior, maximum efficiency (default) |

## Apply and persist the level

Apply the selected level to explanation depth, vocabulary, and examples now.
Keep implementation scope, correctness, tests, and security unchanged at every level.

For persistence, inspect `ak config --help` and `ak config prefs --help`, then
resolve effective preferences with `ak config prefs resolve --json` when supported.
Use the installed CLI's supported configuration write path and scope; verify the
resolved `codingLevel` afterward. Do not create `.claude/.ck.json` on Codex or
assume one runtime's hook injects preferences on every other runtime. If the
installed runtime has no persistence/injection surface, apply the level to this
session and report that limitation. Resolve support from the runtime conformance
matrix when working in AgentKit source, or the installed adapter/help evidence.

For example, level 1 explains why the implementation works and defines unfamiliar
terms; it still delivers complete production behavior and relevant verification.

## Optional: Claude Code Output Styles

For finer control, select one of these styles through Claude Code's `/config`
Output style setting:
- `coding-level-0-eli5`
- `coding-level-1-junior`
- `coding-level-2-mid`
- `coding-level-3-senior`
- `coding-level-4-lead`
- `coding-level-5-god`

Native installs emit these into the runtime's `output-styles/` directory, so
Claude Code can load them through its documented `outputStyle` configuration.
Current `/output-style` discovery has not been verified by an AgentKit runtime
canary. Explicit Claude Code plugin installs emit the same styles into the
plugin-root `output-styles/` directory that Claude Code auto-discovers; its
default path needs no `outputStyles` manifest field. Build-only package output
keeps an inert `.agentkit/output-styles/` sidecar because it is not an installed
Claude runtime surface. Check actual preference injection on the selected runtime and delivery mode;
emitted styles alone do not prove automatic session injection. A same-named style you wrote yourself is preserved
with a warning; a routine `ak update` never overwrites it. `ak kit init --force`
may replace only that selected-kit collision; `--fresh` is the separate
snapshot-backed reset of the selected install target.
