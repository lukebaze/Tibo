# Quick design workflow

For simple components, prototypes, MVPs and single pages when speed matters. Quick
means fewer rounds, not lower taste: the brief and one critique round still apply.

1. **Brief (short form).** Write the Register, Scene, Direction, Color, Type and
   Signature lines from `../SKILL.md`. One line each is enough.
2. **Tokens.** Copy `../assets/starter-tokens-brand.css` or
   `../assets/starter-tokens-product.css` (or use the project's tokens) and set the
   hue, fonts and accent from the brief.
3. **Build.** Use the project stack; with none, a single HTML file with inline CSS and
   minimal JS. Before each section, glance at the matching pair in `taste-exemplars.md`.
   Use real copy and honest placeholders for missing assets (`asset-pipeline.md`).
4. **One critique round.** Render at 375 and 1440px, score `self-critique-loop.md`,
   fix the three weakest items. Run the fast checks at the end of that file.
5. **Report.** Summarize the brief, what was built, the final rubric scores and what
   remains unverified. When the user approves durable choices and the project keeps
   design docs, record them there (for example `docs/design-guidelines.md`).

Optional input: when `ak:ui-ux-pro-max` is installed, search its style, palette and
typography data to inform the brief; follow that skill's own usage instructions.
