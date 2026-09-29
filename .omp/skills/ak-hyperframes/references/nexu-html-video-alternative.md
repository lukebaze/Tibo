# Alternative engine: nexu-io/html-video

HyperFrames is the default HTML-first video engine in this kit. `nexu-io/html-video`
is a separate HTML-to-MP4 CLI plus Studio with its own template catalog. Reach for it
only when the user already has a working `html-video` binary or checkout, or when a
template-driven promo, explainer, or social clip is the shape of the request and the
template catalog matches it. Otherwise stay on HyperFrames.

## Route carefully

- Use the installed remotion skill for React/Remotion compositions.
- Use the installed media-processing skill when the task is only encoding, trimming,
  transcoding, thumbnails, HLS/DASH, or batch FFmpeg/ImageMagick work.
- Use the installed preview or show-off skill for static HTML previews, slides, docs,
  or demos that do not need MP4 rendering.
- Use the installed agent-browser skill to operate the html-video Studio UI.

## Setup

Prefer a published `html-video` binary. If none exists, build a source checkout; do not
vendor the upstream engine into the user's project or kit. Upstream declares Node `>=20`
and pnpm `>=9`; if the upstream `package.json` differs, follow upstream.

```bash
git clone https://github.com/nexu-io/html-video "$HOME/html-video"
cd "$HOME/html-video"
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install
pnpm -r build
# If rendering reports a missing Playwright browser:
pnpm --filter @html-video/adapter-hyperframes exec playwright install chromium
```

Shell helper that works with either a global binary or a source checkout:

```bash
html_video() {
  if command -v html-video >/dev/null 2>&1; then html-video "$@"; return; fi
  local home="${HTML_VIDEO_HOME:-$HOME/html-video}"
  if [ -f "$home/packages/cli/dist/bin.js" ]; then node "$home/packages/cli/dist/bin.js" "$@"; return; fi
  echo "html-video CLI not found. Install it or set HTML_VIDEO_HOME to the source checkout." >&2
  return 127
}
```

Start with `html_video doctor` and `html_video list-engines`. The CLI defaults to JSON
output; add `--no-color` for logs and `--cwd <path>` when rendering outside the current
directory. Track every preview/Studio process (command, PID, port, project); reuse an
owned server and stop what you started after render work completes.

## Workflow

1. Pin the brief: audience and goal, duration and aspect ratio, source assets or URLs,
   template preference, output path, draft proof vs polished export.
2. Discover templates and inspect before choosing; some expose CLI variables, others
   rely on Studio editing and have no input schema.

```bash
html_video search-templates --intent "short product promo for a developer tool" --aspect 16:9 --top 5
html_video inspect-template frame-product-promo
```

3. Create or locate a project, select a template, add assets and variables.

```bash
html_video project-create --name "Promo" --intent "Short product promo" --aspect 16:9
html_video project-set-template <project-id> --template frame-product-promo
html_video project-add-asset <project-id> --inline-text "Headline copy" --caption "core message"
html_video project-add-asset <project-id> --file ./logo.png --caption "visual reference"
html_video project-set-var <project-id> --key headline --value '"Headline"'
html_video project-set-vars <project-id> --vars-file ./video-vars.json
```

4. Preview with `html_video project-preview <project-id>` and open the returned
   `html_path`. For interactive editing launch `html_video studio --port 3071`; Studio
   is the only way to customize templates with an empty variable schema.
5. Render and verify. The proof is not complete until `ffprobe` reports a nonzero
   duration and the expected dimensions.

```bash
html_video project-render <project-id> --output ./assets/videos/<slug>.mp4 --stream-progress
ffprobe -v error -show_streams -show_format -of json ./assets/videos/<slug>.mp4
```

## Output organization

Follow the target repository's artifact conventions. Otherwise use
`assets/videos/<slug>.mp4` for finished exports, `plans/<plan-slug>/visuals/<slug>.mp4`
for implementation proof, and `tmp/html-video/<slug>/` for disposable scratch state. Do
not commit large generated MP4 files unless the user wants the artifact versioned.

## Maintenance

Upstream moves quickly. Before relying on memorized commands run `html_video --help`,
`html_video project-render --help`, and `html_video studio --help`. If a first-party
`html-video` skill package appears, prefer its live instructions over this reference.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `html-video CLI not found` | Install a global binary, or set `HTML_VIDEO_HOME` to a built source checkout. |
| `doctor` reports missing browser | Install Playwright/Chromium per upstream instructions, rerun `doctor`. |
| Render reports `Executable doesn't exist` for Playwright Chromium | From the checkout run `pnpm --filter @html-video/adapter-hyperframes exec playwright install chromium`. |
| `doctor` reports ffmpeg missing | Install ffmpeg with the platform package manager and verify `ffmpeg -version`. |
| Template has no variables | Customize copy/layout in Studio; CLI variable commands cannot theme an empty schema. |
| Render starts but MP4 is blank | Preview first, inspect the browser console, rerun `project-render` with `--stream-progress`. |
| Output path is wrong | Re-render with an explicit `--output`; do not move partial render directories. |
