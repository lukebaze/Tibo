# Auto Workflow (`--auto`) — Default

**Continuation:** Proceed automatically within scope; decide remaining design choices from the prompt, project context and remembered preferences, and record them as assumptions.

The opening brainstorm contract in the parent skill is already satisfied
(through `ak:advise` when `--ask` was passed); auto mode proceeds without a
routine approval pause and stops only at an authorization boundary.

## Step 1: Research

Spawn multiple `researcher` subagents in parallel:
- Explore request, idea validation, challenges, best solutions
- Keep every report ≤150 lines

No user gate — proceed automatically.

## Step 2: Tech Stack

1. Use multiple `researcher` subagents in parallel for best-fit stack
2. Write tech stack to `./docs` directory

No user gate — auto-select best option.

## Step 3: Wireframe & Design

1. Use `ui-ux-designer` + `researcher` subagents in parallel:
   - Research style, trends, fonts (predict Google Fonts name, NOT just Inter/Poppins), colors, spacing, positions
   - Describe assets for `ak:ai-multimodal` skill generation
2. `ui-ux-designer` creates:
   - Design guidelines at the documentation path discovered from repository instructions
   - Wireframes in HTML at `./docs/wireframe/`
3. If no logo provided: generate with `ak:ai-multimodal` skill
4. Screenshot wireframes with `ak:agent-browser` -> save to `./docs/wireframes/`

Decide remaining design gaps from the contract and record them as assumptions; reuse an accepted direction without another approval.

**Image tools:** `ak:ai-multimodal` for generation/analysis, `imagemagick` for crop/resize, background removal tool as needed.

## Step 4: Implementation → Done

Load `references/shared-phases.md` for remaining phases.

Activate **ak:cook** skill: `/ak:cook --auto <brainstorm contract>`
- No separate planning phase; cook sizes its own implementation plan from the contract
- Continues accepted scope through cook verification and review
- Requires evidence that acceptance criteria hold and blocking findings are resolved
- Continues through all phases unless an external blocker or an authorization boundary (missing secret, unauthorized destructive or outward-facing action, uncovered spend) prevents progress
