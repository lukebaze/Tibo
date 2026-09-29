# Motion Craft — Timing, Easing, GSAP & Motion Recipes

Load this when the task involves scroll animation, page-load choreography, GSAP, Motion (Framer), or a build with the motion dial above 4. `aesthetic-recipes.md` holds the motion rules; this file is the implementation playbook.

## 1. Timing system

The 100/300/500 rule — duration is set by what the animation does, never by taste:

| Class | Duration | Examples |
|-------|----------|----------|
| Instant feedback | 100-150ms | button press, toggle, checkbox, tab switch |
| State change | 200-300ms | hover, menu open, tooltip, dropdown |
| Layout change | 300-500ms | accordion, modal, drawer, expand/collapse |
| Entrance | 500-800ms | hero reveal, page-load orchestration (brand surfaces ONLY) |

- Exits run at ~75% of the entrance duration — leaving is faster than arriving.
- Interactions under ~80ms feel instant; don't animate below that threshold.
- Stagger: 30-60ms per item, entire sequence ≤ 500ms. More items → shorter per-item delay, or cap how many stagger (rest appear together).
- Pause ≥ 300ms before a key reveal — the viewer needs reaction time; an instant cut loses the information.
- End every sequence with a hard stop on a decisive final state. Never fade everything out.

## 2. Easing tokens

Define once, use everywhere:

```css
:root {
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);   /* default UI ease */
  --ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);  /* slightly snappier */
  --ease-out-expo:  cubic-bezier(0.16, 1, 0.3, 1);   /* reveals, entrances */
}
```

- Default for reveals/entrances: `--ease-out-expo`, ~600ms.
- Springs are fine in Motion: `{ type: "spring", stiffness: 100, damping: 20 }`.
- **Banned**: `linear` for UI movement (reserve for marquees/spinners), bounce `cubic-bezier(0.34,1.56,0.64,1)` and elastic `cubic-bezier(0.68,-0.6,0.32,1.6)` as general easings — dated and tacky. A small overshoot is acceptable on toggles/switches only.
- Never `transition: all` — list the exact properties.

## 3. Choreography

- Motion must be motivated by hierarchy, feedback, story, or state. "Looked cool" is invalid. Product UI: 150-250ms state-conveying motion only, no page-load choreography.
- One well-orchestrated page-load with staggered reveals beats scattered micro-animations. Budget the drama: brand surfaces get ONE orchestrated moment.
- Long scroll narratives follow a slow-fast-boom-stop arc: slow trigger (~15%) → reveal (~15%) → fast process (~40%) → burst (~20%) → still hold (~10%). Uniform pacing reads as a tech demo.
- Focus shifts need depth, not just opacity: de-emphasize the background with `brightness(.5) saturate(.7) blur(4px)` while the focus target stays sharp. Opacity alone leaves the background visually competing.
- The uniform whole-section fade-and-rise applied to every section is the #1 scroll-animation tell. Vary reveals to fit what they reveal: a stat counts up, an image scales from 0.95, a list staggers, a divider draws. Suppressing the reflex is never a reason to ship zero motion.

## 4. Tech selection

| Need | Tool |
|------|------|
| Hover/press/focus states, simple entrances | CSS transitions + `animation-delay` stagger |
| React reveals, springs, gestures, layout animation | Motion (`motion/react`): `whileInView`, `useMotionValue` |
| Pinning, scrubbing, horizontal pan, card stacking, timelines | GSAP + ScrollTrigger |
| Scroll-linked without JS | CSS `animation-timeline: view()` (progressive enhancement) |

- Never mix GSAP and Motion in one component tree — one owner per subtree.
- **Banned scroll tech**: raw `window.addEventListener('scroll')`, `window.scrollY` in React state, rAF loops writing state, `useState` for any continuous value (scroll, mouse, magnetic pull). Use `useScroll`/`useMotionValue`/`useTransform`, ScrollTrigger, or IntersectionObserver — they bypass the React render loop.

## 5. GSAP recipes

Register once: `gsap.registerPlugin(ScrollTrigger)`. Pins MUST use `start: "top top"` — `"top center"` / `"top 80%"` on a pinned section is the #1 GSAP failure (the pin engages mid-viewport and the layout jumps).

**Sticky card stack** — cards pile up as you scroll; the previous card recedes, scrubbed by the NEXT card's approach:

```js
cards.forEach((card, i) => {
  ScrollTrigger.create({ trigger: card, start: "top top", pin: true, pinSpacing: false });
  if (i < cards.length - 1) {
    gsap.to(card, {
      scale: 0.92, opacity: 0.55,
      scrollTrigger: { trigger: cards[i + 1], start: "top bottom", end: "top top", scrub: true },
    });
  }
});
```

