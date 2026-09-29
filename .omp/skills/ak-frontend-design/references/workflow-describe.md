# Design description workflow

Produce implementation-ready documentation from a screenshot or video, without coding.

1. **Analyze** with `visual-analysis.md`. Describe layout and hierarchy, grid,
   breakpoints visible, every color with its value and role, borders and radii, icons,
   fonts (match what is visible; do not default to Inter or Poppins), sizes, weights,
   line heights, letter spacing, spacing values, shadows, effects and, for video,
   interactions with timing and easing.
2. **Write the brief** lines from `../SKILL.md` for the analyzed design, so an
   implementer inherits its intent, not only its values.
3. **Report** in this shape:

```markdown
# Design analysis: <name>

## Brief
Register / Scene / Direction / Color / Type / Signature / Dials

## Tokens
(CSS variables: color roles, type scale, spacing, radii, shadows, motion)

## Layout
(grid, section order, breakpoints and how the layout re-composes)

## Components
1. <component>: sizes, spacing, states, behavior

## Motion
(what animates, trigger, duration, easing)

## Implementation notes
(stack suggestions, asset needs, accessibility gaps observed, unknowns)
```

Mark any value you could not determine as `Unknown` rather than guessing.
