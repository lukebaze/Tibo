# Render workflow

This reference owns the reproducibility pin `hyperframes@0.8.77` (verified as of
2026-09-26, verified via `npm view hyperframes version`). Update this pin and the
version markers in the other references in one commit when bumping.

## 1. Init

Scaffold a new composition project from a named preset:

```bash
npx -y hyperframes@0.8.77 init my-composition --resolution portrait --non-interactive
```

`--resolution` accepts named presets: `landscape` (1920×1080), `portrait`
(1080×1920), `landscape-4k` (3840×2160), `portrait-4k` (2160×3840), `square`
(1080×1080), `square-4k` (2160×2160) — plus aliases `1080p`, `4k`, `uhd`,
`1080p-square`, `square-1080p`, `4k-square`. Without `--resolution`, `init`
keeps the chosen example's own dimensions (typically 1920×1080). Pick a starter
with `-e/--example` (e.g. `blank`, `warm-grain`; `--template` is the renamed
old flag). `--non-interactive` disables prompts for agents and CI. Run
`npx -y hyperframes@0.8.77 init --help` to confirm current flags before
relying on this list — it may lag a fast-moving upstream CLI surface.

## 2. Edit HTML

Edit the generated composition HTML directly. See
[references/composition-basics.md](composition-basics.md) for the root and
clip attribute contract and timeline registration. No build step is required —
HyperFrames renders the HTML as-is.

## 3. Preview

Serve the composition in Studio with a scrubbable timeline:

```bash
npx -y hyperframes@0.8.77 preview my-composition
```

Open the printed local URL. Use the timeline scrubber to check that
`data-start`/`data-duration` values produce the intended sequencing before
spending render time. In a non-interactive shell `preview` starts in the
background; `--status` shows it and `--stop` stops the preview for that
project (`--foreground` keeps it attached). Stop only previews started for
this task.

## 4. Lint and check

Lint for fast feedback while editing, then run `check` as the final gate:

```bash
npx -y hyperframes@0.8.77 lint my-composition
npx -y hyperframes@0.8.77 check my-composition
```

`check` reruns lint, then loads the composition in a browser to audit runtime
errors, failed requests, layout overlap, and contrast (`--strict` also fails on
warnings). `validate`, `inspect`, and `layout` are deprecated aliases of
`check`. To review key frames without rendering, capture stills:

```bash
npx -y hyperframes@0.8.77 snapshot my-composition --at 1,3.5,6
```

Fix every reported error before proceeding.

## 5. Render

Render the composition to MP4:

```bash
npx -y hyperframes@0.8.77 render my-composition --strict \
  --output ./assets/videos/my-composition.mp4
```

`--strict` fails the render on lint errors (default output:
`renders/<name>.mp4`). Use `-c/--composition <file>` to render a file other
than `index.html`.

Verify the output the same way as any other rendered video artifact:

```bash
ffprobe -v error -show_streams -show_format -of json ./assets/videos/my-composition.mp4
```

The render is not proven complete until `ffprobe` reports a nonzero duration
and the expected width/height.

## Optional: remote/cloud render

With HeyGen credentials configured (see
[references/env-and-deps.md](env-and-deps.md)), cloud rendering is a
**separate top-level command**, not a `render` flag — `render` has no
`--engine`/cloud option:

```bash
npx -y hyperframes@0.8.77 cloud render my-composition --dry-run
npx -y hyperframes@0.8.77 cloud render my-composition \
  --output ./assets/videos/my-composition.mp4
```

`--dry-run` builds and inspects the upload zip without authenticating. Useful
flags: `--quality draft|standard|high`, `--resolution 1080p|4k` (4k is billed
at 1.5x), and `--aspect-ratio 16:9|9:16|1:1` (auto-detected from the HTML when
omitted). `cloud list` / `cloud get` / `cloud delete` manage prior cloud
renders. Run `npx -y hyperframes@0.8.77 cloud render --help` before relying on
exact flag names — pinned docs here may lag a fast-moving upstream CLI surface.
For distributed self-hosted rendering (not HeyGen's managed cloud), see the
separate `lambda` (AWS) and `cloudrun` (GCP) top-level commands.
