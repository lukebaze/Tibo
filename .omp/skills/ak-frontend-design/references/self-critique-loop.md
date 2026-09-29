# Self-critique loop

Judge the rendered pixels, not the code. Code that "should" look good often does not.

## Render and capture

1. Run the bundled checker from a shell (Node 22+ and a local Chrome, Edge or
   Chromium; `CHROME_PATH` overrides discovery):

   ```bash
   node <skill-dir>/scripts/render-check.mjs index.html --out render-check
   ```

   It accepts a file or a URL (for a dev server), saves full-page screenshots at
   375×812, 768×1024 and 1440×900, and prints a text report per viewport: runtime
   errors, horizontal overflow, a squeezed main column, empty grid items, low text
   contrast, text runs that touch, clipped text, closed dialogs that still show, small
   touch targets, broken images and fonts, plus an outline of the large boxes with
   their positions. Exit code 1 means errors were found; 2 means it could not run.
2. Fix every ERROR and every WARN you cannot justify, then re-run until the report is
   clean. The report is the source of truth for layout; do not skip it because the
   code looks right.
3. Look at the screenshots when your environment accepts image input. If image input
   is unavailable or a screenshot read fails, do not stop the task: use the installed
   vision/analysis owner (see `visual-analysis.md`) if there is one, otherwise score
   the rubric from the report, the outline and the code, and mark visual items as
   unverified.
4. For product UI, also check one hover state, one open overlay and one empty or error
   state (open them in the page or through the project's browser automation).

If the checker cannot run (no Node 22 or no browser), use the environment's browser
automation or preview to capture the same viewports, and say which checks were skipped.

## Score the rubric

Score each item 0 (fails), 1 (acceptable) or 2 (deliberate and polished). Write one line
of evidence per item, pointing at something visible in a screenshot.

| # | Item | Pass (2) looks like |
|---|---|---|
| 1 | Brief fidelity | The page visibly expresses the brief's direction, color strategy and signature element |
| 2 | Hierarchy | Squint test: blur your eyes; the most important element is still obvious, and there is one primary action per view |
| 3 | Spacing rhythm | Gaps come from the scale; gaps inside a group are clearly smaller than gaps between groups; nothing touches or crowds |
| 4 | Alignment | Edges line up on a grid; text is left-aligned (except short centered display text); numbers are right-aligned |
| 5 | Typography | ≤ 2 families, clear size steps, comfortable line length (45–75ch), balanced headings, no orphaned words in the hero |
| 6 | Color discipline | Grayscale test: the page still works without color; the accent appears only where it means something |
| 7 | Depth and shape | One depth strategy and one radius system across the page; no border plus heavy shadow combinations |
| 8 | States and feedback | Hover, focus-visible, active, disabled, loading, empty and error states exist and look designed |
| 9 | Responsiveness | No overflow or horizontal scroll at 375px; layout re-composes (not just shrinks); touch targets ≥ 44px |
| 10 | Slop tells | None of the anti-slop list in `aesthetic-recipes.md` appears unless the brief asked for it |
| 11 | Content and copy | Real, specific copy in the user's words; no clichés, placeholder names or invented numbers |
| 12 | Craft details | Consistent icons, tabular numbers in data, balanced headings, favicon/title, no default browser controls |

Target: no item below 1, and a total of at least 20 of 24.

## Fix and repeat

1. List the three lowest-scoring items with the specific change that raises each one
   (for example "section gaps 32px → 96px; related items 8px").
2. Apply the changes through tokens where possible.
3. Re-run `render-check.mjs` and re-score only what changed plus anything that
   might have regressed.
4. Stop after three rounds or when the target is met. Report the final table and any
   item still below 2 with the reason.

Do not raise a score by lowering the bar: if an item scored 1, the evidence line must
show what makes it 1, not 2. A perfect score in the first round usually means the
rubric was read, not applied; still name the three weakest items and improve them.
For item 1, write three adjectives the page gives off and check they match the mood
words in the Scene (a warm craft workshop should not read as "corporate" or "cool").

## Fast checks that catch common failures

- Remove one thing: if a badge, icon, divider or line of copy could be deleted without
  loss, delete it.
- Count accents: more than three accent-colored elements above the fold usually means
  color is decoration.
- Count type sizes on one screen: more than six distinct sizes means the scale was ignored.
- Search the CSS for raw hex values, pixel values not in the scale, `transition: all`,
  `z-index: 9999`, `100vh` and `!important` outside reduced-motion rules.
- Search visible copy for "Elevate", "Seamless", "Unleash", "Empower", "Supercharge",
  "Next-gen", lorem ipsum, "John Doe" and "Acme".
- Tab through the page: every interactive element shows a visible focus ring in order.
