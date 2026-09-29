# Visual analysis and design extraction

Analyze screenshots, videos and inspiration to extract a design system, verify an
implementation against a source, or compare options. Record specific values, never
adjectives: `#1E40AF` not "blue", `48px / 1.1 / -0.02em` not "large heading",
`240ms ease-out` not "fast".

## Route

1. Native vision: look at the images directly when the active model can view them.
2. Otherwise the installed analysis owner (`ak:ai-multimodal`), which picks the provider.
3. Optional fallback: the Multix CLI (https://github.com/mrgoonie/multix-cli) when a
   compatible key is already configured; check `--help` for current syntax.

Capture references at real viewport sizes (1440 desktop, 768 tablet, 375 mobile), not
one tall full-page image, and use 3–5 screens to separate a system from a one-off.
A browser automation owner such as `ak:agent-browser` can capture them.

## Extraction checklist

Answer each heading with values. Fill `Unknown` rather than guessing.

```text
Direction:   movement or style, mood, the one distinctive decision
Typography:  display and body family (2-3 candidates if uncertain; do not default to
             Inter or Poppins), sizes for h1/h2/h3/body/small, weights, line heights,
             letter spacing, case usage
Color:       8-12 colors with hex/OKLCH, each labeled bg / surface / text / muted /
             border / accent / state; gradient stops and angles; color strategy
             (Restrained, Committed, Full, Drenched)
Space:       base unit, observed scale, section spacing, gutters, grid columns
Shape/depth: radius values, border widths, shadow recipes, depth strategy
Components:  buttons (sizes, states), inputs, cards, nav, tables, overlays
Motion:      durations, easing, what animates and why (video only)
Imagery:     photography vs illustration, treatment, icon family and stroke
Signature:   the element that makes it recognizable
Gaps:        accessibility or consistency problems observed
```

Convert the result into tokens in the shape of `../assets/starter-tokens-*.css` and
into the brief format in `../SKILL.md`, so implementation starts from values, not prose.

## Multi-screen and competitive analysis

- Multi-screen: list tokens that repeat across screens (the system) separately from
  values seen once (exceptions), then write the component specs.
- Competitive: for 3 references, record direction, color strategy, type, layout and one
  strength and weakness each; then state what the whole category does (patterns to
  meet) and one or two openings to differentiate. Adapt principles; never copy a
  competitor's identity.

## Verify an implementation against its source

Place source and implementation screenshots side by side at the same viewport and
check, in order: layout and proportions, spacing, typography, color, imagery,
states and motion. List each mismatch with the fix; re-capture after fixing.

## Output

Save a durable extraction only when the user wants one or the project keeps design
docs (for example `docs/design-guidelines.md`). Use this shape:

```markdown
# <Name> design system
## Direction
## Tokens        (CSS variables block)
## Typography    (table: role, family, size, weight, line height, tracking)
## Components    (per component: sizes, states, spacing)
## Motion
## Notes and gaps
```
