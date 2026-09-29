---
name: ak-frontend-design
description: Create polished frontend interfaces with deliberate art direction, from a brief, design, screenshot or video, and audit live products for UI/UX polish. Use for landing pages, product/dashboard UI, web components, 3D experiences, replicating UI designs, quick prototypes, immersive interfaces, avoiding AI slop, and hands-on UX audits of dev/staging/production apps across desktop, tablet and mobile.
user-invocable: true
when_to_use: "Invoke when visual fidelity, taste and polished UI are primary, or to audit and improve the UX of a running product."
category: design
keywords: [ui, ux, design, art-direction, screenshots, ux-audit]
license: Complete terms in LICENSE.txt
argument-hint: "[prompt|image-path|component|url]"
metadata:
  author: agentkit
  version: "3.1.0"
---

# Frontend design

Deliver working interfaces that look deliberately designed: one clear art direction,
disciplined tokens, strong hierarchy, generous rhythm, complete interaction states and
responsive layouts. Taste here is a procedure, not a mood: write the brief, build from
tokens, compare against exemplars, then critique the rendered result and fix it.

Precedence: the user's request, brand assets and an existing design system win over
every default in this skill. Defaults exist so that a silent brief never falls back to
generic output; they are not a reason to overrule an accepted choice.

## 1. Choose the route

| Intent | Route |
|---|---|
| Preserve or improve existing UI | Read existing tokens/components first; write the brief from what exists; keep accepted taste |
| New brand surface (landing, marketing, portfolio) | Brief (step 2) + `references/aesthetic-recipes.md` + `references/taste-exemplars.md` |
| New product surface (app, dashboard, admin, settings) | Brief (step 2) + `references/product-ui-patterns.md` + `references/taste-exemplars.md` |
| Replicate screenshot | `references/workflow-screenshot.md`; the source governs composition |
| Replicate video | `references/workflow-video.md`; match motion and states |
| Describe without coding | `references/workflow-describe.md` |
| Quick prototype | `references/workflow-quick.md` (brief and critique still apply, shortened) |
| Immersive or 3D | `references/workflow-immersive.md`, `references/workflow-3d.md` |
| Audit UI/UX of a running product | `references/workflow-ux-audit.md` + `references/ux-polish-standards.md` |

Use the project's actual stack and components. With no stack, write a single HTML file
with inline CSS and minimal JS. Ask only about a missing decision that changes the result.

## 2. Write the design brief before any code

Write these lines in your response (or the plan) and keep them fixed across iterations.
For preserve/replicate routes, fill them from the existing system or source instead.

```text
Register:  Brand | Product
Scene:     <who uses it, on what device, where, in what light and mood>
Direction: <direction> because <reason found in the content or audience>
Color:     <Restrained | Committed | Full | Drenched>; bg <oklch>, text <oklch>, accent <oklch>
Type:      <display> + <body> (or one family); contrast axis: <e.g. serif vs grotesque>
Signature: <the one memorable element, derived from the content>
Dials:     variance <1-10>, motion <1-10>, density <1-10>
```

Derive the direction from the Scene sentence, not from a favorite style. If a line
cannot be justified by the brief or content, rewrite it until it can.
`references/aesthetic-recipes.md` explains each line and lists directions and presets.

## 3. Defaults when the brief is silent

| Decision | Brand register | Product register |
|---|---|---|
| Tokens | `assets/starter-tokens-brand.css` | `assets/starter-tokens-product.css` |
| Dials (variance/motion/density) | 7 / 5 / 3 | 3 / 2 / 6 |
| Type | Display + body pair on a contrast axis; ratio 1.25–1.333, fluid | One family, 2–3 weights; ratio 1.2, fixed `rem` |
| Color | Restrained (tinted neutrals, accent ≤ 10% of area); Committed only for a color the brand already owns or when the brief asks for boldness | Restrained: accent only for primary action, selection, focus and state |
| Neutrals | One gray family tinted toward the brand hue | Same |
| Radius | One shape system: 0, 8–12px, or pill | 6–8px, nested radius = parent − padding |
| Depth | One strategy per surface: hairlines, layered tinted shadow, or tint elevation | Hairlines and surface tints; shadows only for overlays |
| Motion | One orchestrated entrance; 200–300ms states | 150–250ms state changes only; no page-load choreography |
| Layout | Asymmetric grid, section rhythm 96–160px desktop | Consistent 12-column shell, 24–32px page gutter |
| Icons | One family, one stroke width | Same |

## 4. Build from tokens

Start from the existing tokens or copy the starter file for the register and adjust
`--hue`, fonts and accent to the brief. Every color, size, space, radius, shadow and
duration in the implementation must come from a token. If a value is not in the scale,
change the design, not the scale. Before writing each major section, compare your plan
with the matching pair in `references/taste-exemplars.md`.

## 5. Critique the rendered result, then fix

Taste is judged on the rendered page, not on code. Follow `references/self-critique-loop.md`:
run `scripts/render-check.mjs` on the page, fix every error it reports, then score the
rubric from the screenshots (375, 768 and 1440px) and the report, fix the three weakest
items, and repeat up to three rounds. Run the report even without image input: it is
text, so it catches layout defects that code review misses. Report the final scores
and any item below 2; mark anything you could not render or see as unverified.

## Quality floor

- Real content and working assets; never fabricated metrics, testimonials, logos or
  functionality. Honest labeled placeholders beat invented data.
- States: default, hover, focus-visible, active, disabled, loading, empty, error and
  success where applicable.
- Accessibility: semantic controls, keyboard access, visible focus, contrast ≥ 4.5:1
  for body text and ≥ 3:1 for large text and UI, touch targets ≥ 44px, and
  `prefers-reduced-motion` alternatives for all animation.
- Content stays visible if animation or JavaScript fails; motion serves feedback or meaning.
- Product UI meets `references/ux-polish-standards.md` ("don't make me think").
- No overflow, clipping or broken wrapping at any viewport; build and tests pass.

Use `../ak-design/references/handoff-gate.md` for the final artifact handoff when needed.

## References

| Need | Reference |
|---|---|
| Brief lines, directions, craft numbers, anti-slop list | `references/aesthetic-recipes.md` |
| Bad vs tasteful examples with code | `references/taste-exemplars.md` |
| Rubric and critique loop | `references/self-critique-loop.md` |
| Screenshots and text layout diagnostics per viewport | `scripts/render-check.mjs` |
| App shell, tables, forms, overlays, command palette | `references/product-ui-patterns.md` |
| "Don't make me think" standards | `references/ux-polish-standards.md` |
| Motion timing, easing, GSAP/Motion recipes | `references/motion-craft.md` |
| Anime.js v4 syntax | `references/animejs.md` |
| Generate, optimize and check images/assets | `references/asset-pipeline.md` |
| Analyze screenshots, extract a design system from references | `references/visual-analysis.md` |
| Shared anti-slop preflight for other design skills | `references/design-quality-preflight.md` |

`ak:ui-ux-pro-max`, when installed, adds searchable style, palette and typography data;
it is optional input to the brief, never a prerequisite.