**Horizontal pan** — a wide track scrolls sideways while the section is pinned:

```js
gsap.to(track, {
  x: () => -(track.scrollWidth - window.innerWidth),
  ease: "none",
  scrollTrigger: {
    trigger: section, start: "top top", pin: true, scrub: 1,
    end: () => "+=" + (track.scrollWidth - window.innerWidth),
    invalidateOnRefresh: true,
  },
});
```

**Pinned split** — section title pinned left while items scroll on the right: `ScrollTrigger.create({ trigger: section, start: "top top", end: "bottom bottom", pin: titleEl })` with the right column as normal flow.

**Scrubbed text reveal** — words of a central paragraph go 0.1 → 1.0 opacity sequentially: split into `<span>`s, `gsap.to(words, { opacity: 1, stagger: 0.1, scrollTrigger: { trigger, start: "top 70%", end: "top 20%", scrub: true } })` with words at `opacity: 0.1` base (visible-by-default, see §8).

**Image scale-and-fade** — images enter at `scale: 0.85`, settle to `1.0` in view, dim to `opacity: 0.2` scrolling out. Two tweens on enter/leave triggers, both scrubbed.

Limits: max 1 marquee per page; `invalidateOnRefresh: true` on anything measuring the DOM; kill triggers on unmount in SPAs.

## 6. Motion (Framer) recipes

**Standard reveal** — reserve GSAP for pin/scrub; simple reveals use:

```jsx
<motion.div
  initial={{ opacity: 0, y: 24 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, amount: 0.3 }}
  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
/>
```

**List stagger** — parent `variants` with `staggerChildren: 0.05`; or CSS-only: `animation-delay: calc(var(--i) * 50ms)` with `--i` set per item.

**Magnetic button** — continuous values live in motion values, never state:

```jsx
const x = useMotionValue(0), y = useMotionValue(0);
const sx = useSpring(x, { stiffness: 150, damping: 15 });
const sy = useSpring(y, { stiffness: 150, damping: 15 });
// onPointerMove: x.set((e.clientX - rect.x - rect.width / 2) * 0.3); onPointerLeave: x.set(0)
<motion.button style={{ x: sx, y: sy }} />
```

## 7. Micro-interactions

- Button physics: hover `translateY(-2px)` or `scale(1.02-1.05)` at 200ms `--ease-out-quart`; press `translateY(2px)` or `scale(0.98)` at 100ms. Hover must move or reveal something — a bare color dim is not a state.
- Card image hover: scale the image inside an `overflow-hidden` container (`group-hover:scale-105 duration-700 ease-out`) — the container never grows.
- Skeletons over spinners; shimmer via a translating gradient on `transform`, not `background-position`.
- Perpetual ambient motion (mesh blobs, grain drift) when the motion dial is above 5: opacity 0.02-0.04, duration 20s+, on a `position: fixed; pointer-events: none` layer.

## 8. Safety & performance (non-negotiable)

- **Reveal safety**: content is visible by default; animation enhances it. Never gate visibility on a class-toggled transition — transitions pause in hidden tabs and headless renderers, and the section ships blank. Pattern: base styles = final state; JS adds the `from` state then animates back, so no-JS still renders.
- **Reduced motion**, required for every animated build:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

  For scroll narratives, provide a crossfade or static alternative, not just disabled motion.
- Animate `transform` / `opacity` / `color` / `box-shadow` only. Expansion: `grid-template-rows: 0fr → 1fr` or FLIP — never animate `width/height/top/left/margin`. Blur, `backdrop-filter`, `clip-path`, and mask are allowed as premium materials when bounded to small areas and verified smooth in-browser.
- `will-change` on demand (set before, remove after) — never page-wide.
- Off-screen animation causes horizontal scrollbars: wrap the page in `overflow-x: hidden` on the outermost container AND verify at 375px.
- Motion claimed = motion shown: if the build advertises scroll animation, eyeball it in a browser before reporting done.

## 9. Anti-pattern checklist

Fail any of these → fix before delivering:

- [ ] Same fade-up entrance on every section
- [ ] `transition: all`, `linear` UI easing, bounce/elastic easing
- [ ] Scroll listener or `useState` driving continuous animation
- [ ] Pinned section with `start` other than `"top top"`
- [ ] Reveal that hides content until JS runs
- [ ] Missing `prefers-reduced-motion` handling
- [ ] Animating layout properties (width/height/top/left)
- [ ] Stagger sequence longer than 500ms total
- [ ] More than one marquee; GSAP and Motion mixed in one tree
- [ ] Horizontal scrollbar at any viewport caused by off-screen elements
