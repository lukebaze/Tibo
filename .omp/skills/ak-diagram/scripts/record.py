#!/usr/bin/env python3
"""ak:diagram record — frame-step an animated HTML to MP4 (default) or GIF (--gif).

Deterministic capture: instead of Playwright's video recorder (vsync-dependent),
we step `document.getAnimations()` currentTime frame-by-frame and screenshot
each frame, then hand the frame sequence to ffmpeg for assembly.

Usage:
    python3 scripts/record.py --input diagram.html --out clip.mp4
    python3 scripts/record.py --input diagram.html --out clip.gif --gif
    python3 scripts/record.py --input diagram.html --duration 6 --fps 30
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def _is_ffmpeg_binary(p: Path) -> bool:
    """True only for a real executable file whose name looks like an ffmpeg binary."""
    if not p.is_file() or not os.access(str(p), os.X_OK):
        return False
    # Reject archives, checksums, and version files
    lowered = p.name.lower()
    return "ffmpeg" in lowered and not lowered.endswith((".tar.gz", ".tar.xz", ".zip", ".sha256", ".txt", ".md"))


def _find_ffmpeg() -> str:
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    for candidate in Path("/opt/pw-browsers").glob("ffmpeg*"):
        if _is_ffmpeg_binary(candidate):
            return str(candidate)
        # nested layout: ffmpeg-1011/ffmpeg-linux
        if candidate.is_dir():
            for sub in candidate.iterdir():
                if _is_ffmpeg_binary(sub):
                    return str(sub)
    raise SystemExit("ffmpeg not found — install via package manager or set PATH")


def _capture_frames(html_path: Path, frames_dir: Path, duration_s: float, fps: int) -> int:
    """Step animations frame-by-frame; screenshot each; return frame count."""
    from playwright.sync_api import sync_playwright  # type: ignore

    total_frames = max(1, int(duration_s * fps))
    dt_ms = 1000.0 / fps
    frames_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--font-render-hinting=none",
            "--disable-lcd-text",
        ])
        page = browser.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=2)
        page.goto(f"file://{html_path.resolve()}")
        page.wait_for_load_state("networkidle", timeout=15000)
        # Pause all animations up front so we can drive currentTime deterministically
        page.evaluate("() => document.getAnimations().forEach(a => a.pause())")

        for i in range(total_frames):
            t_ms = i * dt_ms
            page.evaluate(f"""
                (t) => document.getAnimations().forEach(a => {{
                    const dur = a.effect?.getComputedTiming?.().duration || 0;
                    if (typeof dur === 'number' && dur > 0) {{
                        a.currentTime = t % dur;
                    }}
                }})
            """, t_ms)
            page.screenshot(path=str(frames_dir / f"frame-{i:05d}.png"), full_page=False)
        browser.close()
    return total_frames


def _assemble_mp4(ffmpeg: str, frames_dir: Path, output: Path, fps: int) -> None:
    cmd = [
        ffmpeg, "-y",
        "-framerate", str(fps),
        "-i", str(frames_dir / "frame-%05d.png"),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", "18",
        str(output),
    ]
    subprocess.check_call(cmd)


def _assemble_gif(ffmpeg: str, frames_dir: Path, output: Path, fps: int) -> None:
    palette = frames_dir / "palette.png"
    subprocess.check_call([
        ffmpeg, "-y",
        "-framerate", str(fps),
        "-i", str(frames_dir / "frame-%05d.png"),
        "-vf", "palettegen=stats_mode=diff",
        str(palette),
    ])
    subprocess.check_call([
        ffmpeg, "-y",
        "-framerate", str(fps),
        "-i", str(frames_dir / "frame-%05d.png"),
        "-i", str(palette),
        "-lavfi", "paletteuse=dither=bayer:bayer_scale=5",
        str(output),
    ])


def main() -> int:
    parser = argparse.ArgumentParser(description="Record ak:diagram animation to MP4/GIF")
    parser.add_argument("--input", type=Path, required=True, help="HTML file with animations")
    parser.add_argument("--out", type=Path, required=True, help="Output MP4 or GIF path")
    parser.add_argument("--duration", type=float, default=5.0, help="Seconds to capture")
    parser.add_argument("--fps", type=int, default=30, help="Frames per second")
    parser.add_argument("--gif", action="store_true", help="Emit GIF instead of MP4")
    parser.add_argument("--keep-frames", action="store_true", help="Keep intermediate PNG frames")
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"input not found: {args.input}")
    ffmpeg = _find_ffmpeg()

    with tempfile.TemporaryDirectory(prefix="ak-diag-frames-") as tmp:
        frames_dir = Path(tmp)
        count = _capture_frames(args.input, frames_dir, args.duration, args.fps)
        print(f"captured {count} frames @ {args.fps} fps")

        args.out.parent.mkdir(parents=True, exist_ok=True)
        if args.gif or args.out.suffix.lower() == ".gif":
            _assemble_gif(ffmpeg, frames_dir, args.out, args.fps)
        else:
            _assemble_mp4(ffmpeg, frames_dir, args.out, args.fps)

        if args.keep_frames:
            keep = args.out.parent / f"{args.out.stem}-frames"
            shutil.copytree(frames_dir, keep, dirs_exist_ok=True)
            print(f"frames: {keep}")

    print(f"wrote: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
