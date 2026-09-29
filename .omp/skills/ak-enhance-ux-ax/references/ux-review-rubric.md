# UX review rubric

Score each area 0–3 with evidence (screenshot path, file:line, or a quoted string).
0 missing or broken, 1 present but weak, 2 solid, 3 memorable. Any area below 2 needs
at least one proposal. `ak:frontend-design` owns the underlying polish standards;
this rubric adds the brand, content and AX-facing lens.

## Areas

| Area | Evidence to collect | A 3 looks like |
|---|---|---|
| First impression | Above-the-fold screenshot at each viewport; time to meaningful paint | Within five seconds a stranger can say what it is, for whom, and why it is better |
| Brand recall | Logo, name usage, signature color, type pairing, one repeated motif | A cropped screenshot is still recognizable as this brand |
| Content punch | Headline, subhead, CTA labels, section intros | Headlines state an outcome in plain words; no filler adjectives; one idea per section |
| Clarity and hierarchy | Heading outline, scan path, density per section | One primary action per view; the eye path follows the story order |
| Storytelling | Section order on key pages | Problem → insight → proof → how it works → action; proof is concrete (numbers, names, demos) |
| Knowledge and trust | Docs links, author/company identity, dates, changelog, testimonials, security/privacy notes | Claims are sourced, dated and attributable; contact and policy pages exist |
| Motion | Recorded or stepped interactions; `prefers-reduced-motion` handling | Motion explains state changes and hierarchy; 100–300 ms UI transitions, transform/opacity only, never blocks input |
| Responsive | Screenshots at 1440, 768, 375 plus a 320 px reflow check; overflow; touch targets | Layout is recomposed per viewport, not shrunk; no overflow; targets at least 24 px, primary ones 44 px |
| Accessibility | Contrast, focus-visible, alt text, landmarks, heading order | WCAG 2.2 AA on audited pages |
| Performance feel | LCP element, layout shift, INP, font loading, image formats | p75 LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; hero not lazy-loaded |

`best-practices-and-common-mistakes.md` lists the concrete do/avoid items behind each
area; cite the matching line when a finding repeats a known mistake.

## Default art direction

Apply only when `DESIGN.md` or brand assets do not already decide it.

- **Modern and professional:** a restrained grid, generous whitespace, one accent
  color, a confident sans for UI paired with a characterful display or serif face.
- **Trustworthy:** consistent components, visible real proof, honest copy, no dark
  patterns, stable layout.
- **A touch of nostalgia:** one deliberate period cue, for example paper grain,
  a mono or typewriter accent, an editorial serif, index-card or catalog framing,
  or muted print-like tones. One cue, used consistently; not a costume.
- **Knowledgeable:** show the thinking, for example annotated diagrams, footnote
  style references, glossaries, "how it works" sections, and dated notes.
- **Storytelling:** sections read as chapters with a narrative arc; scroll-linked
  reveals support the sequence rather than decorate it.

## Content rewrite rules

- Lead with the outcome for the reader, then the mechanism.
- Replace abstractions with a concrete noun, number or example.
- Headline at most about ten words; subhead one sentence; CTA a verb plus object.
- Keep the project's language and voice; propose rewrites side by side with the
  original so the owner can accept or reject each one.

## Project guidance files

Propose or, in implementation modes, update these. Preserve every existing section;
add or amend only the parts listed.

- **`DESIGN.md`:** brand essence in one line, art direction, tokens (color, type
  scale, spacing, radius, shadow), motion principles with durations and easing,
  breakpoints, component rules, voice and tone, do/don't examples.
- **`REVIEW.md`:** a UX/AX review checklist: the rubric areas above, the three
  viewports, the discovery surfaces, and the rule that screenshots accompany UI
  changes.
- **`AGENTS.md`** (or the file it links, such as `CLAUDE.md`): tell agents to read
  `DESIGN.md` before UI work, keep discovery surfaces in sync when routes or content
  change, and verify at the three viewports. If `AGENTS.md` is a symlink, edit its
  target.
