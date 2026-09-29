# Parallel Workflow (`--parallel`)

**Continuation:** Reuse accepted design and scope, then execute independent work in parallel; ask only for material missing decisions.

The opening brainstorm contract in the parent skill is already satisfied and
must be passed to every independent implementation branch.

## Step 1: Research

Spawn max 2 `researcher` agents in parallel:
- Explore requirements, validation, challenges, solutions
- Keep reports ≤150 lines

No user gate — proceed automatically.

## Step 2: Tech Stack

Use multiple `researcher` agents in parallel for best-fit stack.
Write to `./docs` directory (≤150 lines).

No user gate — proceed automatically.

## Step 3: Wireframe & Design

1. Use `ui-ux-designer` + `researcher` agents in parallel:
   - Research style, trends, fonts, colors, spacing, positions
   - Predict Google Fonts name (NOT just Inter/Poppins)
   - Describe assets for `ak:ai-multimodal` generation
2. `ui-ux-designer` creates:
   - Design guidelines at the documentation path discovered from repository instructions
   - Wireframes in HTML at `./docs/wireframe/`
3. If no logo: generate with `ak:ai-multimodal` skill
4. Screenshot with `ak:agent-browser` -> save to `./docs/wireframes/`

Resolve material design gaps; reuse an accepted direction without another approval.

**Image tools:** `ak:ai-multimodal` for generation/analysis, `imagemagick` for crop/resize, background removal tool as needed.

## Step 4: Parallel Implementation → Done

Load `references/shared-phases.md` for remaining phases.

Activate **ak:cook** skill: `/ak:cook --parallel <brainstorm contract>`
- No separate planning phase; cook splits the contract into independent work units with **exclusive file ownership** and a dependency order
- Launch multiple `fullstack-developer` agents in PARALLEL for independent units
  - Pass: the unit's scope, owned files, environment info
- Use `ui-ux-designer` for frontend (generate/analyze assets with `ak:ai-multimodal`, edit with `imagemagick`)
- Respect file ownership boundaries
- Run type checking after implementation
- Keep verification and safety gates; `--parallel` controls execution shape

Continue with code review, UX/AX enhancement, release, docs, onboarding and final report per `shared-phases.md`.
