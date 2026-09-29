# Asset pipeline

Generate, check, optimize and integrate images for an interface. Assets serve the
brief: they never replace real product screenshots or real photography the user can
supply, and they never carry the design on their own.

## Route

1. Use assets the user or brand already has (product screenshots, photography, logos).
2. Otherwise generate with the installed image-generation owner, normally
   `ak:ai-multimodal`, which owns provider routing, credentials and current command syntax.
3. Optional fallback when that owner is unavailable but a compatible key is already
   configured: the Multix CLI (https://github.com/mrgoonie/multix-cli). Check the
   current syntax with `--help` before use; never probe for or print credentials.

   ```bash
   npx --yes --package=@mrgoonie/multix@latest -- multix --help
   ```

4. With no generation route: use honest labeled placeholders such as
   `https://picsum.photos/seed/<descriptive-keyword>/1600/900`, verified to load, or a
   clearly marked slot, and tell the user which assets remain to be supplied.

Never build fake screenshots, fake dashboards or "CSS scenery" out of divs to stand in
for imagery the brief requires.

## Write the prompt from the brief

Translate the brief, not a generic request. Include:

1. Style or movement tied to the Direction line ("Swiss editorial photography").
2. Subject from the content (the actual product, place or object).
3. Color direction using the palette ("muted slate with one rust accent").
4. Mood from the Scene line.
5. Composition for integration ("subject on the right third, calm negative space on
   the left for a headline").
6. Aspect ratio and use (16:9 hero, 4:5 card, 1:1 avatar, 9:16 mobile hero).

Generic: "Modern website hero image". Brief-driven: "Overhead photograph of a
warehouse packing table, soft north light, slate and kraft-paper tones with one rust
tape accent, calm empty area on the left third for a headline, 16:9".

Keep prompts consistent across a set: reuse the palette and style words so assets
read as one family.

## Check before integrating

Inspect the image yourself (native vision) or with the analysis owner. Accept only when:

- it matches the Direction and palette, and the subject is correct;
- it has no artifacts (warped hands, fake text, broken edges, watermarks);
- text laid over it passes contrast (≥ 4.5:1 body, ≥ 3:1 large text) in the real layout;
- the focal point survives the mobile crop.

If it fails, name the specific defect, change the prompt to address it, and regenerate.
Compare variations only when exploring or when the first result misses.

## Optimize and integrate

- Format: AVIF or WebP for photos, SVG for icons and logos, PNG only when lossless
  transparency is required. Target under 200KB for a hero, under 80KB for cards.
- Responsive: `srcset`/`sizes` for resolution switching; `<picture>` with separate
  crops for art direction between desktop and mobile.
- Set `width`/`height` (or `aspect-ratio`) to prevent layout shift; `loading="lazy"`
  below the fold; `fetchpriority="high"` for the hero image only.
- Alt text describes purpose and content in ≤ 150 characters; empty `alt=""` for
  purely decorative images.
- Treat stock-looking photos in CSS so they belong to the palette: grayscale plus a
  duotone overlay, `mix-blend-mode: luminosity` over a brand color, or a subtle
  contrast boost.
- Text over images: a gradient scrim on the text side
  (`linear-gradient(to right, oklch(15% 0.02 var(--hue) / 0.7), transparent 60%)`)
  rather than a full dark overlay or heavy text shadow.
- Post-processing (resize, crop, background removal, sprite sheets, video): use the
  installed media-processing owner when present.

## Icons and illustration

One icon family and one stroke width for the whole project (the project's set, or
Phosphor, Lucide, Tabler). Real brand logos from the brand or
`https://cdn.simpleicons.org/<slug>`. No emoji as icons. No illustration beats a weak
illustration; do not hand-draw SVG scenes.
