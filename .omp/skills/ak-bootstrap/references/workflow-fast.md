# Fast Workflow (`--fast`)

**Continuation:** Fast research and design path, then cook through verification within accepted scope.

The opening brainstorm contract in the parent skill is already satisfied; fast
mode reduces research overhead, not intent quality.

## Step 1: Combined Research

All research happens in parallel, then feeds into design and implementation:

**Parallel research batch** (spawn these simultaneously):
- 2 `researcher` subagents (max 5 sources each): explore request, validate idea, find solutions
- 2 `researcher` subagents (max 5 sources each): find best-fit tech stack
- 2 `researcher` subagents (max 5 sources each): research design style, trends, fonts, colors, spacing, positions
  - Predict Google Fonts name (NOT just Inter/Poppins)
  - Describe assets for `ak:ai-multimodal` generation

Keep all reports ≤150 lines.

## Step 2: Design

1. `ui-ux-designer` subagent analyzes research, creates:
   - Design guidelines at the documentation path discovered from repository instructions
   - Wireframes in HTML at `./docs/wireframe/`
2. If no logo provided: generate with `ak:ai-multimodal` skill
3. Screenshot wireframes with `ak:agent-browser` -> save to `./docs/wireframes/`

**Image tools:** `ak:ai-multimodal` for generation/analysis, `imagemagick` for crop/resize, background removal tool as needed.

No design gate in fast mode — proceed directly to implementation.

## Step 3: Implementation → Done

Load `references/shared-phases.md` for remaining phases.

Activate **ak:cook** skill: `/ak:cook --fast <brainstorm contract>`
- No separate planning phase; cook writes a concise plan from the contract and the research above
- Skips redundant research because Step 1 already happened
- Keeps verification and safety gates; continue within accepted scope
- Continues according to normal cook mode

**Note:** Fast mode optimizes setup speed, not approval bypass. Use `git-manager` only after normal cook completion.
