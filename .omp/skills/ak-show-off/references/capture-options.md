# Capture script details

## CAPTURE SCRIPT USAGE

The parallel capture script at `scripts/capture-sections.js` supports:

```bash
# Capture all sections in parallel across multiple ratios
node scripts/capture-sections.js \
  --url "file:///path/to/page.html" \
  --output-dir "./assets/showoff/my-mission/images" \
  --sections "#hero,#about,#features,#footer" \
  --ratios "horizontal,vertical,square" \
  --settle-delay 1500 \
  --format png \
  --quality 90

# Single ratio capture
node scripts/capture-sections.js \
  --url "http://localhost:3000" \
  --output-dir "./output" \
  --sections "#hero" \
  --ratios "horizontal"
```

Options:
- `--url` (required): Page URL to capture
- `--output-dir` (required): Output directory for images
- `--sections` (required): Comma-separated CSS selectors for sections
- `--ratios` (default: "horizontal,vertical,square"): Capture ratios
- `--settle-delay` (default: 1500): Ms to wait AFTER the page is visually ready (fonts + images + CSS backgrounds all resolved). Alias: `--delay` (back-compat).
- `--render-timeout` (default: 15000): Max ms to wait for any single readiness signal (fonts, images, bg-images). Prevents a broken asset from hanging the run.
- `--format` (default: "png"): Image format (png/jpg/webp)
- `--quality` (default: 90): Image quality (1-100, for jpg/webp)
- `--max-size` (default: 5): Max file size in MB before compression
- `--executable-path`: Optional Chrome/Chromium executable path. Also reads `CHROME_EXECUTABLE_PATH` or `PUPPETEER_EXECUTABLE_PATH`.

**Readiness chain before each capture:**
1. `networkidle0` (no in-flight requests)
2. `document.fonts.ready` (web fonts loaded)
3. Every `<img>` complete (or errored)
4. Every CSS `background-image` URL preloaded
5. Double `requestAnimationFrame` (layout + compositor settle)
6. `--settle-delay` ms (animations / JS-triggered reveals)

Same chain runs again after `scrollIntoView()` per section, so reveal-on-scroll animations capture correctly.
