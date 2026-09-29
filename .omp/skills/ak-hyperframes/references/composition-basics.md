# Composition basics

<!-- verified against hyperframes @ 0.8.77 docs/reference/html-schema.mdx on 2026-09-26 -->

A HyperFrames composition is a plain HTML file. Timing and sizing are
expressed as `data-*` attributes on the composition root and its timed child
elements — there is no separate scene-graph or timeline file to keep in sync.

## Composition root

| Attribute | Required | Meaning |
| --- | --- | --- |
| `data-composition-id` | Yes | Unique composition ID; also the key the animation timeline registers under. |
| `data-start="0"` | Yes on the top-level root | Start of the composition. |
| `data-width` / `data-height` | Yes | Authored frame size in pixels. |
| `data-duration` | Usually | Total render length in seconds. Omit only when HyperFrames can infer a finite duration from the registered timeline or timed media. |
| `data-no-timeline` | Only for timeline-free compositions | Tells the runtime not to wait for a timeline; without it an unregistered composition waits out the 45 s ready timeout (lint: `missing_data_no_timeline`). |

## Timed clips

| Attribute | Required | Meaning |
| --- | --- | --- |
| `id` | Yes | Stable identifier for timing, editing, and animation. |
| `data-start` | Yes | Start in seconds, or a relative expression such as `"intro + 0.5"` (end of clip `intro` plus 0.5 s). |
| `data-duration` | Yes for DOM and nested-composition clips | Visible slot length in seconds. Optional only for images (3 s default), video, and audio (source length). |
| `data-track-index` | No | Studio timeline lane, display only. The render never reads it and it does not control paint order — use CSS `z-index` for layering. |
| `class="clip"` | Recommended | Layout/tooling convention; the shared `.clip` rule supplies the full-frame box. Visibility is keyed off `data-start`/`data-duration`, not the class. |

Media and nesting attributes (`data-media-start`, `data-volume`,
`data-has-audio`, `data-composition-src`, variables) are covered in the
upstream [HTML schema reference](https://hyperframes.heygen.com/reference/html-schema).
Run `hyperframes lint` to catch malformed timing and missing attributes.

## Vertical 1080×1920 example

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      body { margin: 0; background: #0b0b0f; }
      #root { position: relative; width: 1080px; height: 1920px; overflow: hidden; }
      .headline {
        position: absolute;
        left: 64px;
        right: 64px;
        top: 40%;
        font: 700 84px/1.1 system-ui, sans-serif;
        color: #ffffff;
      }
      .cta {
        position: absolute;
        left: 64px;
        bottom: 160px;
        font: 500 40px system-ui, sans-serif;
        color: #7cf29c;
      }
    </style>
  </head>
  <body>
    <main
      id="root"
      data-composition-id="product-launch-vertical"
      data-start="0"
      data-duration="8.5"
      data-width="1080"
      data-height="1920"
    >
      <section id="intro" class="clip headline" data-start="0" data-duration="2.5" data-track-index="0">
        <h1 id="intro-title">Introducing AgentKit</h1>
      </section>
      <section id="pitch" class="clip headline" data-start="intro" data-duration="3" data-track-index="0">
        <h1>Controlled agent engineering,<br />shipped fast.</h1>
      </section>
      <section id="cta" class="clip cta" data-start="pitch" data-duration="3" data-track-index="0">
        <p>Learn more at agentkit.best</p>
      </section>
    </main>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#intro-title", { y: 48, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.2);
      window.__timelines["product-launch-vertical"] = tl;
    </script>
  </body>
</html>
```

The runtime shows and hides each clip from its `data-start`/`data-duration` —
don't hand-roll opacity/visibility CSS for that. Animation inside a clip comes
from a paused, seekable timeline registered under the composition ID in
`window.__timelines`; a composition with no timeline must declare
`data-no-timeline` instead. This composition is 8.5 s long. Overlapping clips
are layered with CSS `z-index`, not `data-track-index`. See
[references/render-workflow.md](render-workflow.md) for the `init` command and
`--resolution portrait` flag that scaffold this 1080×1920 canvas size.
