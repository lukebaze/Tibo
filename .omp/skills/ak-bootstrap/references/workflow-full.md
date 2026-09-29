# Full Workflow (`--full`)

**Continuation:** Proceed through the accepted scope; ask only for material missing decisions or actions beyond it.

The opening brainstorm contract in the parent skill is already satisfied.

## Step 1: Refine Requirements

Resolve only material gaps discovered in the opening contract.
- Ask 1 question at a time, wait for answer before next
- Inspect before asking for facts available from the workspace
- Challenge assumptions when evidence reveals a real trade-off
- Stop when outcome, constraints, non-goals, and acceptance criteria are
  concrete enough to verify

## Step 2: Research

Spawn multiple `researcher` subagents in parallel:
- Explore request validity, challenges, best solutions
- Keep every report ≤150 lines

Present decision-relevant findings; continue when the accepted contract resolves the choice.

## Step 3: Tech Stack

1. Ask user for preferred tech stack. If provided, skip to step 4.
2. Use multiple `researcher` subagents in parallel to find best-fit stack
3. Present 2-3 options with pros/cons via `ask_user capability`
4. Write approved tech stack to `./docs` directory

Reuse the accepted stack; ask only when a new stack decision materially changes the product.

## Step 4: Wireframe & Design

1. Ask user if they want wireframes/design. If no → skip to Step 5.
2. Use `ui-ux-designer` + `researcher` subagents in parallel:
   - Research style, trends, fonts (predict Google Fonts name, NOT just Inter/Poppins), colors, spacing, positions
   - Describe assets for `ak:ai-multimodal` skill generation
3. `ui-ux-designer` creates:
   - Design guidelines at the documentation path discovered from repository instructions
   - Wireframes in HTML at `./docs/wireframe/`
4. If no logo provided: generate with `ak:ai-multimodal` skill
5. Screenshot wireframes with `ak:agent-browser` -> save to `./docs/wireframes/`

Reuse the accepted design direction; resolve any material outstanding design choice.

**Image tools:** `ak:ai-multimodal` for generation/analysis, `imagemagick` for crop/resize, background removal tool as needed.

## Step 5: Implementation → Done

Load `references/shared-phases.md` for remaining phases.

Activate **ak:cook** skill: `/ak:cook <brainstorm contract>`
- No separate planning phase; cook sizes its own implementation plan from the contract
- Continue within accepted scope through tests and review; ask only about material scope changes
