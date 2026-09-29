# Screenshot replication workflow

Replicate a design from a screenshot. The source governs composition; your taste
fills only what the screenshot does not show (states, responsive behavior, motion).

1. **Extract.** Follow `visual-analysis.md` and write every value: fonts (match what
   is visible; do not default to Inter or Poppins), sizes, weights, colors, radii,
   spacing, shadows, effects, image treatments and element positions.
2. **Brief from the source.** Fill the brief lines in `../SKILL.md` from the extraction
   and turn the values into tokens (`../assets/starter-tokens-*.css` shape).
3. **Plan when large.** For a multi-page or multi-component build, write a short plan
   in the project's plan location before implementing.
4. **Build.** Project stack, or a single HTML file when none. Match proportions,
   spacing and hierarchy before details. Add the states and breakpoints the screenshot
   cannot show, in the same visual language.
5. **Assets.** Reuse provided assets; otherwise follow `asset-pipeline.md`.
6. **Verify.** Screenshot your build at the source's viewport and compare side by side
   (`visual-analysis.md`, "Verify an implementation against its source"). Fix
   mismatches, then run `self-critique-loop.md` at the other viewports.
7. **Report** the remaining differences and unverified areas. Record durable
   guidelines in the project's design docs when they exist and the user wants them.
