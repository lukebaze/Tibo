#!/usr/bin/env python3
"""ak:diagram render — freeze animations, screenshot to PNG, extract SVG.

Single Playwright HTML pipeline. Accepts:
    - a raw HTML file (already rendered)
    - a mermaid source (.mmd) — wraps in editorial frame with vendored mermaid.min.js
    - a JSON spec matching a per-type schema — fills the corresponding template

Outputs:
    <basename>.html   (self-contained, animated, mobile-safe)
    <basename>.png    (frozen final-frame screenshot, deterministic)
    <basename>.svg    (extracted SVG from mermaid or template DOM, if present)

Usage:
    python3 scripts/render.py --input diagram.mmd --out ./build/
    python3 scripts/render.py --input spec.json --type loop --out ./build/
    python3 scripts/render.py --input page.html --out ./build/ --no-png --no-svg
    python3 scripts/render.py --input diagram.mmd --dry-run   # skip screenshot
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys
import subprocess
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
ASSETS = SKILL_ROOT / "assets"
MERMAID_JS = ASSETS / "mermaid.min.js"
TOKENS_CSS = ASSETS / "tokens.css"
EFFECTS_CSS = ASSETS / "connector-effects.css"
TEMPLATES_DIR = ASSETS / "templates"
COMPILER_MJS = SKILL_ROOT / "scripts" / "compiler" / "compile.mjs"

DEFAULT_VIEWPORT = {"width": 1400, "height": 900}
SNAPSHOT_CHROMIUM_VERSION = "151.0.7922.34"
SNAPSHOT_FONT_PROBE = "AgentKit snapshot Wm0@/ 12345 — glyph probe"
SNAPSHOT_FONT_WIDTHS = {
    "sans-serif": 349.7734375,
    "serif": 323.1484375,
    "monospace": 412.8671875,
    "system-ui": 353.1484375,
    "ui-monospace": 323.1484375,
    '"Geist", system-ui, sans-serif': 353.1484375,
    '"Geist Mono", ui-monospace, monospace': 412.8671875,
    '"Instrument Serif", serif': 323.1484375,
    '"Instrument Serif", "Times New Roman", serif': 323.1484375,
    '"Geist Mono", ui-monospace, Menlo, monospace': 414.2109375,
}


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _mermaid_editorial_frame(mermaid_source: str, title: str = "", caption: str = "") -> str:
    tokens = _read(TOKENS_CSS)
    effects = _read(EFFECTS_CSS)
    mermaid_js = _read(MERMAID_JS)
    safe_title = html.escape(title) if title else "ak:diagram"
    title_html = f'<h1 class="ak-diag__title">{html.escape(title)}</h1>' if title else ""
    caption_html = f'<p class="ak-diag__caption">{html.escape(caption)}</p>' if caption else ""
    # Mermaid source is intentionally NOT HTML-escaped — Mermaid parses it as
    # its own DSL from the .mermaid <pre>. This is the documented input path.
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{safe_title}</title>
  <style>{tokens}</style>
  <style>{effects}</style>
  <style>
    body {{ margin: 0; background: var(--ak-diag-paper); }}
    .mermaid {{ font-family: var(--ak-diag-font); }}
  </style>
</head>
<body class="ak-diag">
  {title_html}
  {caption_html}
  <pre class="mermaid">
{mermaid_source}
  </pre>
  <script>{mermaid_js}</script>
  <script>
    (async () => {{
      const m = window.mermaid || (window.__esbuild_esm_mermaid && (await window.__esbuild_esm_mermaid()));
      const mermaid = (m && (m.default || m)) || window.mermaid;
      if (!mermaid) return;
      mermaid.initialize({{ startOnLoad: false, theme: 'base', fontFamily: 'inherit' }});
      await mermaid.run({{ querySelector: '.mermaid' }});
      window.__ak_diag_mermaid_done = true;
    }})().catch(err => {{ window.__ak_diag_mermaid_err = String(err); }});
  </script>
</body>
</html>
"""


def _load_template(dtype: str, variant: str) -> str:
    candidate = TEMPLATES_DIR / dtype / f"{variant}.html"
    if not candidate.exists():
        raise SystemExit(f"template not found: {candidate}")
    return _read(candidate)


def _fill_template(template_html: str, spec: dict) -> str:
    """Small slot filler — replaces {{key}} tokens with HTML-escaped str(spec[key]).

    Values are HTML-escaped before insertion. If a template deliberately needs
    raw HTML in a slot (rare), name the key with a `_html` suffix — those keys
    are passed through unescaped and the responsibility for safety shifts to
    the caller.
    """
    out = template_html
    for key, value in spec.items():
        token = f"{{{{{key}}}}}"
        if key.endswith("_html"):
            replacement = str(value)
        else:
            replacement = html.escape(str(value), quote=True)
        out = out.replace(token, replacement)
    return out


def _compose_html(input_path: Path, dtype: str | None, spec: dict | None,
                  title: str, caption: str) -> str:
    suffix = input_path.suffix.lower()
    if suffix == ".html":
        return _read(input_path)
    if suffix == ".mmd":
        return _mermaid_editorial_frame(_read(input_path), title, caption)
    if suffix == ".json":
        # Typed IR detection
        if spec and ("schema_version" in spec or "schemaVersion" in spec or "diagram_type" in spec):
            res = subprocess.run(
                ["node", str(COMPILER_MJS), "--input", str(input_path), "--format", "html"],
                capture_output=True,
                text=True,
                check=False
            )
            if res.returncode != 0:
                raise SystemExit(f"Typed IR compile error: {res.stderr.strip()}")
            return res.stdout
        if not dtype:
            raise SystemExit("--type is required when --input is a legacy JSON spec")
        template = _load_template(dtype, spec.get("variant", "light") if spec else "light")
        return _fill_template(template, spec or {})
    raise SystemExit(f"unsupported input: {input_path}")


