#!/usr/bin/env python3
"""ak:diagram doctor — probe required tools, report only, never install.

Exit codes:
    0 — all required deps present, skill ready.
    1 — one or more required deps missing; message tells the user what to install.

Usage:
    python3 scripts/doctor.py            # human-readable report
    python3 scripts/doctor.py --json     # machine-readable JSON report
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
MERMAID_JS = SKILL_ROOT / "assets" / "mermaid.min.js"
PW_BROWSERS_HINT = "PLAYWRIGHT_BROWSERS_PATH"


def _shared_venv_python() -> Path | None:
    """Locate the shared skill venv python — walk up looking for .claude/skills/.venv."""
    # From kits/<name>/skills/ak-diagram/scripts → project root is 5 parents up
    for candidate in [SKILL_ROOT.parents[i] for i in range(2, 6) if i < len(SKILL_ROOT.parents)]:
        py = candidate / ".claude" / "skills" / ".venv" / "bin" / "python3"
        if py.exists():
            return py
        py_win = candidate / ".claude" / "skills" / ".venv" / "Scripts" / "python.exe"
        if py_win.exists():
            return py_win
    env_hint = os.environ.get("AGENTKIT_HOME")
    if env_hint:
        py = Path(env_hint) / ".claude" / "skills" / ".venv" / "bin" / "python3"
        if py.exists():
            return py
    return None


def _which(binary: str) -> str | None:
    return shutil.which(binary)


def _probe_playwright() -> tuple[bool, str]:
    """Detect whether Playwright + Chromium is usable via the shared skill venv."""
    venv_python = _shared_venv_python()
    py = str(venv_python) if venv_python else sys.executable
    try:
        proc = subprocess.run(
            [py, "-c", "import playwright.sync_api as _; print('ok')"],
            capture_output=True,
            timeout=10,
            text=True,
        )
        if proc.returncode == 0 and "ok" in proc.stdout:
            return True, f"playwright present via {py}"
        return False, f"playwright missing: {proc.stderr.strip() or 'import failed'}"
    except (subprocess.TimeoutExpired, OSError) as exc:
        return False, f"playwright probe failed: {exc}"


def _probe_chromium() -> tuple[bool, str]:
    root = os.environ.get(PW_BROWSERS_HINT, "/opt/pw-browsers")
    candidates = [
        Path(root) / "chromium",
        Path(root) / "chromium_headless_shell-1194",
        Path(root) / "chromium-1194",
    ]
    hits = [str(c) for c in candidates if c.exists()]
    if hits:
        return True, f"chromium found: {hits[0]}"
    return False, f"chromium not found under {root} (set {PW_BROWSERS_HINT})"


def _probe_ffmpeg() -> tuple[bool, str]:
    ffmpeg = _which("ffmpeg")
    if ffmpeg:
        return True, f"ffmpeg on PATH: {ffmpeg}"
    root = os.environ.get(PW_BROWSERS_HINT, "/opt/pw-browsers")
    candidates = list(Path(root).glob("ffmpeg*"))
    if candidates:
        return True, f"ffmpeg bundled: {candidates[0]}"
    return False, "ffmpeg missing (needed only for --video output)"


def _probe_mermaid() -> tuple[bool, str]:
    if MERMAID_JS.exists():
        size_kb = MERMAID_JS.stat().st_size // 1024
        return True, f"mermaid.min.js vendored ({size_kb} KB)"
    return False, f"mermaid.min.js missing at {MERMAID_JS} — run scripts/vendor_from_upstream.py"


def _probe_mmdc() -> tuple[bool, str]:
    mmdc = _which("mmdc")
    if mmdc:
        return True, f"mmdc on PATH: {mmdc} (fast-path enabled)"
    return True, "mmdc absent — fine, HTML pipeline used instead"


def run_probes() -> dict:
    probes = {
        "playwright": _probe_playwright(),
        "chromium": _probe_chromium(),
        "ffmpeg": _probe_ffmpeg(),
        "mermaid_js": _probe_mermaid(),
        "mmdc": _probe_mmdc(),
    }
    required = ("playwright", "chromium", "mermaid_js")
    report = {
        name: {"ok": ok, "detail": detail}
        for name, (ok, detail) in probes.items()
    }
    report["_required_missing"] = [n for n in required if not probes[n][0]]
    report["_ready"] = not report["_required_missing"]
    return report


def _print_human(report: dict) -> None:
    print("ak:diagram — dependency report")
    print("-" * 40)
    for name, entry in report.items():
        if name.startswith("_"):
            continue
        mark = "OK " if entry["ok"] else "!! "
        print(f"{mark} {name:12s} {entry['detail']}")
    print("-" * 40)
    if report["_ready"]:
        print("READY — skill has everything it needs.")
    else:
        print("MISSING — install the required deps above then re-run.")
        print("Doctor never installs anything on your behalf.")


def main() -> int:
    parser = argparse.ArgumentParser(description="ak:diagram dep probe")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    args = parser.parse_args()
    report = run_probes()
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        _print_human(report)
    return 0 if report["_ready"] else 1


if __name__ == "__main__":
    sys.exit(main())
