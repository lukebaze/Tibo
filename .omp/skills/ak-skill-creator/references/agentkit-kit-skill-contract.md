# AgentKit Kit Skill Contract

Read this before creating or updating a skill that lives under `kits/` in
the AgentKit repository. Skills there are composition input: the `ak` CLI
validates them, projects them into several runtimes, and contract tests pin
parts of their text. Project-scope and user-scope skills (see "Choosing a
target") skip everything in this file except the frontmatter shape.

Link to the executable owners named here instead of copying their content;
they change, this file should not have to.

## Layout and ownership

```
kits/<kit>/skills/ak-<slug>/
├── SKILL.md            # required; name: ak:<slug>
├── references/         # optional, each under 300 lines
├── scripts/            # optional, with scripts/tests/
├── assets/             # optional
└── skill.yaml          # optional runtime manifest (see below)
```

- `kits/core/` is shared composition input, never an installable kit. Child
  kits (`engineer`, `marketing`, …) extend it through `extends: core` in
  their `kit.yaml`; shared skills are authored once in core.
- A skill listed in `kits/core/kit.yaml` is inherited by every child. Do not
  re-list it in the child; use the child's `overrides` block only to replace
  a core file deliberately.
- Every new skill directory must be registered in its kit's `kit.yaml`
  (`skills:` entry with `name` and `path`). The schema owner is
  `docs/specs/kit-yaml-spec.md`.

## Frontmatter the runtime reads

The `ak` adapters read these fields; unknown fields are preserved but unused.

```yaml
---
name: ak:<slug>
description: "What it does, when to use it, what it does not cover."
user-invocable: true
when_to_use: "A precise activation condition for the routing catalog."
category: workflow
keywords: [three, to, six, nouns]
argument-hint: "<subcommand> [path] [--flag]"
metadata:
  author: agentkit
  version: "1.0.0"
  workflow:
    follows: [ak-plan]
    precedes: [ak-test]
---
```

- `name` uses the `ak:` namespace; the directory is `ak-<slug>`.
- `user-invocable`, `when_to_use`, `category`, and `keywords` are required on
  every kit skill; a content test fails the build when one is missing.
- `category` is one of `workflow` (the delivery loop: plan, build, test,
  review, ship, hand off), `engineering` (building and operating software with
  a specific stack or tool), `design` (visual, interface, brand), `marketing`
  (growth, content, go-to-market), `media` (producing or transforming audio,
  video, images, documents, slides), `reasoning` (thinking protocols and
  explanation), `meta` (AgentKit itself, skills, routing), or `runtime`
  (runtime-specific operating modes). The owner is
  `apps/cli/internal/core/kitloader/skill_routing_frontmatter_test.go`.
- `description` is at most 1024 characters. The block-scalar form (`>-`) is
  valid, and `quick_validate.py` measures the folded text.
- `allowed-tools`, `license`, `compatibility`, `disable-model-invocation`
  are also read; see `references/yaml-frontmatter-reference.md`.
- `metadata.version` follows semver. Bump it on every content change so
  installed copies refresh.
- `metadata.workflow.follows` / `precedes` build the skill graph. Refs are
  canonical `ak-*` names and must resolve in every kit that consumes the
  skill; core skills may only reference core skills. Owner:
  `docs/specs/skill-graph-workflow-metadata.md`.

## Capability vocabulary (capability lint)

Kit markdown must not name a runtime's native tools, because the same skill
is projected to runtimes with different tool names. Write the portable
capability instead:

| Write this | Instead of the native names |
|---|---|
| `ask_user capability` | AskUserQuestion |
| `web_search capability` | WebSearch, WebFetch |
| `delegate_agent capability` | Task |
| `manage_plan capability` | TodoWrite, TaskCreate, TaskGet, TaskUpdate, TaskList |
| `edit_file capability` | Edit, Write |
| `read_file capability` | Read |
| `search_files capability` | Grep, Glob |
| `run_shell capability` | Bash |

The lint matches a native name in backticks, after "Use … tool", after
"via", or followed by "(". A line that must show native syntax (for example
an `allowed-tools` example) carries the marker `capability-lint-allow:` in a
comment on that line. Owner:
`apps/cli/internal/commands/kitcmd/skill_capability_lint.go`.

## Runtime manifest (`skill.yaml`)

Add `skill.yaml` beside SKILL.md only when AgentKit must manage executable
dependencies or an entrypoint for the skill. Pure-prompt skills and
standard-library-only scripts need none. Standalone utilities may instead declare
PEP 723 dependencies resolved by a central-cache runner; document that command. Fields, state transitions, and the
run protocol are owned by `docs/specs/skill-runtime-spec.md`.

## Validation path

Run these from the repository root before calling a kit skill done:

```bash
uv run kits/core/skills/ak-skill-creator/scripts/quick_validate.py kits/<kit>/skills/ak-<slug>
uv run --with PyYAML==6.0.3 kits/core/skills/ak-skill-creator/scripts/lint_cruft.py kits/<kit>/skills/ak-<slug> --routing
cd apps/cli && go run . kit validate ../../kits/
```

Kit validation covers `kit.yaml` shape, capability lint, and workflow refs.
Contract tests under `apps/cli/internal/adapters/claude-code/` pin specific
text in some skills (for example argument-hint tokens and reference file
names); grep that package for the skill name before renaming a section or
file, and run `go test ./internal/adapters/claude-code/...` after.

Files under `kits/*/hooks/` are OS-risk paths: a change there needs the
`os-specific` label and the three-OS matrix. Skill scripts under
`skills/*/scripts/` are not hooks and carry no such requirement.

## Docs and follow-up obligations

- Changing a skill's commands, flags, or public contract counts as docs
  impact in the PR; the project-owned `ak:ak` skill must be updated when its
  command reference or examples are affected (see `CLAUDE.md`).
- Do not put plan ids, finding codes, or audit labels in skill text.
- Reports and audits go to `plans/reports/`; they are records, not
  documentation.

## Choosing a target

| Target | Location | Namespace | Validation |
|---|---|---|---|
| Kit skill (this repository) | `kits/<kit>/skills/ak-<slug>/` | `ak:<slug>` | everything above |
| Project skill | `.claude/skills/<slug>/` (Claude Code), `.agents/skills/<slug>/` (Codex and others) | none | `quick_validate.py`, `lint_cruft.py`, consumer eval |
| User skill | the runtime's user skill directory | none | same as project |
| Marketplace / package | `package_skill.py` output | per marketplace | `references/cross-marketplace-distribution.md` |

Per-runtime discovery paths and projection limits are owned by
`docs/conformance/runtime-support-matrix.yaml`; read it when the target
runtime is not Claude Code.