def _verify_snapshot_profile(browser, page) -> None:
    """Refuse a golden comparison outside the renderer profile that seeded it."""
    if browser.version != SNAPSHOT_CHROMIUM_VERSION:
        raise RuntimeError(
            f"snapshot renderer requires Chromium {SNAPSHOT_CHROMIUM_VERSION}, got {browser.version}"
        )
    widths = page.evaluate(
        """({sample, fonts}) => {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            return Object.fromEntries(fonts.map(font => {
                context.font = `16px ${font}`;
                return [font, context.measureText(sample).width];
            }));
        }""",
        {"sample": SNAPSHOT_FONT_PROBE, "fonts": list(SNAPSHOT_FONT_WIDTHS)},
    )
    mismatches = [
        font for font, expected in SNAPSHOT_FONT_WIDTHS.items()
        if widths.get(font) != expected
    ]
    if mismatches:
        raise RuntimeError(
            "snapshot renderer font profile differs for: " + ", ".join(mismatches)
        )


def _freeze_and_screenshot(html: str, out_dir: Path, basename: str,
                           want_png: bool, want_svg: bool,
                           snapshot_profile: bool) -> dict:
    """Launch Playwright headless Chromium, freeze animations, capture PNG + SVG."""
    from playwright.sync_api import sync_playwright  # type: ignore

    out_dir.mkdir(parents=True, exist_ok=True)
    html_path = out_dir / f"{basename}.html"
    html_path.write_text(html, encoding="utf-8")

    result = {"html": str(html_path)}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--font-render-hinting=none",
            "--disable-lcd-text",
        ])
        page = browser.new_page(viewport=DEFAULT_VIEWPORT, device_scale_factor=2)
        page.goto(f"file://{html_path}")
        page.wait_for_load_state("networkidle", timeout=15000)
        if snapshot_profile:
            _verify_snapshot_profile(browser, page)
        # Give Mermaid a chance to finish async render. `.mermaid` <pre> becomes
        # a rendered <svg> inside the same element; wait for it or skip after a
        # short budget for non-Mermaid inputs.
        try:
            page.wait_for_selector("svg", timeout=5000)
        except Exception:
            pass  # no SVG expected (raw HTML input with no diagram markup)
        # Freeze all animations to their final frame for byte-hash determinism
        page.evaluate("""
            () => {
                document.querySelectorAll('svg').forEach(s => s.classList.add('ak-fx-frozen'));
                document.body?.classList.add('ak-fx-frozen');
                const anims = document.getAnimations();
                anims.forEach(a => {
                    const dur = a.effect?.getComputedTiming?.().duration || 0;
                    if (typeof dur === 'number' && dur > 0) a.currentTime = dur;
                    a.pause();
                });
            }
        """)

        if want_png:
            png_path = out_dir / f"{basename}.png"
            page.screenshot(path=str(png_path), full_page=True, omit_background=False)
            result["png"] = str(png_path)

        if want_svg:
            svg_source = page.evaluate("""
                () => {
                    const svg = document.querySelector('svg');
                    return svg ? new XMLSerializer().serializeToString(svg) : null;
                }
            """)
            if svg_source:
                svg_path = out_dir / f"{basename}.svg"
                svg_path.write_text(svg_source, encoding="utf-8")
                result["svg"] = str(svg_path)
        browser.close()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Render an ak:diagram to HTML/PNG/SVG")
    parser.add_argument("--input", type=Path, required=True, help="Input path (.html/.mmd/.json)")
    parser.add_argument("--out", type=Path, default=Path("./build"), help="Output directory")
    parser.add_argument("--type", type=str, default=None, help="Editorial type slug (json input only)")
    parser.add_argument("--title", type=str, default="", help="Editorial frame title")
    parser.add_argument("--caption", type=str, default="", help="Editorial frame caption")
    parser.add_argument("--no-png", action="store_true", help="Skip PNG screenshot")
    parser.add_argument("--no-svg", action="store_true", help="Skip SVG extraction")
    parser.add_argument("--dry-run", action="store_true", help="Write HTML only, skip browser")
    parser.add_argument("--snapshot-profile", action="store_true", help="Require the pinned golden renderer profile")
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"input not found: {args.input}")

    spec = None
    if args.input.suffix.lower() == ".json":
        spec = json.loads(_read(args.input))

    html = _compose_html(args.input, args.type, spec, args.title, args.caption)
    basename = args.input.stem

    if args.dry_run:
        args.out.mkdir(parents=True, exist_ok=True)
        target = args.out / f"{basename}.html"
        target.write_text(html, encoding="utf-8")
        print(f"dry-run: wrote {target}")
        return 0

    result = _freeze_and_screenshot(
        html,
        args.out,
        basename,
        want_png=not args.no_png,
        want_svg=not args.no_svg,
        snapshot_profile=args.snapshot_profile,
    )
    for kind, path in result.items():
        print(f"{kind}: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
